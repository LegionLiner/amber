import { WebPlugin } from '@capacitor/core'
import { APP_VERSION } from '@/app/version'
import type { MusicCorePlugin, MusicCoreWebExtras, WebFolderInfo } from '../music-core'
import type {
  AnalysisProgress,
  AudioKind,
  AudioSettings,
  ControlAction,
  CountingRule,
  DamagedFile,
  DeviceInfo,
  EndReason,
  EngineConfig,
  ExecResult,
  FileResult,
  ImportedFile,
  JunctionPreview,
  LyricsResult,
  MusicPermissionStatus,
  OutputsEvent,
  PlayerSnapshot,
  PlayerStateEvent,
  PlayLoggedEvent,
  QueryResult,
  QueueEdit,
  QueueItem,
  RepeatMode,
  ScanOptions,
  ScanResult,
  SqlStatement,
  SqlValue,
  Transition,
  WriteTagsItem,
  WriteTagsResult,
  YoutubeInfo,
  OutputDevice,
} from '../types'
import { WebDb } from './web-db'
import { buildDemoLibrary, type DemoTrack } from './demo-library'
import { synthWav } from './tone'
import { AudioGraph, showLevelsOf } from './audio-graph'
import type { AnalysisResult } from './analysis'
import type { AnalysisJob, AnalysisMsg, AnalysisReply } from './analysis.worker'
import { pcmSegments } from './pcm-segments'
import { parseV2, sha1Hex, tagSize } from './id3'
import {
  canPickDirectory,
  pickFolder,
  readLocal,
  reopenFolder,
  type DirHandle,
  type FileLike,
  type LocalEntry,
} from './local-files'
import { desktop, isDesktop, mediaUrl } from '../desktop/bridge'
import { DesktopFile } from '../desktop/desktop-file'
import { splitYoutubeTitle } from '@/domain/youtube'
import { fromBase64, isPng, writeId3 } from './id3-writer'
import { defragmentMp4, isFragmentedMp4, sniff, unwrapId3Mp4, writeMp4Tags } from './mp4'
import { loadCovers, saveCover, webCoverUrl } from './web-covers'
import { countedSqlExpr, DEFAULT_COUNTING, isCounted, localParts } from '@/domain/counting'
import { rekeyFixupSql } from '@/data/rekey'
import { $t } from '@/i18n'
import { WAVE_VERSION } from '@/domain/waveform'

interface LiveEvent {
  id: number
  key: string
  startedAt: number
  durationMs: number
  listenedMs: number
  lastTick: number
  lastSaved: number
}

/** Одна «дека»: свой <audio> и свой регулятор громкости в звуковом графе */
interface Deck {
  el: HTMLAudioElement
  gain: GainNode | null
  url: string | null
  qid: string | null
  pendingStart: boolean
}

interface Loud {
  lufs: number | null
  introMs: number
  outroMs: number
  albumKey: string | null
  rg: number | null
}

/** Откуда музыка: демо, папка в браузере или папки на диске компьютера */
type Source = 'demo' | 'folder' | 'desktop'

const DEFAULT_AUDIO: AudioSettings = {
  crossfade: { mode: 'off', durationMs: 5000, curve: 'equalPower', duckDb: -9, smart: true, skipFadeMs: 250 },
  normalization: { mode: 'off', targetLufs: -14 },
  eq: { enabled: false, preampDb: 0, bands: Array(10).fill(0), preset: 'flat' },
  profiles: {},
  autoResume: false,
}

const SOURCE_KEY = 'yantar-web-source'

function readSource(): Source {
  if (isDesktop) return 'desktop'
  try {
    return localStorage.getItem(SOURCE_KEY) === 'folder' ? 'folder' : 'demo'
  } catch {
    return 'demo'
  }
}

function idbFolder(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('yantar-web-folder', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('h')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

/** Папка «Amber», куда ложится скачанное с YouTube: короткие ролики не отсекаются по длительности (как на телефоне) */
const youtubeFolder = (folder: string) => /(^|\/)Amber\/$/i.test(folder)

const SINK_KEY = 'amber.sink'
function readSink(): string {
  try {
    return localStorage.getItem(SINK_KEY) ?? ''
  } catch {
    return ''
  }
}

/** «Динамики (Wireless Stereo Headset) (054c:0d5e)» → «Динамики (Wireless Stereo Headset)» */
function outputName(label: string): string {
  return label
    .replace(/^(Default|По умолчанию) - /i, '')
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
    .trim()
}
function outputKind(label: string): OutputDevice['kind'] {
  if (/bluetooth|airpods|buds|hands-free|jbl/i.test(label)) return 'bluetooth'
  if (/headset|headphone|наушник|гарнитур/i.test(label)) return 'wired'
  if (/usb/i.test(label)) return 'usb'
  return 'speaker'
}

/** Какой трек сейчас анализируется — переживает падение страницы (см. skipCrashedAnalysis) */
const ANALYZING_KEY = 'amber.analyzing'
function markAnalyzing(key: string | null) {
  try {
    if (key) localStorage.setItem(ANALYZING_KEY, key)
    else localStorage.removeItem(ANALYZING_KEY)
  } catch {
    /* без защиты */
  }
}
function analyzingKey(): string | null {
  try {
    return localStorage.getItem(ANALYZING_KEY)
  } catch {
    return null
  }
}

/** Формат по байтам файла целиком */
function sniffBytes(b: Uint8Array): AudioKind {
  const t = tagSize(b.subarray(0, 10))
  return sniff(b.subarray(0, 16), t > 0 ? b.subarray(t, t + 16) : undefined)
}

/** Только заданные поля правки: чтобы не затирать правку из испорченного тега пустыми */
function definedOnly(it: WriteTagsItem) {
  const out: Record<string, string | number> = {}
  for (const k of ['title', 'artist', 'album', 'genre', 'year', 'trackNo'] as const) if (it[k] != null) out[k] = it[k]!
  return out
}

/**
 * Браузерная версия движка: для разработки и для проверки в Docker.
 * Устроена как Kotlin-часть (playback/Engine.kt): две деки, переходы между треками,
 * нормализация по анализу, эквалайзер, учёт прослушиваний по тому же правилу.
 * Музыка: демо-библиотека с синтезированным звуком или своя папка с mp3.
 */
export class MusicCoreWeb extends WebPlugin implements MusicCorePlugin, MusicCoreWebExtras {
  private readonly dbReady = WebDb.open()
  private graph: AudioGraph | null = null
  private readonly decks: [Deck, Deck]
  private activeIdx = 0
  private queue: QueueItem[] = []
  private index = -1
  private rev = 0
  private repeat: RepeatMode = 'off'
  private counting: CountingRule = DEFAULT_COUNTING
  private audio: AudioSettings = DEFAULT_AUDIO
  private live: LiveEvent | null = null
  private orphansClosed = false
  private demo: Map<string, DemoTrack> | null = null

  // своя папка
  private source: Source = readSource()
  private readonly files = new Map<string, { file: FileLike; rel: string }>()
  /** Что последним ушло в трей и заголовок окна (компьютер) */
  private shownNow = ''
  /**
   * Компьютер: очередь и место в треке переживают перезапуск, как на телефоне (PlayerHub.Saved).
   * После запуска трек не загружен, пока не нажмут «играть»: restorePos — откуда продолжить
   */
  private restorePos: number | null = null
  /** Компьютер: выбранное устройство вывода ('' — как в Windows) и как оно называется для профилей и контекстов */
  private sinkId = readSink()
  private sinkIds: string[] = []
  private outputId = 'web'
  private restoreChecked = false
  private queueSaveTimer: ReturnType<typeof setTimeout> | undefined
  private queueSavedAt = 0
  private folder: DirHandle | null = null
  private folderWritable = false
  private pending: LocalEntry[] | null = null

  // громкость треков (как playback/Loudness.kt)
  private readonly loud = new Map<string, Loud>()
  private readonly albumLufs = new Map<string, number>()

  // переходы
  private tail: Deck | null = null
  /** Переход объявлен, но B ещё не зазвучал: A играет в полную, B молчит (как txPending в Engine.kt) */
  private txPending = false
  private txPendingSince = 0
  private txCue = 0
  /** Сколько заводится вторая дека (мерим на переходах): переход объявляется на столько раньше */
  private startLatency = 150
  private txStart = 0
  private txDur = 0
  private txType: Transition['type'] = 'crossfade'
  private txCurve: Transition['curve'] = 'equalPower'
  private txDuck = 0.35
  private fadeOutStart = 0
  private fadeOutDur = 0
  private manualFade = 1
  /** Номер текущего ручного затухания: новое останавливает прежнее, а не борется с ним за громкость */
  private fadeSeq = 0
  /** Пропуск, который ещё уводит звук: следующее нажатие выполняет его сразу (два нажатия — два трека) */
  private skipAct: (() => Promise<void>) | null = null
  /** Идёт смена трека в деке (загрузка файла): монитор не начинает переход по позиции старого трека */
  private switching = 0
  /** Общая громкость приложения (компьютер: ползунок в панели плеера), уже по кривой слуха */
  private master = 1
  private sleepFactor = 1
  private ending = false

  private sleepTimer: ReturnType<typeof setTimeout> | undefined
  private sleepAt = 0
  private sleepEndOfTrack = false
  private abStart = -1
  private abEnd = -1
  private speed = 1
  private pitch = 1
  private effects: Partial<Record<string, number>> = {}
  private readonly monitor: ReturnType<typeof setInterval>

  private analysisQueue: string[] = []
  private analysisBusy = false
  private analysisDone = 0
  private worker: Worker | null = null
  private jobs = new Map<number, (r: AnalysisReply) => void>()
  private jobSeq = 0
  /** Срочные (текущая очередь) идут без пауз, фоновые — с передышкой для интерфейса */
  private urgent = new Set<string>()
  private previewEls: HTMLAudioElement[] = []
  /** Оригиналы файлов до записи тегов (в браузере — до перезагрузки страницы) */
  private readonly tagBackupsMem = new Map<string, Uint8Array>()

  constructor() {
    super()
    this.decks = [this.makeDeck(), this.makeDeck()]
    this.monitor = setInterval(() => this.tick(), 40)
    void loadCovers()
    void this.loadLoudness()
    void this.loadFolderHandle()
    this.setupMediaSession()
    // Кнопки в трее и в миниатюре окна на панели задач
    desktop?.onCommand((cmd) => void this.control({ action: cmd }))
    desktop?.onYtProgress((p) => this.notifyListeners('youtubeProgress', p))
    if (desktop) addEventListener('pagehide', () => this.persistQueue(true))
    if (desktop) {
      // Подключили наушники или выключили колонку — список и подпись обновляются
      navigator.mediaDevices?.addEventListener('devicechange', () => {
        void this.getOutputs().then((o) => {
          this.notifyListeners('outputs', o)
          this.emitState()
        })
      })
      void this.getOutputs().then(() => this.emitState())
    }
  }

  private get active(): Deck {
    return this.decks[this.activeIdx]!
  }

  private get aux(): Deck {
    return this.decks[1 - this.activeIdx]!
  }

  private makeDeck(): Deck {
    const el = new Audio()
    el.preload = 'auto'
    // На компьютере файлы идут по схеме app://; при запуске из vite (localhost) это другой источник
    if (isDesktop) el.crossOrigin = 'anonymous'
    const deck: Deck = { el, gain: null, url: null, qid: null, pendingStart: false }
    el.addEventListener('playing', () => {
      // Дека зазвучала, хотя она ни текущая, ни уходящая в переходе: такой звук никто бы уже не остановил
      if (deck !== this.active && deck !== this.tail) {
        el.pause()
        return
      }
      if (deck !== this.active) return
      if (deck.pendingStart) {
        deck.pendingStart = false
        void this.startEvent()
      }
      if (this.live) this.live.lastTick = performance.now()
      this.emitState()
    })
    for (const ev of ['pause', 'seeked', 'loadedmetadata', 'waiting', 'canplay']) {
      el.addEventListener(ev, () => {
        if (deck === this.active) this.emitState()
      })
    }
    el.addEventListener('ended', () => {
      if (deck === this.tail) this.finishTail()
      else if (deck === this.active) void this.onEnded()
    })
    return deck
  }

  /* ---------------- сервис ---------------- */

  async getInfo(): Promise<DeviceInfo> {
    return {
      platform: 'web',
      sdkInt: 0,
      manufacturer: 'browser',
      model: navigator.userAgent,
      appVersion: APP_VERSION,
      coversDir: '',
      dbRecovery: (await this.dbReady).takeRecovery() ?? undefined,
    }
  }

  async checkPermissions(): Promise<MusicPermissionStatus> {
    return { audio: 'granted', storage: 'granted', notifications: 'granted' }
  }

  async requestPermissions(): Promise<MusicPermissionStatus> {
    return this.checkPermissions()
  }

  async openBatterySettings(): Promise<void> {}

  /* ---------------- база ---------------- */

  async query(o: { sql: string; params?: SqlValue[] }): Promise<QueryResult> {
    return (await this.dbReady).query(o.sql, o.params)
  }

  async execute(o: { sql: string; params?: SqlValue[] }): Promise<ExecResult> {
    return (await this.dbReady).execute(o.sql, o.params)
  }

  async batch(o: { statements: SqlStatement[] }): Promise<{ results: ExecResult[] }> {
    return { results: (await this.dbReady).batch(o.statements) }
  }

  async reloadLoudness(): Promise<void> {
    await this.loadLoudness()
  }

  private async loadLoudness() {
    try {
      const db = await this.dbReady
      if (!db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'analysis'`).values.length) return
      const r = db.query(
        `SELECT t.key, t.album, t.album_artist, t.rg_track_db, a.lufs, a.intro_silence_ms, a.outro_silence_ms
         FROM tracks t LEFT JOIN analysis a ON a.key = t.key`,
      )
      this.loud.clear()
      for (const v of r.values) {
        const album = (v[1] as string | null)?.toLowerCase().trim()
        this.loud.set(String(v[0]), {
          albumKey: album
            ? `${album}|${String(v[2] ?? '')
                .toLowerCase()
                .trim()}`
            : null,
          rg: v[3] as number | null,
          lufs: v[4] as number | null,
          introMs: Number(v[5] ?? 0),
          outroMs: Number(v[6] ?? 0),
        })
      }
      this.recomputeAlbums()
    } catch {
      /* база ещё без схемы: миграции сделает boot */
    }
  }

  private recomputeAlbums() {
    const sums = new Map<string, [number, number]>()
    for (const l of this.loud.values()) {
      if (!l.albumKey || l.lufs == null) continue
      const [s, n] = sums.get(l.albumKey) ?? [0, 0]
      sums.set(l.albumKey, [s + Math.pow(10, l.lufs / 10), n + 1])
    }
    this.albumLufs.clear()
    for (const [a, [s, n]] of sums) this.albumLufs.set(a, 10 * Math.log10(s / n))
  }

  /* ---------------- своя папка (только браузер) ---------------- */

  private demoMap(): Map<string, DemoTrack> {
    if (!this.demo) this.demo = new Map(buildDemoLibrary().map((t) => [t.key, t]))
    return this.demo
  }

  private async loadFolderHandle() {
    try {
      const d = await idbFolder()
      this.folder = await new Promise<DirHandle | null>((resolve) => {
        const r = d.transaction('h', 'readonly').objectStore('h').get('folder')
        r.onsuccess = () => resolve((r.result as DirHandle | undefined) ?? null)
        r.onerror = () => resolve(null)
      })
    } catch {
      this.folder = null
    }
  }

  private async saveFolderHandle(h: DirHandle | null) {
    try {
      const d = await idbFolder()
      const store = d.transaction('h', 'readwrite').objectStore('h')
      if (h) store.put(h, 'folder')
      else store.delete('folder')
    } catch {
      /* без IndexedDB папку придётся выбирать заново */
    }
  }

  private setSource(s: Source) {
    this.source = s
    try {
      localStorage.setItem(SOURCE_KEY, s)
    } catch {
      /* не критично */
    }
  }

  async folderInfo(): Promise<WebFolderInfo> {
    if (desktop) {
      const folders = await desktop.folders()
      return {
        source: 'desktop',
        canPickDirectory: true,
        savedName: folders[0] ?? null,
        loaded: this.files.size,
        needsAccess: false,
        writable: true,
        folders,
      }
    }
    return {
      source: this.source,
      canPickDirectory: canPickDirectory(),
      savedName: this.folder?.name ?? null,
      loaded: this.files.size,
      needsAccess: this.source === 'folder' && this.files.size === 0 && !this.pending,
      writable: this.folderWritable,
    }
  }

  async pickFolder(): Promise<{ count: number }> {
    if (desktop) {
      const folders = await desktop.addFolder()
      if (!folders) throw new Error('cancel')
      return { count: folders.length }
    }
    const { entries, handle } = await pickFolder()
    this.pending = entries
    this.folder = handle
    this.folderWritable = false
    await this.saveFolderHandle(handle)
    this.setSource('folder')
    return { count: entries.length }
  }

  async restoreFolder(): Promise<{ count: number }> {
    if (!this.folder) return { count: 0 }
    const entries = await reopenFolder(this.folder, 'read')
    if (!entries) return { count: 0 }
    this.pending = entries
    return { count: entries.length }
  }

  /** Компьютер: убрать папку из библиотеки (файлы не трогаются) */
  async removeFolder(o: { path: string }): Promise<{ folders: string[] }> {
    return { folders: desktop ? await desktop.removeFolder(o.path) : [] }
  }

  async useDemo(): Promise<void> {
    this.files.clear()
    this.pending = null
    this.folder = null
    await this.saveFolderHandle(null)
    this.setSource('demo')
  }

  /* ---------------- сканирование ---------------- */

  async scan(o: ScanOptions): Promise<ScanResult> {
    const t0 = performance.now()
    const db = await this.dbReady
    const existing = new Set(db.query('SELECT key FROM tracks').values.map((r) => String(r[0])))
    const now = Date.now()
    const statements: SqlStatement[] = []
    const seen = new Set<string>()
    const damaged: DamagedFile[] = []
    // Старый отпечаток → новый (MP4 теперь по аудиоданным): история переедет на новый ключ
    const renamed = new Map<string, string>()
    let added = 0
    const upsert = (row: SqlValue[]) =>
      statements.push({
        sql: `INSERT INTO tracks (key, media_id, uri, path, folder, file_name, size, mtime, title, artist, album, album_artist,
                genre, year, track_no, disc_no, duration_ms, bitrate, sample_rate, mime, art, has_lyrics, rg_track_db,
                rg_album_db, popm, added_at, updated_at, missing_since)
              VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
              ON CONFLICT(key) DO UPDATE SET uri = excluded.uri, path = excluded.path, folder = excluded.folder,
                file_name = excluded.file_name, size = excluded.size, mtime = excluded.mtime, title = excluded.title,
                artist = excluded.artist, album = excluded.album, album_artist = excluded.album_artist,
                genre = excluded.genre, year = excluded.year, track_no = excluded.track_no, disc_no = excluded.disc_no,
                duration_ms = excluded.duration_ms, bitrate = excluded.bitrate, sample_rate = excluded.sample_rate,
                mime = excluded.mime, art = COALESCE(excluded.art, tracks.art), has_lyrics = excluded.has_lyrics,
                rg_track_db = excluded.rg_track_db, rg_album_db = excluded.rg_album_db, popm = excluded.popm,
                updated_at = excluded.updated_at, missing_since = NULL`,
        params: row,
      })

    const excluded = (folder: string) => o.excludeFolders.some((x) => x && folder.toLowerCase().includes(x.toLowerCase()))

    if (this.source === 'desktop' && desktop) {
      // Неизменённые файлы (тот же путь, размер и время) не перечитываем: повторный запуск занимает секунды
      const prev = new Map<string, { key: string; size: number; mtime: number; dur: number; folder: string; missing: boolean }>()
      for (const r of db.query(
        "SELECT key, path, size, mtime, duration_ms, folder, missing_since FROM tracks WHERE uri LIKE 'local://%'",
      ).values) {
        prev.set(String(r[1]), {
          key: String(r[0]),
          size: Number(r[2]),
          mtime: Number(r[3]),
          dur: Number(r[4]),
          folder: String(r[5] ?? ''),
          missing: r[6] != null,
        })
      }
      this.notifyListeners('scanProgress', { phase: 'list', done: 0, total: 0 })
      const list = await desktop.walk()
      this.files.clear()
      const revived: string[] = []
      let i = 0
      for (const e of list) {
        i++
        if (i % 25 === 0) this.notifyListeners('scanProgress', { phase: 'tags', done: i, total: list.length })
        const name = e.rel.slice(e.rel.lastIndexOf('/') + 1)
        const file = new DesktopFile(e.path, name, e.size, e.mtime)
        const p = o.full ? undefined : prev.get(e.rel)
        if (p && p.size === e.size && p.mtime === Math.round(e.mtime / 1000)) {
          if ((p.dur < o.minDurationMs && !youtubeFolder(p.folder)) || excluded(p.folder) || seen.has(p.key)) continue
          seen.add(p.key)
          this.files.set(p.key, { file, rel: e.rel })
          if (p.missing) revived.push(p.key)
          continue
        }
        const t = await readLocal({ file, relPath: e.rel }).catch(() => null)
        if (t?.kind === 'id3+mp4') {
          this.files.set(t.key, { file, rel: e.rel })
          damaged.push({ key: t.key, uri: `local://${t.key}`, path: t.path, name: t.fileName })
          continue
        }
        if (!t || (t.durationMs < o.minDurationMs && !youtubeFolder(t.folder)) || excluded(t.folder) || seen.has(t.key)) continue
        seen.add(t.key)
        if (t.legacyKey) renamed.set(t.legacyKey, t.key)
        this.files.set(t.key, { file, rel: e.rel })
        if (t.art) await saveCover(t.art.hash, t.art.blob)
        if (!existing.has(t.key)) added++
        const g = t.tags
        upsert([
          t.key,
          `local://${t.key}`,
          t.path,
          t.folder,
          t.fileName,
          t.size,
          t.mtime,
          g.title ?? null,
          g.artist ?? null,
          g.album ?? null,
          g.albumArtist ?? null,
          g.genre ?? null,
          g.year ?? null,
          g.trackNo ?? null,
          g.discNo ?? null,
          t.durationMs,
          t.bitrate,
          t.sampleRate,
          t.mime,
          t.art?.hash ?? null,
          g.lyrics || g.synced?.length ? 1 : 0,
          g.rgTrackDb ?? null,
          g.rgAlbumDb ?? null,
          g.popm ?? null,
          now,
          now,
        ])
      }
      for (const k of revived) statements.push({ sql: 'UPDATE tracks SET missing_since = NULL WHERE key = ?', params: [k] })
    } else if (this.source === 'folder') {
      const entries = this.pending
      if (!entries) {
        // Доступ к папке ещё не вернули (после перезагрузки страницы нужен клик): ничего не трогаем
        const total = Number(db.query('SELECT COUNT(*) FROM tracks WHERE missing_since IS NULL').values[0]?.[0] ?? 0)
        return { total, added: 0, updated: 0, unchanged: total, missing: 0, tookMs: 0 }
      }
      this.pending = null
      this.files.clear()
      this.notifyListeners('scanProgress', { phase: 'list', done: 0, total: entries.length })
      let i = 0
      for (const e of entries) {
        i++
        if (i % 10 === 0) this.notifyListeners('scanProgress', { phase: 'tags', done: i, total: entries.length })
        const t = await readLocal(e).catch(() => null)
        if (t?.kind === 'id3+mp4') {
          // Испорченный старой записью тегов: не играется, показываем для починки
          this.files.set(t.key, { file: e.file, rel: e.relPath })
          damaged.push({ key: t.key, uri: `local://${t.key}`, path: t.path, name: t.fileName })
          continue
        }
        if (!t || t.durationMs < o.minDurationMs || excluded(t.folder) || seen.has(t.key)) continue
        seen.add(t.key)
        if (t.legacyKey) renamed.set(t.legacyKey, t.key)
        this.files.set(t.key, { file: e.file, rel: e.relPath })
        if (t.art) await saveCover(t.art.hash, t.art.blob)
        if (!existing.has(t.key)) added++
        const g = t.tags
        upsert([
          t.key,
          `local://${t.key}`,
          t.path,
          t.folder,
          t.fileName,
          t.size,
          t.mtime,
          g.title ?? null,
          g.artist ?? null,
          g.album ?? null,
          g.albumArtist ?? null,
          g.genre ?? null,
          g.year ?? null,
          g.trackNo ?? null,
          g.discNo ?? null,
          t.durationMs,
          t.bitrate,
          t.sampleRate,
          t.mime,
          t.art?.hash ?? null,
          g.lyrics || g.synced?.length ? 1 : 0,
          g.rgTrackDb ?? null,
          g.rgAlbumDb ?? null,
          g.popm ?? null,
          now,
          now,
        ])
      }
    } else {
      for (const t of this.demoMap().values()) {
        if (t.durationMs < o.minDurationMs || excluded(t.folder)) continue
        seen.add(t.key)
        if (!existing.has(t.key)) added++
        upsert([
          t.key,
          t.uri,
          t.path,
          t.folder,
          t.fileName,
          t.size,
          0,
          t.title,
          t.artist,
          t.album,
          null,
          t.genre,
          t.year,
          t.trackNo,
          null,
          t.durationMs,
          t.bitrate,
          t.sampleRate,
          t.mime,
          null,
          1,
          null,
          null,
          null,
          now,
          now,
        ])
      }
    }
    db.batch(statements)
    const aliases = [...renamed].filter(([old]) => existing.has(old))
    if (aliases.length && db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'key_aliases'`).values.length) {
      db.batch([
        ...aliases.map(([o, n]) => ({
          sql: 'INSERT OR REPLACE INTO key_aliases (old, new, at) VALUES (?, ?, ?)',
          params: [o, n, now],
        })),
        ...rekeyFixupSql().map((sql) => ({ sql })),
      ])
      for (const [o] of aliases) existing.delete(o)
    }
    // Чего больше нет (например, демо после выбора своей папки), помечаем пропавшим: история и оценки остаются
    const gone = [...existing].filter((k) => !seen.has(k))
    if (gone.length) {
      db.batch(
        gone.map((k) => ({
          sql: 'UPDATE tracks SET missing_since = COALESCE(missing_since, ?) WHERE key = ?',
          params: [now, k],
        })),
      )
    }
    await this.loadLoudness()
    this.notifyListeners('scanProgress', { phase: 'finish', done: seen.size, total: seen.size })
    return {
      total: seen.size,
      added,
      updated: seen.size - added,
      unchanged: 0,
      missing: gone.length,
      tookMs: Math.round(performance.now() - t0),
      damaged,
    }
  }

  private keyOf(uri: string): string {
    return uri.replace(/^(local|demo):\/\//, '')
  }

  /** Адрес для <audio>: файл с диска — по своей схеме (кусками, с перемоткой), остальное — через blob */
  private async srcFor(uri: string): Promise<string | null> {
    const f = uri.startsWith('local://') ? this.files.get(this.keyOf(uri))?.file : null
    if (f instanceof DesktopFile) return mediaUrl(f.path)
    const blob = await this.blobFor(uri)
    return blob ? URL.createObjectURL(blob as Blob) : null
  }

  private async blobFor(uri: string): Promise<Blob | FileLike | null> {
    const key = this.keyOf(uri)
    if (uri.startsWith('local://')) return this.files.get(key)?.file ?? null
    const d = this.demoMap().get(key)
    return d ? synthWav(d.seed, d.durationMs) : null
  }

  /* ---------------- анализ ---------------- */

  async analyze(o: { keys: string[]; priority: 'now' | 'night' }): Promise<void> {
    const queued = new Set(this.analysisQueue)
    const fresh = o.keys.filter((k) => !queued.has(k))
    if (o.priority === 'now') {
      const urgent = new Set(o.keys)
      for (const k of o.keys) this.urgent.add(k)
      this.analysisQueue = [...o.keys, ...this.analysisQueue.filter((k) => !urgent.has(k))]
    } else {
      this.analysisQueue.push(...fresh)
    }
    void this.runAnalysis()
  }

  /** Сообщение воркеру анализа и его ответ; id задачи общий для всех кусков одного трека */
  private ask(id: number, msg: AnalysisMsg, transfer: Transferable[] = []): Promise<AnalysisReply> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<AnalysisReply>) => {
        this.jobs.get(e.data.id)?.(e.data)
      }
    }
    return new Promise((resolve, reject) => {
      this.jobs.set(id, (r) => {
        this.jobs.delete(id)
        if (r.error) reject(new Error(r.error))
        else resolve(r)
      })
      this.worker!.postMessage({ ...msg, id } as AnalysisJob, transfer)
    })
  }

  /**
   * Анализ трека: демо синтезирует воркер, настоящий файл декодируется кусками (pcm-segments.ts) в 22 кГц
   * и уходит в воркер частями по 30 секунд. В памяти не больше одного куска, сколько бы трек ни длился
   */
  private async analyzeKey(key: string, uri: string): Promise<AnalysisResult | null> {
    const id = ++this.jobSeq
    if (!uri.startsWith('local://')) {
      const d = this.demoMap().get(key)
      return d ? ((await this.ask(id, { kind: 'demo', seed: d.seed, durationMs: d.durationMs })).result ?? null) : null
    }
    const f = this.files.get(key)?.file
    if (!f) return null
    const decode = (bytes: ArrayBuffer) => new OfflineAudioContext(1, 1, 22050).decodeAudioData(bytes)
    let started = false
    for await (const buf of pcmSegments(f, decode)) {
      const chans = Math.min(2, buf.numberOfChannels)
      if (!started) {
        await this.ask(id, { kind: 'start', sampleRate: buf.sampleRate, channels: chans })
        started = true
      }
      const step = buf.sampleRate * 30
      for (let p = 0; p < buf.length; p += step) {
        const channels = Array.from({ length: chans }, (_, c) => buf.getChannelData(c).slice(p, Math.min(buf.length, p + step)))
        await this.ask(
          id,
          { kind: 'push', channels },
          channels.map((c) => c.buffer),
        )
      }
    }
    // Ничего не декодировалось (огромный файл без таблиц, странный формат): пустой итог, чтобы не браться снова
    if (!started) await this.ask(id, { kind: 'start', sampleRate: 22050, channels: 1 })
    return (await this.ask(id, { kind: 'finish' })).result ?? null
  }

  /**
   * Если в прошлый раз страница упала посреди анализа (так было с десятичасовым треком), этот трек
   * получает пустую запись анализа: без громкости и волны, зато больше не роняет приложение при каждом запуске
   */
  private skipCrashedAnalysis(db: WebDb) {
    const key = analyzingKey()
    if (!key) return
    markAnalyzing(null)
    this.analysisQueue = this.analysisQueue.filter((k) => k !== key)
    try {
      db.execute(
        `INSERT OR IGNORE INTO analysis (key, lufs, true_peak_db, intro_silence_ms, outro_silence_ms, waveform, energy, bpm, analyzed_at)
         VALUES (?, NULL, 0, 0, 0, NULL, 0.5, NULL, ?)`,
        [key, Date.now()],
      )
      console.warn('Анализ пропущен: на этом треке приложение упало в прошлый раз', key)
    } catch {
      /* таблицы ещё нет */
    }
  }

  private async runAnalysis() {
    if (this.analysisBusy) return
    this.analysisBusy = true
    try {
      const db = await this.dbReady
      this.skipCrashedAnalysis(db)
      while (this.analysisQueue.length) {
        const key = this.analysisQueue.shift()!
        const row = db.query('SELECT uri FROM tracks WHERE key = ?', [key]).values[0]
        if (row) {
          markAnalyzing(key)
          try {
            const r = await this.analyzeKey(key, String(row[0]))
            if (!r) throw new Error($t('нет файла'))
            db.execute(
              `INSERT OR REPLACE INTO analysis (key, lufs, true_peak_db, intro_silence_ms, outro_silence_ms, waveform,
                 energy, bpm, analyzed_at, wave_v) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [key, r.lufs, r.peakDb, r.introMs, r.outroMs, r.waveform, r.energy, r.bpm, Date.now(), WAVE_VERSION],
            )
            const old = this.loud.get(key)
            this.loud.set(key, {
              lufs: r.lufs,
              introMs: r.introMs,
              outroMs: r.outroMs,
              albumKey: old?.albumKey ?? null,
              rg: old?.rg ?? null,
            })
            this.recomputeAlbums()
            this.applyVolumes()
          } catch (e) {
            console.warn('Анализ не удался', key, e)
          }
          markAnalyzing(null)
        }
        this.analysisDone++
        const p: AnalysisProgress = { done: this.analysisDone, total: this.analysisDone + this.analysisQueue.length, key }
        this.notifyListeners('analysisProgress', p)
        // Фоновый анализ даёт интерфейсу подышать между треками
        const urgent = this.urgent.delete(key)
        await new Promise((r) => setTimeout(r, urgent ? 10 : 250))
      }
    } finally {
      this.analysisBusy = false
    }
  }

  async lyrics(o: { uri: string }): Promise<LyricsResult> {
    const key = this.keyOf(o.uri)
    if (o.uri.startsWith('local://')) {
      const f = this.files.get(key)?.file
      if (!f) return {}
      const size = tagSize(new Uint8Array(await f.slice(0, 10).arrayBuffer()))
      if (!size) return {}
      const t = parseV2(new Uint8Array(await f.slice(0, Math.min(size, 8 * 1024 * 1024)).arrayBuffer()))
      return { text: t?.lyrics, synced: t?.synced }
    }
    // Демо: синхронный текст в формате LRC, чтобы было что проверить в интерфейсе
    const d = this.demoMap().get(key)
    if (!d) return {}
    const words = [
      $t('Ночной проспект уходит вдаль'),
      $t('Горят янтарные огни'),
      $t('И город тихо спит'),
      $t('А мы идём, идём одни'),
      $t('Трамвай звенит за поворотом'),
      $t('И свет в окне ещё не гас'),
    ]
    const lines: string[] = []
    for (let t = 3000, i = 0; t < d.durationMs - 3000; t += 5000, i++) {
      const s = Math.floor(t / 1000)
      lines.push(
        `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.00]${words[(i + d.seed) % words.length]}`,
      )
    }
    return { text: lines.join('\n') }
  }

  /**
   * Запись тегов в файлы. В Chrome и Edge работает для папки, выбранной через «Открыть папку»:
   * браузер один раз спросит разрешение на изменение. Формат определяется по байтам:
   * mp3 — ID3, MP4/AAC (в том числе с расширением .mp3) — теги iTunes. Звук в файле не трогается.
   */
  async writeTags(o: { items: WriteTagsItem[] }): Promise<WriteTagsResult> {
    return this.onFiles(o.items, (bytes, it) => {
      const kind = sniffBytes(bytes)
      if (kind === 'mpeg') return writeId3(bytes, it)
      if (kind === 'mp4') return writeMp4Tags(bytes, it)
      if (kind === 'id3+mp4') {
        const u = unwrapId3Mp4(bytes)!
        return writeMp4Tags(u.mp4, { ...u.edit, ...definedOnly(it) })
      }
      throw new Error($t('Этот формат не поддерживается: правка сохранена в приложении'))
    })
  }

  async repairFiles(o: { items: { key: string; uri: string; path: string }[] }): Promise<WriteTagsResult> {
    return this.onFiles(o.items, (bytes) => {
      const u = unwrapId3Mp4(bytes)
      if (!u) throw new Error($t('Файл не повреждён'))
      return writeMp4Tags(u.mp4, u.edit)
    })
  }

  async restoreTags(o: { items: { key: string; uri: string; path: string }[] }): Promise<WriteTagsResult> {
    return this.onFiles(o.items, (_bytes, it) => {
      const saved = this.tagBackupsMem.get(it.key)
      if (!saved) throw new Error($t('Копии нет'))
      this.tagBackupsMem.delete(it.key)
      return saved
    })
  }

  async youtubeInfo(o: { url: string }): Promise<YoutubeInfo> {
    if (!desktop) throw new Error($t('Загрузка с YouTube работает в приложении на телефоне и на компьютере'))
    const i = await desktop.ytInfo(o.url)
    const [artist, title] = splitYoutubeTitle(i.title, i.uploader)
    return { title, artist, uploader: i.uploader, durationMs: i.durationMs, thumbnail: i.thumbnail }
  }

  /** Компьютер: файл качает yt-dlp в «Музыка/Amber», теги и обложку пишем здесь, как при правке тегов */
  async youtubeDownload(o: {
    url: string
    title?: string
    artist?: string
  }): Promise<{ uri: string; path: string; name: string }> {
    if (!desktop) throw new Error($t('Загрузка с YouTube работает в приложении на телефоне и на компьютере'))
    const title = o.title?.trim() || $t('Без названия')
    const artist = o.artist?.trim() || 'YouTube'
    const r = await desktop.ytDownload(o.url, { title, artist })
    let bytes = await desktop.read(r.path, 0, Number.MAX_SAFE_INTEGER)
    if (sniffBytes(bytes) === 'mp4') {
      // YouTube отдаёт звук фрагментированным MP4: пересобираем в обычный M4A, иначе теги некуда записать
      if (isFragmentedMp4(bytes)) bytes = defragmentMp4(bytes)
      // Альбом = название: иначе трек попадёт в «альбом» по имени папки
      const tagged = writeMp4Tags(bytes, { title, artist, album: title, picture: r.cover ?? undefined })
      await desktop.write(r.path, tagged)
    }
    const name = r.path.split(/[\\/]/).pop() ?? r.path
    return { uri: '', path: r.path, name }
  }

  /** Как deleteFiles на телефоне: файл удаляется из выбранной папки, трек помечается пропавшим */
  async deleteFiles(o: { items: { key: string; uri: string; path: string }[] }): Promise<{ deleted: number }> {
    const db = await this.dbReady
    const folderMode = this.source === 'folder' && !!this.folder
    if (folderMode && !this.folderWritable) {
      const h = this.folder as DirHandle
      let perm = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted'
      if (perm !== 'granted') perm = (await h.requestPermission?.({ mode: 'readwrite' })) ?? 'denied'
      this.folderWritable = perm === 'granted'
      if (!this.folderWritable) throw new Error($t('Нет разрешения на изменение файлов'))
    }
    let deleted = 0
    for (const it of o.items) {
      const f = this.files.get(it.key)
      if (f?.file instanceof DesktopFile) {
        // На компьютере — в корзину: случайное удаление можно отменить
        await desktop!.trash(f.file.path)
        this.files.delete(it.key)
      } else if (folderMode && f) {
        const parts = f.rel.split('/')
        let dir = this.folder as FileSystemDirectoryHandle
        for (const p of parts.slice(1, -1)) dir = await dir.getDirectoryHandle(p)
        await dir.removeEntry(parts[parts.length - 1]!)
        this.files.delete(it.key)
      }
      db.execute('UPDATE tracks SET missing_since = ? WHERE key = ?', [Date.now(), it.key])
      deleted++
    }
    return { deleted }
  }

  /** Как saveCover на телефоне: картинка в IndexedDB под хешем. Цвета для фона здесь не считаем */
  async saveCover(o: { data: string }): Promise<{ art: string; color1?: string | null; color2?: string | null }> {
    const bytes = fromBase64(o.data)
    const art = sha1Hex([bytes]).slice(0, 16)
    await saveCover(art, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: isPng(bytes) ? 'image/png' : 'image/jpeg' }))
    return { art, color1: null, color2: null }
  }

  async tagBackups(): Promise<{ keys: string[] }> {
    return { keys: [...this.tagBackupsMem.keys()] }
  }

  async probeFormats(o: { uris: string[] }): Promise<{ kinds: AudioKind[] }> {
    const kinds: AudioKind[] = []
    for (const uri of o.uris) {
      const f = uri.startsWith('local://') ? this.files.get(this.keyOf(uri))?.file : null
      kinds.push(f ? sniffBytes(new Uint8Array(await f.slice(0, 64 * 1024).arrayBuffer())) : 'unknown')
    }
    return { kinds }
  }

  /** Общий путь изменения файлов: разрешение на запись, копия оригинала, запись, строка в базе */
  private async onFiles(
    items: (WriteTagsItem | { key: string; uri: string; path: string })[],
    change: (bytes: Uint8Array, it: WriteTagsItem) => Uint8Array,
  ): Promise<WriteTagsResult> {
    const failed: WriteTagsResult['failed'] = []
    if (this.source === 'desktop' && desktop) return this.onDiskFiles(items, change)
    if (this.source !== 'folder' || !this.folder) {
      return {
        written: 0,
        failed: items.map((i) => ({ key: i.key, reason: $t('В демо-библиотеке файлов нет: правка сохранена в приложении') })),
      }
    }
    if (!this.folderWritable) {
      const h = this.folder as DirHandle
      let perm = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted'
      if (perm !== 'granted') perm = (await h.requestPermission?.({ mode: 'readwrite' })) ?? 'denied'
      this.folderWritable = perm === 'granted'
      if (!this.folderWritable) {
        return { written: 0, failed: items.map((i) => ({ key: i.key, reason: $t('Нет разрешения на изменение файлов') })) }
      }
    }
    let written = 0
    const db = await this.dbReady
    for (const raw of items) {
      const it = raw as WriteTagsItem
      const f = this.files.get(it.key)
      if (!f) {
        failed.push({ key: it.key, reason: $t('Файл не найден в выбранной папке') })
        continue
      }
      try {
        const handle = await this.fileHandle(f.rel)
        const bytes = new Uint8Array(await f.file.arrayBuffer())
        const out = change(bytes, it)
        this.tagBackupsMem.set(it.key, bytes)
        const w = await (
          handle as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }
        ).createWritable()
        await w.write(out as Uint8Array<ArrayBuffer>)
        await w.close()
        const fresh = await handle.getFile()
        this.files.set(it.key, { file: fresh, rel: f.rel })
        db.execute(
          `UPDATE tracks SET title = COALESCE(?, title), artist = COALESCE(?, artist), album = COALESCE(?, album),
             genre = COALESCE(?, genre), year = COALESCE(?, year), track_no = COALESCE(?, track_no),
             size = ?, mtime = ?, missing_since = NULL, updated_at = ? WHERE key = ?`,
          [
            it.title ?? null,
            it.artist ?? null,
            it.album ?? null,
            it.genre ?? null,
            it.year ?? null,
            it.trackNo ?? null,
            fresh.size,
            Math.round(fresh.lastModified / 1000),
            Date.now(),
            it.key,
          ],
        )
        // Новая обложка уже в файле — показываем её сразу
        if (it.picture) {
          const { art } = await this.saveCover({ data: it.picture })
          db.execute('UPDATE tracks SET art = ? WHERE key = ?', [art, it.key])
          db.execute('UPDATE track_user SET custom_art = NULL WHERE key = ?', [it.key])
        }
        written++
      } catch (e) {
        failed.push({ key: it.key, reason: e instanceof Error ? e.message : String(e) })
      }
    }
    return { written, failed }
  }

  /** То же для файлов на диске компьютера: запись через главный процесс, без запросов разрешений */
  private async onDiskFiles(
    items: (WriteTagsItem | { key: string; uri: string; path: string })[],
    change: (bytes: Uint8Array, it: WriteTagsItem) => Uint8Array,
  ): Promise<WriteTagsResult> {
    const failed: WriteTagsResult['failed'] = []
    let written = 0
    const db = await this.dbReady
    for (const raw of items) {
      const it = raw as WriteTagsItem
      const f = this.files.get(it.key)
      if (!(f?.file instanceof DesktopFile)) {
        failed.push({ key: it.key, reason: $t('Файл не найден в папках с музыкой') })
        continue
      }
      try {
        const bytes = new Uint8Array(await f.file.arrayBuffer())
        const out = change(bytes, it)
        this.tagBackupsMem.set(it.key, bytes)
        const st = await desktop!.write(f.file.path, out)
        this.files.set(it.key, { file: new DesktopFile(f.file.path, f.file.name, st.size, st.mtime), rel: f.rel })
        db.execute(
          `UPDATE tracks SET title = COALESCE(?, title), artist = COALESCE(?, artist), album = COALESCE(?, album),
             genre = COALESCE(?, genre), year = COALESCE(?, year), track_no = COALESCE(?, track_no),
             size = ?, mtime = ?, missing_since = NULL, updated_at = ? WHERE key = ?`,
          [
            it.title ?? null,
            it.artist ?? null,
            it.album ?? null,
            it.genre ?? null,
            it.year ?? null,
            it.trackNo ?? null,
            st.size,
            Math.round(st.mtime / 1000),
            Date.now(),
            it.key,
          ],
        )
        if (it.picture) {
          const { art } = await this.saveCover({ data: it.picture })
          db.execute('UPDATE tracks SET art = ? WHERE key = ?', [art, it.key])
          db.execute('UPDATE track_user SET custom_art = NULL WHERE key = ?', [it.key])
        }
        written++
      } catch (e) {
        failed.push({ key: it.key, reason: e instanceof Error ? e.message : String(e) })
      }
    }
    return { written, failed }
  }

  private async fileHandle(rel: string): Promise<FileSystemFileHandle> {
    const parts = rel.split('/')
    // Первая часть пути — имя самой выбранной папки
    let dir = this.folder as FileSystemDirectoryHandle
    for (const p of parts.slice(1, -1)) dir = await dir.getDirectoryHandle(p)
    return dir.getFileHandle(parts[parts.length - 1]!)
  }

  /* ---------------- звук ---------------- */

  async configure(o: EngineConfig): Promise<void> {
    this.counting = o.counting
    if (!this.orphansClosed) {
      this.orphansClosed = true
      await this.closeOrphans()
    }
  }

  /**
   * Прослушивания, оставшиеся открытыми с прошлого запуска (окно закрыли посреди трека, компьютер выключили):
   * закрываются тем, что успели дослушать, — как на телефоне при старте движка. Без этого они не попадали
   * в статистику, а синхронизация ждала их вечно («Ждёт отправки: …»)
   */
  private async closeOrphans() {
    const db = await this.dbReady
    db.execute(
      `UPDATE play_events SET end_reason = 'stopped', ended_at = COALESCE(ended_at, started_at + listened_ms),
         counted = ${countedSqlExpr(this.counting)}
       WHERE end_reason IS NULL AND id != ?`,
      [this.live?.id ?? -1],
    )
  }

  async setAudioSettings(o: AudioSettings): Promise<void> {
    this.audio = o
    this.applyEq()
    this.applyVolumes()
  }

  private applyEq() {
    if (!this.graph) return
    const eq = this.audio.profiles[desktop ? this.outputId : 'web']?.eq ?? this.audio.eq
    this.graph.setEq(eq.enabled, eq.bands, eq.preampDb, this.audio.normalization.mode !== 'off' ? 6 : 0)
  }

  private async ensureGraph() {
    if (!this.graph) {
      try {
        this.graph = new AudioGraph()
        showLevelsOf(this.graph)
        for (const d of this.decks) d.gain = this.graph.connect(d.el)
        if (this.sinkId) await this.applySink(this.sinkId)
        this.applyEq()
        this.applyVolumes()
        this.graph.setEffects(this.effects)
      } catch (e) {
        console.warn('Web Audio недоступен: играем без эквалайзера', e)
        this.graph = null
      }
    }
    await this.graph?.resume()
  }

  /** Как Loudness.normalizationDb + Engine.gainOf на телефоне */
  private gainFor(item: QueueItem | undefined): number {
    if (!item) return 1
    const n = this.audio.normalization
    let db = 0
    if (n.mode !== 'off') {
      const l = this.loud.get(item.key)
      const useAlbum = n.mode === 'album' || (n.mode === 'smart' && item.source.type === 'album')
      const lufs = useAlbum && l?.albumKey ? (this.albumLufs.get(l.albumKey) ?? l.lufs) : l?.lufs
      if (lufs != null) db = n.targetLufs - lufs
      else if (l?.rg != null) db = l.rg + (n.targetLufs + 18)
    }
    const boost = n.mode !== 'off' && this.graph ? 6 : 0
    return Math.min(1, Math.pow(10, (db + item.gainDb - boost) / 20))
  }

  private setDeckVolume(d: Deck, v: number) {
    const x = Math.max(0, Math.min(1, v))
    if (d.gain) {
      // Громкость меняется раз в 40 мс; скачками это слышно как треск, поэтому каждое значение
      // догоняется плавно (постоянная времени 12 мс)
      d.gain.gain.setTargetAtTime(x, d.gain.context.currentTime, 0.012)
      d.el.volume = 1
    } else {
      d.el.volume = x
    }
  }

  private itemOf(d: Deck): QueueItem | undefined {
    return d.qid ? this.queue.find((q) => q.qid === d.qid) : undefined
  }

  private curves(t: number): [number, number] {
    switch (this.txCurve) {
      case 'linear':
        return [t, 1 - t]
      case 'sCurve':
        return [0.5 - 0.5 * Math.cos(Math.PI * t), 0.5 + 0.5 * Math.cos(Math.PI * t)]
      default:
        return [Math.sin((t * Math.PI) / 2), Math.cos((t * Math.PI) / 2)]
    }
  }

  /** Ползунок 0…1 → громкость по кривой слуха: середина ползунка звучит как «вдвое тише», а не почти как максимум */
  async setVolume(o: { volume: number }): Promise<void> {
    const v = Math.max(0, Math.min(1, o.volume))
    this.master = v * v
    this.applyVolumes()
  }

  private applyVolumes() {
    const common = this.sleepFactor * this.manualFade * this.master
    const a = this.active
    const t = this.tail
    if (!t) {
      let f = 1
      if (this.fadeOutStart) f = 1 - Math.min(1, (performance.now() - this.fadeOutStart) / this.fadeOutDur)
      this.setDeckVolume(a, this.gainFor(this.itemOf(a)) * f * common)
      this.setDeckVolume(this.aux, 0)
      return
    }
    if (this.txPending) {
      this.setDeckVolume(a, 0)
      this.setDeckVolume(t, this.gainFor(this.itemOf(t)) * common)
      return
    }
    const x = Math.min(1, (performance.now() - this.txStart) / this.txDur)
    let inF: number
    let outF: number
    if (this.txType === 'overlay') {
      // B входит почти сразу, A отходит на второй план и уходит в конце
      inF = Math.min(1, x / 0.08)
      outF = x < 0.15 ? 1 - (1 - this.txDuck) * (x / 0.15) : x < 0.75 ? this.txDuck : this.txDuck * (1 - (x - 0.75) / 0.25)
    } else {
      ;[inF, outF] = this.curves(x)
    }
    this.setDeckVolume(a, this.gainFor(this.itemOf(a)) * inF * common)
    this.setDeckVolume(t, this.gainFor(this.itemOf(t)) * outF * common)
  }

  private transitionFor(prev: QueueItem, next: QueueItem): Transition {
    if (next.transitionIn) return next.transitionIn
    const c = this.audio.crossfade
    if (c.mode === 'off') return { type: 'gapless', durationMs: 0, curve: c.curve }
    const sequential =
      c.smart && !!prev.album && prev.album === next.album && prev.trackNo != null && next.trackNo === prev.trackNo + 1
    if (sequential) return { type: 'gapless', durationMs: 0, curve: c.curve }
    return { type: c.mode, durationMs: c.durationMs, curve: c.curve, duckDb: c.duckDb }
  }

  private nextIndex(): number {
    if (this.index + 1 < this.queue.length) return this.index + 1
    return this.repeat === 'all' && this.queue.length ? 0 : -1
  }

  private effectiveEnd(d: Deck, item: QueueItem): number {
    const dur = Number.isFinite(d.el.duration) && d.el.duration > 0 ? d.el.duration * 1000 : item.durationMs
    const trimmed = item.trimEndMs ? Math.min(item.trimEndMs, dur) : dur
    return trimmed - Math.min(15_000, this.loud.get(item.key)?.outroMs ?? 0)
  }

  private cueIn(item: QueueItem, tx: Transition): number {
    // В миксе точка входа выбрана руками — ровно с неё, без пропуска тишины
    if (item.transitionIn) return item.trimStartMs ?? 0
    const intro = tx.type === 'crossfade' || tx.type === 'overlay' ? (this.loud.get(item.key)?.introMs ?? 0) : 0
    return Math.max(item.trimStartMs ?? 0, Math.min(10_000, intro))
  }

  /** Раз в 40 мс, как монитор в Engine.kt */
  private tick() {
    this.accumulate()
    // Страховки от звука, который никто не остановит: вторая дека вне перехода молчит,
    // а уходящий трек не играет дальше, если новый уже поставили на паузу
    if (!this.tail && !this.aux.el.paused) this.aux.el.pause()
    if (this.tail && !this.txPending && this.active.el.paused) this.finishTail()
    if (this.switching) return
    if (desktop && !this.active.el.paused && performance.now() - this.queueSavedAt > 10_000) this.persistQueue(true)
    if (this.tail) {
      const now = performance.now()
      if (this.txPending) {
        // B пошёл, когда позиция сдвинулась от точки входа; дольше 1,5 с не ждём
        const b = this.active
        const started = !b.el.paused && b.el.currentTime * 1000 >= this.txCue + 30
        if (started || now - this.txPendingSince > 1500) {
          this.txPending = false
          this.txStart = now
          if (started) this.startLatency = Math.min(800, Math.max(0, (this.startLatency + (now - this.txPendingSince)) / 2))
        }
      }
      this.applyVolumes()
      if (!this.txPending && now - this.txStart >= this.txDur) this.finishTail()
      return
    }
    const a = this.active
    if (a.el.paused || !a.qid || this.ending) return
    const pos = a.el.currentTime * 1000
    if (this.abStart >= 0 && this.abEnd > this.abStart) {
      if (pos >= this.abEnd) a.el.currentTime = this.abStart / 1000
      return
    }
    const cur = this.queue[this.index]
    if (!cur) return
    if (cur.trimEndMs && pos >= cur.trimEndMs) {
      a.el.pause()
      void this.onEnded()
      return
    }
    if (this.fadeOutStart) {
      this.applyVolumes()
      // Затихло — сразу следующий с его точки входа, а не тишина до конца файла
      if (performance.now() - this.fadeOutStart >= this.fadeOutDur) {
        a.el.pause()
        void this.onEnded()
      }
      return
    }
    if (this.repeat === 'one' || this.sleepEndOfTrack) return
    const ni = this.nextIndex()
    const next = this.queue[ni]
    if (!next) return
    const tx = this.transitionFor(cur, next)
    if (tx.type === 'gapless' || tx.type === 'cut') {
      // Точка выхода микса: дальше этот трек не звучит
      if (tx.outAtMs != null && pos >= tx.outAtMs) {
        a.el.pause()
        void this.onEnded()
      }
      return
    }
    const end = this.effectiveEnd(a, cur)
    const dur = Math.min(tx.durationMs, end / 2)
    const at = tx.outAtMs ?? end - dur
    if (tx.type === 'fadeOutIn') {
      if (pos >= at) {
        this.fadeOutStart = performance.now()
        this.fadeOutDur = Math.max(500, dur)
      }
      return
    }
    if (pos >= at - 20_000) void this.prepareAux(next, tx)
    if (pos >= at - this.startLatency && this.aux.qid === next.qid && this.aux.url) void this.startTransition(ni, tx, dur)
  }

  private async prepareAux(next: QueueItem, tx: Transition) {
    const b = this.aux
    if (b.qid === next.qid) return
    b.qid = next.qid
    this.setDeckVolume(b, 0)
    if (!(await this.load(b, next))) return
    const cue = this.cueIn(next, tx)
    if (cue > 0) {
      const apply = () => (b.el.currentTime = cue / 1000)
      if (b.el.readyState >= 1) apply()
      else b.el.addEventListener('loadedmetadata', apply, { once: true })
    }
  }

  private async startTransition(ni: number, tx: Transition, dur: number) {
    const a = this.active
    const b = this.aux
    if (this.tail) return
    this.tail = a
    // Кривая пойдёт, когда B реально зазвучит (см. tick): иначе A успевает притихнуть, пока B заводится
    this.txPending = true
    this.txPendingSince = performance.now()
    this.txCue = b.el.currentTime * 1000
    this.txStart = this.txPendingSince
    this.txDur = Math.max(500, dur)
    this.txType = tx.type
    this.txCurve = tx.curve
    this.txDuck = Math.pow(10, (tx.duckDb ?? -9) / 20)
    // Прослушивание уходящего трека закрывается сразу (время учтено до переключения деки),
    // а запись в базу не задерживает старт B
    const closing = this.finishEvent('crossfade', a)
    this.activeIdx = 1 - this.activeIdx
    this.index = ni
    b.pendingStart = true
    this.applyRate(b)
    this.applyVolumes()
    await b.el.play().catch(() => undefined)
    await closing
    this.afterIndexChange()
  }

  private finishTail() {
    const t = this.tail
    if (!t) return
    this.tail = null
    this.txPending = false
    t.el.pause()
    this.setDeckVolume(t, 0)
    t.qid = null
    this.applyVolumes()
  }

  /** Досрочно завершить переход и затухания (пауза, перемотка, ручной выбор) */
  private settle() {
    if (this.tail) this.finishTail()
    this.fadeOutStart = 0
    this.fadeSeq++
    this.manualFade = 1
    this.applyVolumes()
  }

  private applyRate(d: Deck) {
    d.el.playbackRate = this.speed
    // Web Audio не умеет менять высоту отдельно: либо сохраняем тон, либо тон едет вместе со скоростью
    ;(d.el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = Math.abs(this.pitch - this.speed) > 0.001
  }

  /** Файл трека в деку. false — пока он загружался, деке уже назначили другой трек: эта загрузка не нужна */
  private async load(d: Deck, item: QueueItem): Promise<boolean> {
    if (d.url) URL.revokeObjectURL(d.url)
    d.url = null
    const src = await this.srcFor(item.uri)
    // Два переключения подряд: файл первого может найтись позже второго — он не должен заиграть вместо него
    if (d.qid !== item.qid) {
      if (src?.startsWith('blob:')) URL.revokeObjectURL(src)
      return false
    }
    if (!src) {
      d.el.removeAttribute('src')
      if (item.uri.startsWith('local://')) this.notifyListeners('folderAccess', {})
      return true
    }
    d.url = src
    d.el.src = d.url
    this.applyRate(d)
    return true
  }

  /* ---------------- очередь и управление ---------------- */

  async setQueue(o: { items: QueueItem[]; index: number; positionMs?: number; play?: boolean }) {
    this.restorePos = null
    this.settle()
    await this.finishEvent('replaced')
    this.queue = o.items.slice()
    this.rev++
    this.aux.qid = null
    await this.open(o.index, o.play ?? true, o.positionMs ?? 0)
    return { rev: this.rev }
  }

  async editQueue(o: { edits: QueueEdit[] }) {
    for (const e of o.edits) {
      if (e.op === 'insert') {
        this.queue.splice(e.at, 0, ...e.items)
        if (e.at <= this.index) this.index += e.items.length
      } else if (e.op === 'move') {
        const [item] = this.queue.splice(e.from, 1)
        if (!item) continue
        this.queue.splice(e.to, 0, item)
        if (e.from === this.index) this.index = e.to
        else if (e.from < this.index && e.to >= this.index) this.index--
        else if (e.from > this.index && e.to <= this.index) this.index++
      } else if (e.op === 'replaceUpcoming') {
        this.queue.splice(this.index + 1, this.queue.length, ...e.items)
      } else if (e.op === 'remove') {
        if (e.index === this.index) {
          const wasPlaying = !this.active.el.paused
          this.settle()
          await this.finishEvent('skipped')
          this.queue.splice(e.index, 1)
          if (!this.queue.length) {
            this.index = -1
            this.active.el.pause()
            this.active.qid = null
          } else {
            await this.open(Math.min(e.index, this.queue.length - 1), wasPlaying, 0)
          }
        } else {
          this.queue.splice(e.index, 1)
          if (e.index < this.index) this.index--
        }
      }
    }
    // Подготовленный следующий трек мог смениться
    if (!this.tail) this.aux.qid = null
    this.rev++
    this.emitState()
    return { rev: this.rev }
  }

  async skipTo(o: { index: number; play?: boolean }) {
    // Выбрали трек сами — недоделанный пропуск («следующий») уже не нужен
    this.skipAct = null
    if (o.index === this.index) return
    this.settle()
    await this.finishEvent('skipped')
    await this.open(o.index, o.play ?? true, 0)
  }

  async control(o: { action: ControlAction }): Promise<void> {
    this.stopPreview()
    switch (o.action) {
      case 'play':
        await this.ensureGraph()
        if (this.restorePos != null && this.index >= 0 && !this.active.qid) {
          const pos = this.restorePos
          this.restorePos = null
          await this.open(this.index, true, pos)
        } else if (this.index < 0 && this.queue.length) await this.open(0, true, 0)
        else if (this.active.qid) {
          if (this.active.el.ended) this.active.el.currentTime = (this.queue[this.index]?.trimStartMs ?? 0) / 1000
          this.applyRate(this.active)
          await this.active.el.play().catch(() => undefined)
        }
        break
      case 'pause':
        this.settle()
        this.active.el.pause()
        break
      case 'toggle':
        if (this.active.el.paused) await this.control({ action: 'play' })
        else {
          this.settle()
          this.active.el.pause()
        }
        break
      case 'next':
      case 'prev':
        await this.skip(o.action === 'next')
        break
      case 'stop':
        this.settle()
        await this.finishEvent('stopped')
        this.active.el.pause()
        this.active.el.currentTime = 0
        break
    }
    this.emitState()
  }

  /** Ручной пропуск с коротким затуханием, как Engine.skip */
  private async skip(next: boolean) {
    // Прошлое нажатие ещё уводит звук — выполняем его сразу: два быстрых «следующий» дают два трека,
    // а не два перехода, которые грузят файлы в одну деку наперегонки
    const pending = this.skipAct
    this.skipAct = null
    if (pending) await pending()
    this.settle()
    const a = this.active
    const act = async () => {
      if (!next && a.el.currentTime > 3) {
        await this.finishEvent('replaced')
        a.el.currentTime = (this.queue[this.index]?.trimStartMs ?? 0) / 1000
        if (!a.el.paused) await this.startEvent()
        else a.pendingStart = true
        return
      }
      let ni = this.index + (next ? 1 : -1)
      if (ni >= this.queue.length) ni = this.repeat === 'all' ? 0 : -1
      if (ni < 0 && !next) ni = 0
      if (ni < 0) return
      await this.finishEvent('skipped')
      await this.open(ni, true, 0)
    }
    if (next && this.nextIndex() < 0) return
    const ms = this.audio.crossfade.skipFadeMs
    if (a.el.paused || !ms) return act()
    this.skipAct = act
    await this.fade(1, 0, ms)
    // За время затухания его уже выполнило следующее нажатие или отменил выбор трека
    if (this.skipAct !== act) return
    this.skipAct = null
    await act()
    void this.fade(0, 1, ms)
  }

  private fade(from: number, to: number, ms: number): Promise<void> {
    const t0 = performance.now()
    const my = ++this.fadeSeq
    return new Promise((resolve) => {
      const step = () => {
        // Началось другое затухание — это уступает ему
        if (my !== this.fadeSeq) return resolve()
        const x = Math.min(1, (performance.now() - t0) / ms)
        this.manualFade = from + (to - from) * x
        this.applyVolumes()
        // setTimeout, а не requestAnimationFrame: в фоновой вкладке кадры не идут, и затухание зависло бы
        if (x < 1) setTimeout(step, 16)
        else resolve()
      }
      step()
    })
  }

  async seekTo(o: { positionMs: number }): Promise<void> {
    // Трек после перезапуска ещё не загружен: запоминаем, откуда начать
    if (this.restorePos != null && !this.active.qid) {
      this.restorePos = o.positionMs
      this.emitState()
      return
    }
    this.settle()
    this.active.el.currentTime = o.positionMs / 1000
  }

  async setRepeat(o: { mode: RepeatMode }): Promise<void> {
    this.repeat = o.mode
    this.emitState()
  }

  async getState(): Promise<PlayerSnapshot> {
    if (!this.restoreChecked) this.restoreQueue()
    return { ...this.stateEvent(), queue: this.queue.slice() }
  }

  private static readonly QUEUE_KEY = 'amber.queue'

  private restoreQueue() {
    this.restoreChecked = true
    if (!desktop || this.queue.length) return
    try {
      const saved = JSON.parse(localStorage.getItem(MusicCoreWeb.QUEUE_KEY) ?? 'null') as {
        items: QueueItem[]
        index: number
        positionMs: number
      } | null
      if (!saved?.items?.length) return
      this.queue = saved.items
      this.index = Math.max(0, Math.min(saved.items.length - 1, saved.index))
      this.restorePos = Math.max(0, saved.positionMs || 0)
      this.rev++
    } catch {
      /* испорченная запись — начинаем с пустой очереди */
    }
  }

  /** Очередь и позиция на диск: при каждом изменении (с задержкой) и раз в 10 секунд во время игры */
  private persistQueue(now = false) {
    if (!desktop || !this.restoreChecked) return
    clearTimeout(this.queueSaveTimer)
    const write = () => {
      this.queueSavedAt = performance.now()
      try {
        const positionMs = this.restorePos ?? Math.round(this.active.el.currentTime * 1000)
        localStorage.setItem(MusicCoreWeb.QUEUE_KEY, JSON.stringify({ items: this.queue, index: this.index, positionMs }))
      } catch {
        /* переполнено — не страшно, просто не продолжим с этого места */
      }
    }
    if (now) write()
    else this.queueSaveTimer = setTimeout(write, 800)
  }

  async setFavoriteState(): Promise<void> {}

  /* Папка по Wi-Fi: на компьютере её раздаёт главный процесс (desktop/filesync.ts), забирает только телефон */
  private noFs(): never {
    throw new Error($t('Только на телефоне'))
  }
  async fsAccess() {
    return { granted: false, name: null }
  }
  async fsPickFolder(): Promise<{ root: string; name: string }> {
    return this.noFs()
  }
  async fsDiscover() {
    return { found: [] }
  }
  /** Только телефон: компьютер и браузер ходят в сеть сами (fetch) */
  async lanRequest(): Promise<never> {
    return this.noFs()
  }
  async lanEventsOpen(): Promise<never> {
    return this.noFs()
  }
  async lanEventsClose(): Promise<void> {}
  async lanVpn() {
    return { active: false }
  }

  async fsHello(): Promise<never> {
    return this.noFs()
  }
  async fsPair(): Promise<never> {
    return this.noFs()
  }
  async fsRemoteList(): Promise<never> {
    return this.noFs()
  }
  async fsRemoteHash(): Promise<never> {
    return this.noFs()
  }
  async fsRemoteTrash(): Promise<never> {
    return this.noFs()
  }
  async fsLocalList(): Promise<never> {
    return this.noFs()
  }
  async fsLocalHash(): Promise<never> {
    return this.noFs()
  }
  async fsLocalTrash(): Promise<never> {
    return this.noFs()
  }
  async fsPull(): Promise<never> {
    return this.noFs()
  }
  async fsPush(): Promise<never> {
    return this.noFs()
  }
  async fsCleanTrash(): Promise<void> {}

  /** На компьютере и в браузере отдельного движка нет: связь держит интерфейс (stores/remote.ts) */
  async remoteLink(): Promise<void> {}

  async setSleepTimer(o: { minutes?: number; endOfTrack?: boolean }): Promise<void> {
    clearTimeout(this.sleepTimer)
    this.sleepAt = 0
    this.sleepEndOfTrack = !!o.endOfTrack
    if (o.minutes && o.minutes > 0) {
      this.sleepAt = Date.now() + o.minutes * 60_000
      this.sleepTimer = setTimeout(() => void this.sleepNow(), o.minutes * 60_000)
    }
    this.emitState()
  }

  /** 15 секунд плавного затухания, потом пауза */
  private async sleepNow() {
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        this.sleepFactor = Math.max(0, 1 - (performance.now() - t0) / 15_000)
        this.applyVolumes()
        if (this.sleepFactor <= 0) {
          clearInterval(iv)
          resolve()
        }
      }, 100)
    })
    this.settle()
    this.active.el.pause()
    this.sleepFactor = 1
    this.sleepAt = 0
    this.applyVolumes()
    this.emitState()
  }

  async setAbLoop(o: { startMs?: number; endMs?: number }): Promise<void> {
    this.abStart = o.startMs ?? -1
    this.abEnd = o.endMs ?? -1
  }

  /** Как Engine.setPlaybackParams: короткий провал громкости прячет стык при смене скорости */
  async setPlaybackParams(o: { speed: number; pitch: number }): Promise<void> {
    if (o.speed === this.speed && o.pitch === this.pitch) return
    const apply = () => {
      this.speed = o.speed
      this.pitch = o.pitch
      for (const d of this.decks) this.applyRate(d)
      this.emitState()
    }
    if (this.active.el.paused || this.tail) return apply()
    await this.fade(this.manualFade, 0, 60)
    apply()
    await new Promise((r) => setTimeout(r, 120))
    await this.fade(0, 1, 160)
  }

  /* ---------------- вывод ---------------- */

  async getOutputs(): Promise<OutputsEvent> {
    if (!desktop || !navigator.mediaDevices) {
      return { devices: [{ id: 0, name: $t('Браузер'), kind: 'speaker' }], preferred: null, current: 'web' }
    }
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')
    const def = all.find((d) => d.deviceId === 'default')
    // Windows показывает одно устройство несколько раз (по умолчанию, связь, само устройство)
    const seen = new Set<string>()
    const list = all.filter((d) => {
      if (d.deviceId === 'default' || d.deviceId === 'communications') return false
      const name = outputName(d.label)
      if (!name || seen.has(name)) return false
      seen.add(name)
      return true
    })
    this.sinkIds = list.map((d) => d.deviceId)
    let preferred: number | null = this.sinkId ? this.sinkIds.indexOf(this.sinkId) : null
    if (preferred === -1) {
      // Выбранное устройство отключили: звук идёт туда, куда решит Windows
      preferred = null
      await this.applySink('')
    }
    const name = preferred != null ? outputName(list[preferred]!.label) : outputName(def?.label ?? '')
    this.outputId = `pc:${name}`
    this.applyEq()
    return {
      devices: list.map((d, i) => ({ id: i, name: outputName(d.label), kind: outputKind(d.label) })),
      preferred,
      current: this.outputId,
    }
  }

  private async applySink(id: string) {
    this.sinkId = id
    try {
      localStorage.setItem(SINK_KEY, id)
    } catch {
      /* не запомним — не страшно */
    }
    type Sinkable = { setSinkId?(id: string): Promise<void> }
    for (const d of this.decks) await (d.el as unknown as Sinkable).setSinkId?.(id).catch(() => undefined)
    if (this.graph) await (this.graph.ctx as unknown as Sinkable).setSinkId?.(id).catch(() => undefined)
  }

  async setOutput(o: { deviceId: number | null }): Promise<void> {
    if (!desktop) return
    await this.applySink(o.deviceId == null ? '' : (this.sinkIds[o.deviceId] ?? ''))
    const outs = await this.getOutputs()
    this.notifyListeners('outputs', outs)
    this.emitState()
  }

  async openSystemOutputSwitcher(): Promise<void> {}

  /** На компьютере «Сцена» уходит в полноэкранный режим сама (ZenMode), поворачивать нечего */
  async setStage(): Promise<void> {}

  /* ---------------- предпрослушивание ---------------- */

  private stopPreview() {
    for (const el of this.previewEls) {
      el.pause()
      if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src)
    }
    this.previewEls = []
  }

  private async previewEl(uri: string): Promise<HTMLAudioElement | null> {
    const src = await this.srcFor(uri)
    if (!src) return null
    const el = new Audio()
    if (isDesktop) el.crossOrigin = 'anonymous'
    el.src = src
    this.previewEls.push(el)
    await new Promise<void>((resolve) => {
      if (el.readyState >= 1) return resolve()
      el.addEventListener('loadedmetadata', () => resolve(), { once: true })
      el.addEventListener('error', () => resolve(), { once: true })
    })
    return el
  }

  private pauseMain() {
    this.settle()
    this.active.el.pause()
  }

  async previewSnippet(o: { uri: string; fromMs: number; durationMs: number; gainDb?: number }): Promise<void> {
    this.stopPreview()
    this.pauseMain()
    const el = await this.previewEl(o.uri)
    if (!el) return
    const gain = Math.min(1, Math.pow(10, (o.gainDb ?? 0) / 20))
    el.currentTime = o.fromMs / 1000
    el.volume = 0
    await el.play().catch(() => undefined)
    const t0 = performance.now()
    const step = () => {
      if (!this.previewEls.includes(el)) return
      const t = performance.now() - t0
      el.volume = Math.max(0, Math.min(1, t / 600, (o.durationMs - t) / 600)) * gain
      if (t >= o.durationMs) {
        this.stopPreview()
        this.notifyListeners('previewEnded', {})
        return
      }
      requestAnimationFrame(step)
    }
    step()
  }

  /** Стык двух треков как в миксе: leadMs до точки перехода и tailMs после */
  async previewJunction(o: JunctionPreview): Promise<void> {
    this.stopPreview()
    this.pauseMain()
    const a = await this.previewEl(o.aUri)
    const b = await this.previewEl(o.bUri)
    if (!a || !b) return
    const lead = Math.min(o.leadMs, o.atMs)
    a.currentTime = (o.atMs - lead) / 1000
    b.currentTime = o.cueMs / 1000
    b.volume = 0
    await a.play().catch(() => undefined)
    const t0 = performance.now()
    const duck = Math.pow(10, o.duckDb / 20)
    let bStarted = false
    const step = () => {
      if (!this.previewEls.includes(a)) return
      const el = performance.now() - t0
      if (el >= lead && !bStarted) {
        bStarted = true
        if (o.type === 'gapless' || o.type === 'cut') {
          a.pause()
          b.volume = 1
        }
        if (o.type !== 'fadeOutIn') void b.play()
      }
      if (bStarted && o.type !== 'gapless' && o.type !== 'cut') {
        const x = Math.min(1, (el - lead) / Math.max(1, o.durationMs))
        let inF: number
        let outF: number
        if (o.type === 'overlay') {
          inF = Math.min(1, x / 0.08)
          outF = x < 0.15 ? 1 - (1 - duck) * (x / 0.15) : x < 0.75 ? duck : duck * (1 - (x - 0.75) / 0.25)
        } else if (o.type === 'fadeOutIn') {
          outF = 1 - x
          inF = x >= 1 ? 1 : 0
          if (x >= 1 && b.paused) void b.play()
        } else if (o.curve === 'linear') {
          ;[inF, outF] = [x, 1 - x]
        } else if (o.curve === 'sCurve') {
          ;[inF, outF] = [0.5 - 0.5 * Math.cos(Math.PI * x), 0.5 + 0.5 * Math.cos(Math.PI * x)]
        } else {
          ;[inF, outF] = [Math.sin((x * Math.PI) / 2), Math.cos((x * Math.PI) / 2)]
        }
        a.volume = Math.max(0, Math.min(1, outF))
        b.volume = Math.max(0, Math.min(1, inF))
      }
      if (el >= lead + o.tailMs) {
        this.stopPreview()
        this.notifyListeners('previewEnded', {})
        return
      }
      requestAnimationFrame(step)
    }
    step()
  }

  async previewStop(): Promise<void> {
    this.stopPreview()
  }

  /* ---------------- файлы ---------------- */

  private download(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  async exportFile(o: { name: string; data: string; mime?: string; base64?: boolean }): Promise<FileResult> {
    const bytes = o.base64 ? Uint8Array.from(atob(o.data), (c) => c.charCodeAt(0)) : new TextEncoder().encode(o.data)
    if (desktop) {
      const path = await desktop.saveFile(o.name, bytes)
      if (!path) throw new Error('cancel')
      return { uri: path }
    }
    this.download(o.name, new Blob([bytes], { type: o.mime ?? 'application/json' }))
    return { uri: `download://${o.name}` }
  }

  async importFile(): Promise<ImportedFile> {
    if (desktop) {
      const f = await desktop.openFile(['json'])
      if (!f) throw new Error('cancel')
      return { name: f.name, data: new TextDecoder().decode(f.data) }
    }
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      input.onchange = async () => {
        const f = input.files?.[0]
        if (!f) return reject(new Error($t('Файл не выбран')))
        resolve({ name: f.name, data: await f.text() })
      }
      input.click()
    })
  }

  /** В браузере нет постоянной папки: копия скачивается файлом */
  async chooseBackupFolder(): Promise<{ uri: string }> {
    if (desktop) {
      const folder = await desktop.chooseFolder($t('Папка для бэкапов'))
      if (!folder) throw new Error('cancel')
      return { uri: folder }
    }
    return { uri: 'download' }
  }

  async writeBackup(o: { folderUri?: string; json: string; keep?: number }): Promise<{ uri: string }> {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const name = `amber-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`
    // Компьютер: настоящая папка, как на телефоне; хранятся последние keep копий
    if (desktop && o.folderUri && o.folderUri !== 'download') {
      return { uri: await desktop.writeBackup(o.folderUri, name, o.json, o.keep ?? 14) }
    }
    this.download(name, new Blob([o.json], { type: 'application/json' }))
    return { uri: `download://${name}` }
  }

  /* ---------------- внутреннее ---------------- */

  /** Открыть трек очереди на активной деке */
  private async open(index: number, play: boolean, positionMs: number) {
    const item = this.queue[index]
    this.index = item ? index : -1
    const d = this.active
    this.ending = false
    if (!item) {
      d.el.pause()
      d.qid = null
      this.emitState()
      return
    }
    // Деку сразу забирает новый трек: старый замолкает, а более ранний open увидит, что опоздал
    d.qid = item.qid
    d.el.pause()
    this.switching++
    try {
      if (play) await this.ensureGraph()
      if (!(await this.load(d, item))) return
      d.pendingStart = true
      const start = positionMs || item.trimStartMs || 0
      if (start > 0) d.el.addEventListener('loadedmetadata', () => (d.el.currentTime = start / 1000), { once: true })
      this.applyVolumes()
      if (play && d.url) await d.el.play().catch(() => undefined)
    } finally {
      this.switching--
    }
    if (d.qid !== item.qid) return
    this.afterIndexChange()
  }

  private afterIndexChange() {
    this.updateMediaSession()
    this.emitState()
    // Анализ ближайших треков — чтобы нормализация и переходы знали громкость и тишину
    const keys = this.queue
      .slice(Math.max(0, this.index), this.index + 4)
      .map((q) => q.key)
      .filter((k) => this.loud.get(k)?.lufs == null)
    if (keys.length) void this.analyze({ keys, priority: 'now' })
    const left = this.queue.length - this.index - 1
    if (this.queue[this.index]?.source.type === 'radio' && left <= 10) this.notifyListeners('queueLow', { left })
  }

  private async onEnded() {
    if (this.ending) return
    this.ending = true
    try {
      await this.finishEvent('completed')
      this.fadeOutStart = 0
      if (this.sleepEndOfTrack) {
        this.sleepEndOfTrack = false
        this.emitState()
        return
      }
      if (this.repeat === 'one') {
        const a = this.active
        a.el.currentTime = (this.queue[this.index]?.trimStartMs ?? 0) / 1000
        a.pendingStart = true
        await a.el.play().catch(() => undefined)
        return
      }
      const ni = this.nextIndex()
      if (ni < 0) {
        this.emitState()
        return
      }
      await this.open(ni, true, 0)
    } finally {
      this.ending = false
    }
  }

  private async startEvent() {
    const item = this.queue[this.index]
    if (!item) return
    await this.finishEvent('replaced')
    const now = Date.now()
    const p = localParts(now)
    const db = await this.dbReady
    const r = db.execute(
      `INSERT INTO play_events (track_key, started_at, tz_offset, local_day, local_hour, weekday, listened_ms,
         pos_start_ms, duration_ms, source_type, source_id, output)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'web')`,
      [
        item.key,
        now,
        p.tzOffset,
        p.localDay,
        p.localHour,
        p.weekday,
        Math.round(this.active.el.currentTime * 1000),
        item.durationMs,
        item.source.type,
        item.source.id ?? null,
      ],
    )
    this.live = {
      id: r.lastId,
      key: item.key,
      startedAt: now,
      durationMs: item.durationMs,
      listenedMs: 0,
      lastTick: performance.now(),
      lastSaved: now,
    }
  }

  /** Время слушания копится только пока трек реально играет; на ускорении — с учётом скорости */
  private accumulate() {
    const live = this.live
    if (!live) return
    const t = performance.now()
    const el = this.active.el
    if (!el.paused) {
      const d = t - live.lastTick
      if (d > 0 && d < 2500) live.listenedMs += d * (el.playbackRate || 1)
    }
    live.lastTick = t
    if (Date.now() - live.lastSaved >= 10_000) {
      live.lastSaved = Date.now()
      void this.dbReady.then((db) =>
        db.execute('UPDATE play_events SET listened_ms = ?, pos_end_ms = ? WHERE id = ?', [
          Math.round(live.listenedMs),
          Math.round(el.currentTime * 1000),
          live.id,
        ]),
      )
    }
  }

  private async finishEvent(reason: EndReason, deck: Deck = this.active) {
    const live = this.live
    if (!live) return
    this.accumulate()
    this.live = null
    const listenedMs = Math.round(live.listenedMs)
    const counted = isCounted(this.counting, live.durationMs, listenedMs)
    // Пропуск после того, как трек уже засчитан, — это дослушанный трек
    const endReason: EndReason = reason === 'skipped' && counted ? 'completed' : reason
    ;(await this.dbReady).execute(
      'UPDATE play_events SET ended_at = ?, listened_ms = ?, pos_end_ms = ?, end_reason = ?, counted = ? WHERE id = ?',
      [Date.now(), listenedMs, Math.round(deck.el.currentTime * 1000), endReason, counted ? 1 : 0, live.id],
    )
    const e: PlayLoggedEvent = { id: live.id, key: live.key, startedAt: live.startedAt, listenedMs, endReason, counted }
    this.notifyListeners('playLogged', e)
  }

  async setEffects(o: { effects: Partial<Record<string, number>> }): Promise<void> {
    this.effects = { ...o.effects }
    // Эффекты живут в Web Audio: граф нужен, даже если эквалайзер выключен
    if (Object.keys(this.effects).length) await this.ensureGraph()
    this.graph?.setEffects(this.effects)
    this.emitState()
  }

  private stateEvent(): PlayerStateEvent {
    const el = this.active.el
    const item = this.queue[this.index]
    return {
      rev: this.rev,
      index: this.index,
      playing: !el.paused,
      buffering: !el.paused && el.readyState < 3,
      positionMs: this.restorePos != null && !this.active.qid ? this.restorePos : Math.round(el.currentTime * 1000),
      positionAt: Date.now(),
      durationMs: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : (item?.durationMs ?? 0),
      repeat: this.repeat,
      sleepAt: this.sleepAt,
      sleepEndOfTrack: this.sleepEndOfTrack,
      speed: this.speed,
      pitch: this.pitch,
      effects: this.effects,
      output: desktop ? this.outputId : 'web',
      transitionMs: this.tail ? (this.txPending ? this.txDur : Math.max(0, this.txDur - (performance.now() - this.txStart))) : 0,
    }
  }

  private emitState() {
    this.notifyListeners('state', this.stateEvent())
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = this.active.el.paused ? 'paused' : 'playing'
    if (desktop) {
      this.persistQueue()
      const item = this.queue[this.index]
      const now = { playing: !this.active.el.paused, title: item?.title ?? '', artist: item?.artist ?? '' }
      const sig = JSON.stringify(now)
      if (sig !== this.shownNow) {
        this.shownNow = sig
        desktop.nowPlaying(now)
      }
    }
  }

  private setupMediaSession() {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => void this.control({ action: 'play' }))
    ms.setActionHandler('pause', () => void this.control({ action: 'pause' }))
    ms.setActionHandler('nexttrack', () => void this.control({ action: 'next' }))
    ms.setActionHandler('previoustrack', () => void this.control({ action: 'prev' }))
  }

  private updateMediaSession() {
    if (!('mediaSession' in navigator)) return
    const item = this.queue[this.index]
    if (!item) return
    // Обложка для плитки «Сейчас играет» Windows (громкость, клавиши мультимедиа, экран блокировки)
    let artwork: MediaImage[] | undefined
    void this.dbReady.then((db) => {
      const art = db.query('SELECT art FROM tracks WHERE key = ?', [item.key]).values[0]?.[0]
      const src = art ? webCoverUrl(String(art)) : null
      if (src) artwork = [{ src, sizes: '512x512' }]
      if (this.queue[this.index]?.qid !== item.qid) return
      navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.artist, album: item.album, artwork })
    })
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.artist, album: item.album })
  }

  async destroy() {
    clearInterval(this.monitor)
  }
}
