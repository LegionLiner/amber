import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { all, batch, run } from '@/data/db'
import { MusicCore } from '@/native/music-core'
import { isNative } from '@/native/paths'
import { desktop, isDesktop, type DesktopFileSyncState } from '@/native/desktop/bridge'
import { keyOf, type BaseEntry } from '@/filesync/plan'
import { runSync, type BaseStore, type SyncProgress, type SyncReport } from '@/filesync/run'
import { nativeIO } from '@/filesync/native'
import { useLibrary } from './library'
import { useSync } from './sync'
import { $t } from '@/i18n'

/**
 * Папка с музыкой по Wi-Fi — вместо Syncthing.
 *
 * Компьютер раздаёт папку в локальной сети (desktop/filesync.ts), телефон подключается к нему по коду
 * и сам сверяет обе стороны (src/filesync). Проход идёт, пока приложение на телефоне открыто: при запуске,
 * при возвращении в приложение (если прошло больше пары минут) и раз в 10 минут; кнопка — на всякий случай.
 * Компьютер не в сети — молча ждём следующего раза.
 *
 * Здесь же — состояние для настроек компьютера (раздаёт ли он, какую папку, кто подключён).
 *
 * Подключение по коду — одно на всё: через него же идут общие данные (оценки, история, плейлисты, «что играет»)
 * — stores/sync.ts в режиме lan. Папку и данные можно включать по отдельности.
 */

const AUTO_EVERY_MS = 10 * 60_000
const RESUME_AFTER_MS = 2 * 60_000
const TRASH_DAYS = 30

export type FileSyncStatus = 'idle' | 'running' | 'offline' | 'error'

/** Подключение телефона к компьютеру */
interface Link {
  base: string
  token: string
  pcId: string
  pcName: string
  /** Компьютер раздаёт папку (по последнему ответу) */
  folder?: string | null
  /** Компьютер делится данными */
  data?: boolean
}

async function getState(k: string): Promise<string | null> {
  return (await all<{ v: string }>(`SELECT v FROM filesync_state WHERE k = ?`, [k]))[0]?.v ?? null
}
async function setStates(values: Record<string, string | null>) {
  await batch(
    Object.entries(values).map(([k, v]) =>
      v == null
        ? { sql: `DELETE FROM filesync_state WHERE k = ?`, params: [k] }
        : { sql: `INSERT OR REPLACE INTO filesync_state (k, v) VALUES (?, ?)`, params: [k, v] },
    ),
  )
}

const baseStore: BaseStore = {
  load: async () =>
    (
      await all<{ path: string; ls: number; lm: number; rs: number; rm: number }>(
        `SELECT path, ls, lm, rs, rm FROM filesync_base`,
      )
    ).map((r): BaseEntry => ({ p: r.path, l: { s: r.ls, m: r.lm }, r: { s: r.rs, m: r.rm } })),
  put: async (e) =>
    void (await run(`INSERT OR REPLACE INTO filesync_base (key, path, ls, lm, rs, rm) VALUES (?, ?, ?, ?, ?, ?)`, [
      keyOf(e.p),
      e.p,
      e.l.s,
      e.l.m,
      e.r.s,
      e.r.m,
    ])),
  remove: async (k) => void (await run(`DELETE FROM filesync_base WHERE key = ?`, [k])),
}

const baseUrl = (host: string, port: number) => `http://${host.includes(':') ? `[${host}]` : host}:${port}`

export const useFileSync = defineStore('filesync', () => {
  /* ---------------- телефон ---------------- */
  const link = ref<Link | null>(null)
  const root = ref<string | null>(null)
  const access = ref(false)
  const status = ref<FileSyncStatus>('idle')
  const error = ref('')
  const progress = shallowRef<SyncProgress | null>(null)
  const report = shallowRef<SyncReport | null>(null)
  const lastAt = ref<number | null>(null)
  const paired = computed(() => !!link.value)
  /** Папка с музыкой по Wi-Fi включена на телефоне (данные — отдельно, в stores/sync.ts) */
  const files = ref(true)
  /** Общие данные идут через этот компьютер */
  const dataOn = computed(() => {
    const sync = useSync()
    return sync.mode === 'lan' && sync.signedIn
  })
  let loaded = false
  let ctl: AbortController | null = null
  let timer = 0

  async function load() {
    if (!isNative || loaded) return
    loaded = true
    const raw = await getState('link')
    link.value = raw ? (JSON.parse(raw) as Link) : null
    files.value = (await getState('files')) !== '0'
    root.value = (await getState('root')) ?? (await MusicCore.fsDefaultRoot()).root
    lastAt.value = Number(await getState('lastAt')) || null
    const r = await getState('report')
    report.value = r ? (JSON.parse(r) as SyncReport) : null
    await checkAccess()
  }

  async function checkAccess() {
    access.value = (await MusicCore.fsAccess()).granted
    return access.value
  }

  /** Компьютеры в сети, которые сейчас раздают папку */
  async function discover() {
    return (await MusicCore.fsDiscover({ ms: 3000 })).found
  }

  /** Подключиться по коду с экрана компьютера. address — «192.168.1.5» или «192.168.1.5:47862» */
  async function pair(address: string, code: string) {
    const [host, port] = address
      .trim()
      .replace(/^https?:\/\//, '')
      .split(':')
    const base = baseUrl(host!, Number(port) || 47862)
    const r = await MusicCore.fsPair({ base, code: code.trim(), name: $t('Телефон') })
    const hello = await MusicCore.fsHello({ base }).catch(() => null)
    link.value = { base, token: r.token, pcId: r.id, pcName: r.name, folder: hello?.folder ?? null, data: hello?.data ?? false }
    // Папку — если компьютер её раздаёт
    files.value = !!hello?.folder
    // Новый компьютер — память о прошлых проходах к нему не относится
    await run(`DELETE FROM filesync_base`)
    await setStates({
      link: JSON.stringify(link.value),
      files: files.value ? '1' : '0',
      pairKey: null,
      report: null,
      lastAt: null,
    })
    report.value = null
    lastAt.value = null
    // Данные — сразу через этот компьютер, если они ещё не идут через свой сервер
    const sync = useSync()
    if (link.value.data && (!sync.signedIn || sync.mode === 'lan')) await setData(true)
  }

  /** Общие данные через этот компьютер: включить или выключить */
  async function setData(on: boolean) {
    const sync = useSync()
    const l = link.value
    if (on && l) await sync.connectLan(l.base, l.token, l.pcName)
    else if (!on && sync.mode === 'lan' && sync.signedIn) await sync.signOut()
  }

  /** Папка с музыкой по Wi-Fi на телефоне: включить или выключить */
  async function setFiles(on: boolean) {
    files.value = on
    await setStates({ files: on ? '1' : '0' })
    if (on) void syncNow()
    else ctl?.abort()
  }

  async function unpair() {
    ctl?.abort()
    await setData(false)
    link.value = null
    await run(`DELETE FROM filesync_base`)
    await setStates({ link: null, pairKey: null, report: null, lastAt: null })
    report.value = null
  }

  async function chooseRoot() {
    const r = await MusicCore.fsPickFolder()
    root.value = r.root
    // Другая папка на телефоне — сверяем заново, ничего не удаляя по старой памяти
    await run(`DELETE FROM filesync_base`)
    await setStates({ root: r.root })
  }

  /** Компьютер на прежнем адресе? Если нет — ищем его маячок (адрес в сети мог смениться) */
  async function reach(l: Link): Promise<Link | null> {
    let base = l.base
    let h: Awaited<ReturnType<typeof MusicCore.fsHello>> | null = null
    try {
      h = await MusicCore.fsHello({ base })
      if (h.id !== l.pcId) h = null
    } catch {
      /* не отвечает — ищем */
    }
    if (!h) {
      const found = (await discover()).find((f) => f.id === l.pcId)
      if (!found) return null
      base = baseUrl(found.host, found.port)
      h = await MusicCore.fsHello({ base }).catch(() => null)
    }
    const next: Link = { ...l, base, folder: h ? h.folder : l.folder, data: h ? !!h.data : l.data }
    if (JSON.stringify(next) !== JSON.stringify(l)) {
      link.value = next
      await setStates({ link: JSON.stringify(next) })
    }
    // Данные идут через этот компьютер — туда же, по новому адресу
    if (base !== l.base) await useSync().moveLan(base)
    return next
  }

  /** Один проход. auto — по расписанию: «компьютер не в сети» тогда не ошибка */
  async function syncNow(opts: { confirmDeletes?: boolean; auto?: boolean } = {}) {
    if (!isNative || status.value === 'running' || !link.value || !root.value || !files.value) return
    if (!(await checkAccess())) {
      if (!opts.auto) error.value = $t('Нужен доступ к файлам')
      return
    }
    status.value = 'running'
    error.value = ''
    progress.value = null
    ctl = new AbortController()
    try {
      const l = await reach(link.value)
      if (!l) {
        status.value = 'offline'
        return
      }
      // Компьютер папку не раздаёт (только данные) — сверять нечего
      if (l.folder === null) {
        status.value = 'idle'
        return
      }
      const listing = await MusicCore.fsRemoteList({ base: l.base, token: l.token })
      // Память прошлых проходов относится к паре папок «эта на компьютере — эта на телефоне». Сменилась любая
      // из них (выбрали другую, или папка телефона взялась по умолчанию) — сверяем заново: тогда файлы только
      // копируются и сравниваются, а удалений по чужой памяти не бывает
      const pairKey = `${listing.folderId}|${root.value}`
      if (pairKey !== (await getState('pairKey'))) {
        await run(`DELETE FROM filesync_base`)
        await setStates({ pairKey, root: root.value })
      }
      await MusicCore.fsCleanTrash({ root: root.value, days: TRASH_DAYS }).catch(() => undefined)
      const r = await runSync(nativeIO({ base: l.base, token: l.token, root: root.value }, listing.files), baseStore, {
        confirmDeletes: opts.confirmDeletes,
        signal: ctl.signal,
        onProgress: (p) => (progress.value = p),
      })
      report.value = r
      lastAt.value = Date.now()
      status.value = r.error === 'localEmpty' || r.error === 'remoteEmpty' ? 'error' : 'idle'
      if (r.error === 'localEmpty') error.value = $t('Папка на телефоне пуста — похоже, к ней нет доступа. Ничего не трогаю.')
      if (r.error === 'remoteEmpty') error.value = $t('Папка на компьютере пуста — похоже, она недоступна. Ничего не трогаю.')
      await setStates({ report: JSON.stringify(r), lastAt: String(lastAt.value) })
      // Новые и убранные файлы медиатека телефона видит после пересканирования
      if (r.pulled || r.trashedLocal)
        setTimeout(
          () =>
            void useLibrary()
              .scan(false)
              .catch(() => undefined),
          1500,
        )
    } catch (e) {
      status.value = 'error'
      error.value = e instanceof Error ? e.message : String(e)
      if (/не подключён|not connected/.test(error.value))
        error.value = $t('Компьютер больше не знает этот телефон: подключись заново')
    } finally {
      if (status.value === 'running') status.value = 'idle'
      progress.value = null
      ctl = null
    }
  }

  function cancel() {
    ctl?.abort()
  }

  /** Автозапуск: при старте, при возвращении в приложение и раз в 10 минут, пока оно открыто */
  function start() {
    if (!isNative) return
    // Данные через компьютер: он сменил адрес в сети — находим его по маячку
    useSync().setLocator(async () => {
      const l = link.value
      return l ? ((await reach(l))?.base ?? null) : null
    })
    void load().then(() => syncNow({ auto: true }))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      void checkAccess()
      if (Date.now() - (lastAt.value ?? 0) > RESUME_AFTER_MS) void syncNow({ auto: true })
    })
    clearInterval(timer)
    timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow({ auto: true })
    }, AUTO_EVERY_MS)
  }

  /* ---------------- компьютер ---------------- */
  const pc = shallowRef<DesktopFileSyncState | null>(null)
  const activity = shallowRef<{ device: string; op: string; path?: string; at: number } | null>(null)

  async function loadPc() {
    if (!desktop) return
    pc.value = await desktop.fileSyncState()
  }
  async function setPc(patch: { enabled?: boolean; folder?: string | null; data?: boolean }) {
    if (!desktop) return
    pc.value = await desktop.fileSyncSet(patch)
    await reconcilePc()
  }

  /**
   * Окно компьютера и его общие данные: связь включена и данные общие — окно синхронизирует свои данные
   * с сервером этого же компьютера; выключили — перестаёт. Если данные уже идут через свой сервер в интернете,
   * ничего не трогаем: одно из двух
   */
  async function reconcilePc() {
    const s = pc.value
    if (!desktop || !s) return
    const sync = useSync()
    const want = s.enabled && s.data && s.running
    if (want && !sync.signedIn) {
      const a = await desktop.hubLocal()
      await sync.connectLan(a.base, a.token, s.name)
    } else if (want && sync.mode === 'lan') {
      const a = await desktop.hubLocal()
      await sync.moveLan(a.base)
    } else if (!(s.enabled && s.data) && sync.mode === 'lan' && sync.signedIn) {
      await sync.signOut()
    }
  }
  async function unpairPc(id: string) {
    if (desktop) pc.value = await desktop.fileSyncUnpair(id)
  }
  if (isDesktop) desktop!.onFileSyncActivity((a) => (activity.value = a))

  return {
    link,
    root,
    access,
    status,
    error,
    progress,
    report,
    lastAt,
    paired,
    load,
    checkAccess,
    discover,
    pair,
    unpair,
    chooseRoot,
    syncNow,
    cancel,
    start,
    pc,
    activity,
    loadPc,
    setPc,
    reconcilePc,
    files,
    dataOn,
    setData,
    setFiles,
    unpairPc,
  }
})
