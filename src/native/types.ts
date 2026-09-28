/**
 * Типы контракта между интерфейсом (TS) и нативным движком (Kotlin).
 * Kotlin-часть живёт в android/app/src/main/java/app/yantar/player/.
 * Любое изменение здесь нужно зеркально сделать в MusicCorePlugin.kt и в веб-моке.
 */

export type SqlValue = string | number | null

export interface QueryResult {
  columns: string[]
  values: SqlValue[][]
}

export interface ExecResult {
  changes: number
  lastId: number
}

export interface SqlStatement {
  sql: string
  params?: SqlValue[]
}

export interface DeviceInfo {
  platform: 'android' | 'web'
  sdkInt: number
  manufacturer: string
  model: string
  appVersion: string
  /** Абсолютный путь к папке с обложками (file://…), для convertFileSrc */
  coversDir: string
}

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
export type MusicPermissionAlias = 'audio' | 'storage' | 'notifications'

export interface MusicPermissionStatus {
  audio: PermissionState
  storage: PermissionState
  notifications: PermissionState
}

/* ---------------- библиотека ---------------- */

export interface ScanOptions {
  /** Перечитать теги у всех файлов, а не только у изменённых */
  full?: boolean
  /** Файлы короче этого не попадают в библиотеку */
  minDurationMs: number
  /** Относительные пути папок-исключений, например «Recordings/Call/» */
  excludeFolders: string[]
}

export interface ScanResult {
  total: number
  added: number
  updated: number
  unchanged: number
  missing: number
  tookMs: number
  /** Файлы, испорченные старой записью тегов (ID3 перед MP4): не играются, их можно починить */
  damaged?: DamagedFile[]
}

export interface DamagedFile {
  key: string
  uri: string
  path: string
  name: string
}

/** Что лежит в файле на самом деле, по байтам */
export type AudioKind = 'mpeg' | 'mp4' | 'flac' | 'ogg' | 'wav' | 'id3+mp4' | 'unknown'

export interface ScanProgress {
  phase: 'list' | 'tags' | 'finish'
  done: number
  total: number
}

/* ---------------- воспроизведение ---------------- */

export type SourceType =
  | 'library'
  | 'album'
  | 'artist'
  | 'folder'
  | 'genre'
  | 'playlist'
  | 'smart'
  | 'favorites'
  | 'top'
  | 'search'
  | 'radio'
  | 'era'
  | 'context'
  | 'track'

export interface PlaySource {
  type: SourceType
  id?: string
  title?: string
}

export type TransitionType = 'gapless' | 'crossfade' | 'overlay' | 'fadeOutIn' | 'cut'
export type FadeCurve = 'linear' | 'equalPower' | 'sCurve'

export interface Transition {
  type: TransitionType
  durationMs: number
  curve: FadeCurve
  /** Где в предыдущем треке начинать переход (по умолчанию: конец минус длительность) */
  outAtMs?: number
  /** Для наложения: насколько приглушить предыдущий трек */
  duckDb?: number
}

export interface QueueItem {
  /** Уникален внутри очереди: один и тот же трек может стоять дважды */
  qid: string
  /** Отпечаток трека (track_key) */
  key: string
  uri: string
  title: string
  artist: string
  album?: string
  /** file:// путь к обложке 1080 px, для уведомления и экрана блокировки */
  artUri?: string
  durationMs: number
  /** Поправка громкости для нормализации, дБ */
  gainDb: number
  trimStartMs?: number
  trimEndMs?: number
  /** Как этот трек входит после предыдущего */
  transitionIn?: Transition
  source: PlaySource
  /** Добавлен вручную («играть следующим» / «в очередь») */
  manual?: boolean
  /** Номер в альбоме: соседние треки альбома движок стыкует без паузы */
  trackNo?: number
}

export type RepeatMode = 'off' | 'all' | 'one'

export type QueueEdit =
  | { op: 'insert'; at: number; items: QueueItem[] }
  | { op: 'move'; from: number; to: number }
  | { op: 'remove'; index: number }
  /** Заменить всё после текущего трека, не трогая то, что играет (перемешивание, очистка) */
  | { op: 'replaceUpcoming'; items: QueueItem[] }

export type ControlAction = 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'stop'

export interface PlayerStateEvent {
  /** Ревизия очереди: если не совпала с нашей, берём полный снимок через getState() */
  rev: number
  index: number
  playing: boolean
  buffering: boolean
  positionMs: number
  /** Когда измерена позиция (Date.now() на стороне движка) */
  positionAt: number
  durationMs: number
  repeat: RepeatMode
  /** Сон-таймер: когда остановится музыка (0 = выключен) */
  sleepAt: number
  /** Сон-таймер «после этого трека» */
  sleepEndOfTrack: boolean
  speed?: number
  pitch?: number
  /** Включённые эффекты и их сила 0..1 (domain/effects) */
  effects?: Partial<Record<string, number>>
  /** Куда идёт звук: bt:<имя>, wired, usb, speaker, web */
  output?: string
  /** Идёт переход между треками: сколько он ещё продлится, мс (0 — перехода нет) */
  transitionMs?: number
}

export interface PlayerSnapshot extends PlayerStateEvent {
  queue: QueueItem[]
}

export type EndReason = 'completed' | 'skipped' | 'stopped' | 'crossfade' | 'error' | 'replaced'

export interface PlayLoggedEvent {
  id: number
  key: string
  startedAt: number
  listenedMs: number
  endReason: EndReason
  counted: boolean
}

/** Правило «что считать прослушиванием»; по умолчанию как у Last.fm */
export interface CountingRule {
  minTrackMs: number
  minFraction: number
  minListenMs: number
}

export interface EngineConfig {
  counting: CountingRule
}

export interface NotificationActionEvent {
  action: 'favorite'
  key: string
  value: boolean
}

export interface FileResult {
  uri: string
}

export interface ImportedFile {
  name: string
  data: string
}

/* ---------------- звук ---------------- */

export interface CrossfadeSettings {
  /** off — стык как есть; crossfade — кроссфейд; overlay — наложение; fadeOutIn — затухание и вход */
  mode: 'off' | 'crossfade' | 'overlay' | 'fadeOutIn'
  durationMs: number
  curve: FadeCurve
  /** Насколько приглушать предыдущий трек при наложении */
  duckDb: number
  /** Соседние треки одного альбома по порядку идут без паузы */
  smart: boolean
  /** Короткое затухание при ручном пропуске (0 — выключено) */
  skipFadeMs: number
}

export interface NormalizationSettings {
  mode: 'off' | 'track' | 'album' | 'smart'
  targetLufs: number
}

export interface EqSettings {
  enabled: boolean
  preampDb: number
  /** 10 полос: 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Гц */
  bands: number[]
  preset: string
}

export interface DeviceProfile {
  eq: EqSettings
}

export interface AudioSettings {
  crossfade: CrossfadeSettings
  normalization: NormalizationSettings
  eq: EqSettings
  /** Профили под устройства вывода: ключ как в OutputsEvent.current (bt:AirPods Pro, speaker, wired) */
  profiles: Record<string, DeviceProfile>
  /** Продолжать, когда подключились наушники */
  autoResume: boolean
}

export interface OutputDevice {
  id: number
  name: string
  kind: 'speaker' | 'wired' | 'usb' | 'bluetooth'
}

export interface OutputsEvent {
  devices: OutputDevice[]
  preferred: number | null
  current: string
}

/** Ролик YouTube: что про него известно до загрузки */
export interface YoutubeInfo {
  title: string
  artist: string
  uploader: string
  durationMs: number
  thumbnail: string | null
}

export interface YoutubeProgress {
  stage: 'download' | 'save'
  done: number
  total: number
}

export interface AnalysisProgress {
  done: number
  total: number
  key: string
}

export interface LyricsResult {
  text?: string
  synced?: { t: number; line: string }[]
}

export interface WriteTagsItem {
  key: string
  uri: string
  path: string
  title?: string
  artist?: string
  album?: string
  genre?: string
  year?: number
  trackNo?: number
  /** Новая обложка, base64 JPEG/PNG */
  picture?: string
}

export interface WriteTagsResult {
  written: number
  failed: { key: string; reason: string }[]
}

export interface JunctionPreview {
  aUri: string
  atMs: number
  bUri: string
  cueMs: number
  type: TransitionType
  durationMs: number
  curve: FadeCurve
  duckDb: number
  leadMs: number
  tailMs: number
}
