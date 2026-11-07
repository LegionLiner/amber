import { defineStore } from 'pinia'
import { computed, ref, toRaw, watch } from 'vue'
import { all, batch, onDbWrite } from '@/data/db'
import { dataRev } from '@/app/data-rev'
import { isNative } from '@/native/paths'
import { MusicCore } from '@/native/music-core'
import { isDesktop } from '@/native/desktop/bridge'
import type { SyncDb } from '@/sync/kinds'
import { disableSync, dropIdlePrefs, enableSync, pendingCount, runSync } from '@/sync/engine'
import { ApiError, SyncApi, normalizeUrl, type Me } from '@/sync/api'
import { readCoverImage, saveCoverImage } from '@/sync/covers'
import { useSettings, type AppSettings } from './settings'
import { useLibrary } from './library'
import { usePlaylists } from './playlists'
import { $t } from '@/i18n'

/**
 * Синхронизация с твоим сервером Amber (server/). Работает молча и сразу:
 * — своё изменение уходит на сервер, как только оно появилось в журнале: запись из интерфейса замечается
 *   тут же, запись движка (прослушивание; на телефоне его пишет Kotlin) — опросом журнала раз в пару секунд;
 * — чужое приходит по сигналу: устройство держит открытым поток событий сервера, и тот будит его, как только
 *   другое устройство что-то прислало. Открытые экраны перечитывают данные сами (app/data-rev.ts);
 * — про запас остаются старые поводы: запуск, раз в несколько минут, появилась сеть, окно снова на глазах.
 *   Со старым сервером без потока событий на них всё и держится;
 * — без сети всё работает как раньше, изменения копятся в журнале и уходят при следующей связи;
 * — ошибки не всплывают сообщениями, видны только в настройках («Синхронизация»).
 *
 * Адрес сервера, почта и токен входа хранятся в таблице sync_state базы, а не в настройках:
 * настройки уходят в бэкап JSON, токену там не место.
 *
 * Два режима (mode):
 *  - server — свой сервер Amber в интернете, вход по почте;
 *  - lan — без серверов: компьютер в той же Wi-Fi-сети сам служит «сервером» (desktop/hub.ts), телефон
 *    подключается к нему по коду с экрана (тот же вход, что у папки по Wi-Fi), а окно на компьютере — к себе же.
 *    Адрес компьютера в сети может смениться: тогда его находят по маячку (setLocator) и идут уже туда.
 */

/**
 * Какие настройки общие для всех устройств. Тема, папки, звук устройства — у каждого свои.
 * Свои пресеты звука — не здесь: они синхронизируются каждый отдельно (kind 'spreset', таблица sound_presets),
 * а в этом общем куске набор одного устройства целиком затирал набор другого
 */
const SHARED_PREFS = [
  'counting',
  'radio',
  'askRatingAfterPlays',
  'shuffleKind',
  'showLyrics',
  'lrclib',
] as const satisfies readonly (keyof AppSettings)[]

const PERIOD_MS = 3 * 60 * 1000
/** Запись из интерфейса: ждём чуть-чуть, чтобы пачка правок (перестановка, импорт) ушла одним запросом */
const AFTER_WRITE_MS = 250
/** Как часто смотреть в журнал за тем, что записал движок мимо интерфейса */
const OUTBOX_POLL_MS = 2000
/** Сервер без потока событий: заново пробуем редко (вдруг обновили) */
const NO_LIVE_RETRY_MS = 10 * 60 * 1000

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error' | 'auth'
export type SyncMode = 'server' | 'lan'

const sdb: SyncDb = {
  all: (sql, params) => all(sql, params ?? []),
  batch: async (statements) => {
    await batch(statements)
  },
}

async function getState(k: string): Promise<string | null> {
  return (await all<{ v: string }>(`SELECT v FROM sync_state WHERE k = ?`, [k]))[0]?.v ?? null
}
async function setStates(values: Record<string, string | null>) {
  await batch(
    Object.entries(values).map(([k, v]) =>
      v == null
        ? { sql: `DELETE FROM sync_state WHERE k = ?`, params: [k] }
        : { sql: `INSERT OR REPLACE INTO sync_state (k, v) VALUES (?, ?)`, params: [k, v] },
    ),
  )
}

function deviceName(): { name: string; platform: string } {
  if (isDesktop) return { name: $t('Компьютер'), platform: 'desktop' }
  if (isNative) return { name: $t('Телефон'), platform: 'android' }
  return { name: $t('Браузер'), platform: 'web' }
}

export const useSync = defineStore('sync', () => {
  const url = ref('')
  const email = ref('')
  const token = ref<string | null>(null)
  const mode = ref<SyncMode>('server')
  /** Компьютер, через который идут данные в режиме lan */
  const peer = ref('')
  /** Кому показывать в подписях: почта аккаунта или имя компьютера */
  const label = computed(() => (mode.value === 'lan' ? peer.value : email.value))
  /** Режим lan на телефоне: найти компьютер, если он сменил адрес в сети (null — не нашёлся) */
  let locate: (() => Promise<string | null>) | null = null
  function setLocator(fn: (() => Promise<string | null>) | null) {
    locate = fn
  }
  const status = ref<SyncStatus>('off')
  /**
   * Проход идёт дольше секунды — только тогда настройки пишут «Синхронизирую…». Короткие проходы (их много:
   * пришло изменение с другого устройства, своя правка) не трогают текст, иначе он мигал туда-сюда
   */
  const busy = ref(false)
  let busyTimer = 0
  watch(status, (v) => {
    clearTimeout(busyTimer)
    if (v === 'syncing') busyTimer = window.setTimeout(() => (busy.value = true), 1000)
    else busy.value = false
  })
  const error = ref('')
  const lastAt = ref<number | null>(null)
  const pending = ref(0)
  const me = ref<Me | null>(null)
  const signedIn = computed(() => !!token.value)
  /** Поток событий открыт: чужие изменения приходят сразу */
  const live = ref(false)
  /** Сервер старый и потока событий не знает — изменения приходят по расписанию */
  const liveUnsupported = ref(false)

  let running: Promise<void> | null = null
  /** Пока шла синхронизация, появился ещё повод — сразу после неё нужен новый проход */
  let again = false
  let timer = 0
  let changeTimer = 0
  let failures = 0
  let started = false
  /** Журнал, каким он остался после последнего прохода: «число записей:время последней» */
  let outboxSig = ''
  let liveCtl: AbortController | null = null
  let wake: (() => void) | null = null
  /** Кто ещё слушает поток событий: «что играет» и команды разбирает stores/remote.ts */
  const liveHandlers = new Set<(name: string, data: unknown) => void>()
  function onLiveEvent(fn: (name: string, data: unknown) => void): () => void {
    liveHandlers.add(fn)
    return () => liveHandlers.delete(fn)
  }
  /** Движок телефона держит свой поток (для управления с погашенным экраном): после входа и выхода он перечитывает вход */
  function relinkEngine() {
    if (isNative) void MusicCore.remoteLink().catch((e: unknown) => console.warn('remote link failed', e))
  }

  const api = () => new SyncApi(url.value, token.value)

  async function load() {
    url.value = (await getState('url')) ?? ''
    email.value = (await getState('email')) ?? ''
    token.value = await getState('token')
    mode.value = (await getState('mode')) === 'lan' ? 'lan' : 'server'
    peer.value = (await getState('peer')) ?? ''
    lastAt.value = Number(await getState('lastAt')) || null
    status.value = token.value ? 'idle' : 'off'
    if (token.value) pending.value = await pendingCount(sdb)
  }

  /** Вход или регистрация. После — всё, что есть на устройстве, отправляется на сервер */
  async function signIn(serverUrl: string, mail: string, password: string, create: boolean, code?: string) {
    const base = normalizeUrl(serverUrl)
    if (!base) throw new Error($t('Укажи адрес сервера'))
    const a = new SyncApi(base)
    await a.health()
    const r = create ? await a.register(mail, password, deviceName(), code) : await a.login(mail, password, deviceName())
    url.value = base
    email.value = r.email
    token.value = r.token
    mode.value = 'server'
    await setStates({ url: base, email: r.email, token: r.token, mode: 'server', peer: null })
    await enableSync(sdb)
    status.value = 'idle'
    failures = 0
    start()
    await syncNow()
    void listen()
    relinkEngine()
  }

  /**
   * Данные — через компьютер в той же сети (desktop/hub.ts). base и token — с подключения по коду (телефон)
   * или из окна этого же компьютера. Всё, что есть на устройстве, отправляется туда, чужое приходит сюда
   */
  async function connectLan(base: string, lanToken: string, name: string) {
    if (token.value) {
      stopListening()
      clearTimeout(timer)
      await disableSync(sdb)
    }
    url.value = base
    token.value = lanToken
    email.value = ''
    mode.value = 'lan'
    peer.value = name
    me.value = null
    await setStates({ url: base, token: lanToken, mode: 'lan', peer: name, email: null })
    await enableSync(sdb)
    status.value = 'idle'
    failures = 0
    start()
    await syncNow()
    void listen()
    relinkEngine()
  }

  /** Компьютер сменил адрес в сети: дальше ходим на новый */
  async function moveLan(base: string) {
    if (mode.value !== 'lan' || base === url.value) return
    url.value = base
    await setStates({ url: base })
    relinkEngine()
    reconnect()
  }

  /** Выйти на этом устройстве: данные остаются, синхронизация выключается */
  async function signOut() {
    const a = api()
    token.value = null
    status.value = 'off'
    me.value = null
    clearTimeout(timer)
    stopListening()
    await a.logout().catch(() => undefined)
    await disableSync(sdb)
    await setStates({ token: null, lastAt: null })
    mode.value = 'server'
    peer.value = ''
    relinkEngine()
  }

  async function deleteAccount(password: string) {
    await api().deleteAccount(password)
    await signOut()
  }

  async function loadMe() {
    if (!token.value) return
    try {
      me.value = await api().me()
    } catch (e) {
      handleError(e)
    }
  }

  async function forgetDevice(id: string) {
    await api().forgetDevice(id)
    await loadMe()
  }

  function readPrefs(): Record<string, unknown> {
    const s = useSettings().s
    return Object.fromEntries(SHARED_PREFS.map((k) => [k, structuredClone(toRaw(s[k]))]))
  }

  function applyPrefs(data: Record<string, unknown>) {
    const s = useSettings().s as unknown as Record<string, unknown>
    for (const k of SHARED_PREFS) if (k in data) s[k] = data[k]
  }

  function handleError(e: unknown) {
    if (e instanceof ApiError && e.kind === 'auth') {
      // Вход отозвали (вышел с другого устройства или удалил аккаунт): ждём нового входа
      status.value = 'auth'
      error.value = e.message
      return
    }
    status.value = e instanceof ApiError && e.kind === 'offline' ? 'offline' : 'error'
    error.value = e instanceof Error ? e.message : String(e)
  }

  async function readOutboxSig(): Promise<string> {
    const [r] = await all<{ n: number; m: number }>('SELECT COUNT(*) AS n, COALESCE(MAX(at), 0) AS m FROM sync_outbox')
    return String(r?.n ?? 0) + ':' + String(r?.m ?? 0)
  }

  /** Один проход синхронизации; если уже идёт — ждём его, а после него делаем ещё один */
  function syncNow(): Promise<void> {
    if (!token.value || status.value === 'auth') return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      status.value = 'syncing'
      let ok = false
      try {
        const report = await runSync(sdb, api(), {
          readPrefs,
          applyPrefs,
          readCover: readCoverImage,
          saveCover: saveCoverImage,
        })
        lastAt.value = Date.now()
        failures = 0
        status.value = 'idle'
        error.value = ''
        await setStates({ lastAt: String(lastAt.value) })
        ok = true
        // Пришли чужие изменения — перечитываем то, что показывается сейчас
        const k = report.kinds
        if (['track', 'card', 'play', 'rate', 'duel'].some((x) => k.has(x))) await useLibrary().load()
        if (['playlist', 'pgroup', 'pcover'].some((x) => k.has(x))) await usePlaylists().refresh()
        if (k.has('spreset')) await useSettings().reloadPresets()
        if (report.pulled > 0) dataRev.value++
      } catch (e) {
        failures++
        handleError(e)
        // Компьютер не отвечает по старому адресу — может, он теперь на другом: ищем по маячку
        if (mode.value === 'lan' && e instanceof ApiError && e.kind === 'offline' && locate) {
          const moved = await locate().catch(() => null)
          if (moved && moved !== url.value) {
            await moveLan(moved)
            again = true
            ok = true
          }
        }
      } finally {
        pending.value = await pendingCount(sdb).catch(() => pending.value)
        // Что осталось в журнале (играющий трек, неотправленное без сети) — уже учтено: заново из-за него не идём
        outboxSig = await readOutboxSig().catch(() => outboxSig)
        running = null
        const rerun = again && ok
        again = false
        if (rerun) void syncNow()
        else schedule()
      }
    })()
    return running
  }

  /** Следующая попытка: по расписанию или, после ошибок, всё реже (до 15 минут) */
  function schedule() {
    clearTimeout(timer)
    if (!token.value || status.value === 'auth') return
    const delay = failures ? Math.min(15 * 60 * 1000, 30_000 * 2 ** (failures - 1)) : PERIOD_MS
    timer = window.setTimeout(() => void syncNow(), delay)
  }

  /** В журнале появилось новое с последнего прохода — отправляем сразу */
  async function checkOutbox() {
    if (!token.value || running || status.value === 'auth') return
    const sig = await readOutboxSig().catch(() => null)
    if (sig == null || sig === outboxSig) return
    if (sig.startsWith('0:')) {
      outboxSig = sig
      pending.value = 0
      return
    }
    // Сохранилась только локальная мелочь в настройках — общие те же: проход не нужен
    if (await dropIdlePrefs(sdb, readPrefs()).catch(() => false)) {
      outboxSig = await readOutboxSig().catch(() => sig)
      pending.value = 0
      return
    }
    void syncNow()
  }

  /** В базу записали из интерфейса: через мгновение смотрим журнал */
  function noteChange() {
    if (!token.value) return
    clearTimeout(changeTimer)
    changeTimer = window.setTimeout(() => void checkOutbox(), AFTER_WRITE_MS)
  }

  /**
   * Поток событий сервера: пока он открыт, чужие изменения приходят сразу. Оборвался — переподключаемся
   * с растущей паузой (до 30 с); появилась сеть или окно вернулось на глаза — без паузы.
   */
  async function listen() {
    if (liveCtl || !token.value || status.value === 'auth') return
    const ctl = (liveCtl = new AbortController())
    let fails = 0
    while (!ctl.signal.aborted && token.value) {
      let pause = 0
      try {
        await api().events((name, data) => {
          fails = 0
          liveUnsupported.value = false
          if (name === 'hello') live.value = true
          // «hello» — догоняем то, что пришло, пока потока не было; «changed» — пришло только что
          if (name === 'hello' || name === 'changed') void syncNow()
          liveHandlers.forEach((h) => h(name, data))
        }, ctl.signal)
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'auth') {
          handleError(e)
          break
        }
        if (e instanceof ApiError && e.kind === 'server') {
          liveUnsupported.value = true
          pause = NO_LIVE_RETRY_MS
        }
      }
      live.value = false
      if (ctl.signal.aborted) break
      fails++
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(done, pause || Math.min(30_000, 1000 * 2 ** Math.min(fails - 1, 5)))
        function done() {
          clearTimeout(t)
          wake = null
          resolve()
        }
        wake = done
        ctl.signal.addEventListener('abort', done, { once: true })
      })
    }
    live.value = false
    if (liveCtl === ctl) liveCtl = null
  }

  function stopListening() {
    liveCtl?.abort()
    liveCtl = null
    live.value = false
  }

  /** Повод думать, что связь вернулась: не ждём конца паузы переподключения */
  function reconnect() {
    if (!token.value || status.value === 'auth') return
    if (!liveCtl) void listen()
    else if (!live.value && !liveUnsupported.value) wake?.()
  }

  /** Запуск расписания: при старте приложения и после входа */
  function start() {
    if (started) return
    started = true
    window.addEventListener('online', () => {
      reconnect()
      void syncNow()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      reconnect()
      // Поток жив — всё уже пришло по нему; нет — догоняем сами
      if (!live.value || Date.now() - (lastAt.value ?? 0) > 60_000) void syncNow()
    })
    onDbWrite(noteChange)
    // Изменения не всегда идут через интерфейс (прослушивания пишет движок, на телефоне — Kotlin): смотрим журнал
    window.setInterval(() => void checkOutbox(), OUTBOX_POLL_MS)
    void listen()
  }

  return {
    url,
    email,
    mode,
    peer,
    label,
    status,
    busy,
    error,
    lastAt,
    pending,
    me,
    signedIn,
    live,
    client: api,
    onLiveEvent,
    liveUnsupported,
    load,
    signIn,
    signOut,
    connectLan,
    moveLan,
    setLocator,
    deleteAccount,
    loadMe,
    forgetDevice,
    syncNow,
    noteChange,
    start,
  }
})
