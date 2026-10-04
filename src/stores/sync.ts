import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import { all, batch } from '@/data/db'
import { isNative } from '@/native/paths'
import { isDesktop } from '@/native/desktop/bridge'
import type { SyncDb } from '@/sync/kinds'
import { disableSync, enableSync, pendingCount, runSync } from '@/sync/engine'
import { ApiError, SyncApi, normalizeUrl, type Me } from '@/sync/api'
import { useSettings, type AppSettings } from './settings'
import { useLibrary } from './library'
import { usePlaylists } from './playlists'

/**
 * Синхронизация с твоим сервером Amber (server/). Работает молча:
 * — при запуске, раз в несколько минут, после своих изменений (через полминуты) и как только появилась сеть;
 * — без сети всё работает как раньше, изменения копятся в журнале и уходят при следующей связи;
 * — ошибки не всплывают сообщениями, видны только в настройках («Синхронизация»).
 *
 * Адрес сервера, почта и токен входа хранятся в таблице sync_state базы, а не в настройках:
 * настройки уходят в бэкап JSON, токену там не место.
 */

/** Какие настройки общие для всех устройств. Тема, папки, звук устройства — у каждого свои */
const SHARED_PREFS = [
  'counting',
  'soundPresets',
  'radio',
  'askRatingAfterPlays',
  'shuffleKind',
  'showLyrics',
] as const satisfies readonly (keyof AppSettings)[]

const PERIOD_MS = 3 * 60 * 1000
const AFTER_CHANGE_MS = 30 * 1000

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error' | 'auth'

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
  if (isDesktop) return { name: 'Компьютер', platform: 'desktop' }
  if (isNative) return { name: 'Телефон', platform: 'android' }
  return { name: 'Браузер', platform: 'web' }
}

export const useSync = defineStore('sync', () => {
  const url = ref('')
  const email = ref('')
  const token = ref<string | null>(null)
  const status = ref<SyncStatus>('off')
  const error = ref('')
  const lastAt = ref<number | null>(null)
  const pending = ref(0)
  const me = ref<Me | null>(null)
  const signedIn = computed(() => !!token.value)

  let running: Promise<void> | null = null
  let timer = 0
  let changeTimer = 0
  let failures = 0
  let started = false

  const api = () => new SyncApi(url.value, token.value)

  async function load() {
    url.value = (await getState('url')) ?? ''
    email.value = (await getState('email')) ?? ''
    token.value = await getState('token')
    lastAt.value = Number(await getState('lastAt')) || null
    status.value = token.value ? 'idle' : 'off'
    if (token.value) pending.value = await pendingCount(sdb)
  }

  /** Вход или регистрация. После — всё, что есть на устройстве, отправляется на сервер */
  async function signIn(serverUrl: string, mail: string, password: string, create: boolean, code?: string) {
    const base = normalizeUrl(serverUrl)
    if (!base) throw new Error('Укажи адрес сервера')
    const a = new SyncApi(base)
    await a.health()
    const r = create ? await a.register(mail, password, deviceName(), code) : await a.login(mail, password, deviceName())
    url.value = base
    email.value = r.email
    token.value = r.token
    await setStates({ url: base, email: r.email, token: r.token })
    await enableSync(sdb)
    status.value = 'idle'
    failures = 0
    start()
    await syncNow()
  }

  /** Выйти на этом устройстве: данные остаются, синхронизация выключается */
  async function signOut() {
    const a = api()
    token.value = null
    status.value = 'off'
    me.value = null
    clearTimeout(timer)
    await a.logout().catch(() => undefined)
    await disableSync(sdb)
    await setStates({ token: null, lastAt: null })
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

  /** Один проход синхронизации; если уже идёт — ждём его */
  function syncNow(): Promise<void> {
    if (!token.value || status.value === 'auth') return Promise.resolve()
    if (running) return running
    running = (async () => {
      status.value = 'syncing'
      try {
        const report = await runSync(sdb, api(), { readPrefs, applyPrefs })
        lastAt.value = Date.now()
        failures = 0
        status.value = 'idle'
        error.value = ''
        await setStates({ lastAt: String(lastAt.value) })
        // Пришли чужие изменения — перечитываем то, что показывается сейчас
        const k = report.kinds
        if (['track', 'card', 'play', 'rate', 'duel'].some((x) => k.has(x))) await useLibrary().load()
        if (k.has('playlist')) await usePlaylists().refresh()
      } catch (e) {
        failures++
        handleError(e)
      } finally {
        pending.value = await pendingCount(sdb).catch(() => pending.value)
        running = null
        schedule()
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

  /** Что-то поменялось на устройстве — синхронизируем через полминуты, собрав пачку изменений */
  function noteChange() {
    if (!token.value) return
    clearTimeout(changeTimer)
    changeTimer = window.setTimeout(async () => {
      pending.value = await pendingCount(sdb).catch(() => pending.value)
      if (pending.value > 0) void syncNow()
    }, AFTER_CHANGE_MS)
  }

  /** Запуск расписания: при старте приложения и после входа */
  function start() {
    if (started) return
    started = true
    window.addEventListener('online', () => void syncNow())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - (lastAt.value ?? 0) > 60_000) void syncNow()
    })
    // Изменения не всегда идут через интерфейс (на телефоне прослушивания пишет Kotlin): раз в минуту смотрим журнал
    window.setInterval(() => noteChange(), 60_000)
  }

  return {
    url,
    email,
    status,
    error,
    lastAt,
    pending,
    me,
    signedIn,
    load,
    signIn,
    signOut,
    deleteAccount,
    loadMe,
    forgetDevice,
    syncNow,
    noteChange,
    start,
  }
})
