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
  let loaded = false
  let ctl: AbortController | null = null
  let timer = 0

  async function load() {
    if (!isNative || loaded) return
    loaded = true
    const raw = await getState('link')
    link.value = raw ? (JSON.parse(raw) as Link) : null
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
    link.value = { base, token: r.token, pcId: r.id, pcName: r.name }
    // Новый компьютер — память о прошлых проходах к нему не относится
    await run(`DELETE FROM filesync_base`)
    await setStates({ link: JSON.stringify(link.value), pairKey: null, report: null, lastAt: null })
    report.value = null
    lastAt.value = null
  }

  async function unpair() {
    ctl?.abort()
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
    try {
      const h = await MusicCore.fsHello({ base: l.base })
      if (h.id === l.pcId) return l
    } catch {
      /* не отвечает — ищем */
    }
    const found = (await discover()).find((f) => f.id === l.pcId)
    if (!found) return null
    const moved = { ...l, base: baseUrl(found.host, found.port) }
    link.value = moved
    await setStates({ link: JSON.stringify(moved) })
    return moved
  }

  /** Один проход. auto — по расписанию: «компьютер не в сети» тогда не ошибка */
  async function syncNow(opts: { confirmDeletes?: boolean; auto?: boolean } = {}) {
    if (!isNative || status.value === 'running' || !link.value || !root.value) return
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
  async function setPc(patch: { enabled?: boolean; folder?: string | null }) {
    if (desktop) pc.value = await desktop.fileSyncSet(patch)
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
    unpairPc,
  }
})
