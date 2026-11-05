import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import type {
  AnalysisProgress,
  AudioKind,
  AudioSettings,
  ControlAction,
  DeviceInfo,
  EngineConfig,
  ExecResult,
  FileResult,
  ImportedFile,
  JunctionPreview,
  LyricsResult,
  MusicPermissionAlias,
  MusicPermissionStatus,
  NotificationActionEvent,
  OutputsEvent,
  PlayerSnapshot,
  PlayerStateEvent,
  PlayLoggedEvent,
  QueryResult,
  QueueEdit,
  QueueItem,
  RepeatMode,
  ScanOptions,
  ScanProgress,
  ScanResult,
  SqlStatement,
  SqlValue,
  WriteTagsItem,
  WriteTagsResult,
  YoutubeInfo,
  YoutubeProgress,
} from './types'

/**
 * Весь интерфейс нативной части. Реализации:
 *  - Android: android/app/src/main/java/app/yantar/player/core/MusicCorePlugin.kt
 *  - браузер (для разработки и Docker): src/native/web/MusicCoreWeb.ts
 */
export interface MusicCorePlugin {
  getInfo(): Promise<DeviceInfo>
  checkPermissions(): Promise<MusicPermissionStatus>
  requestPermissions(options?: { permissions?: MusicPermissionAlias[] }): Promise<MusicPermissionStatus>
  openBatterySettings(): Promise<void>

  // база: единственный путь к SQLite
  query(options: { sql: string; params?: SqlValue[] }): Promise<QueryResult>
  execute(options: { sql: string; params?: SqlValue[] }): Promise<ExecResult>
  batch(options: { statements: SqlStatement[] }): Promise<{ results: ExecResult[] }>
  /** Перечитать громкость треков в движке (после импорта или ручной поправки) */
  reloadLoudness(): Promise<void>

  // библиотека
  scan(options: ScanOptions): Promise<ScanResult>
  /** Анализ громкости, тишины и волны: now — сразу, night — на зарядке или при открытом приложении */
  analyze(options: { keys: string[]; priority: 'now' | 'night' }): Promise<void>
  lyrics(options: { uri: string; path?: string }): Promise<LyricsResult>
  /** Записать теги в сами файлы (Android спросит разрешение на изменение). mp3 — ID3, m4a/AAC — теги MP4 */
  writeTags(options: { items: WriteTagsItem[] }): Promise<WriteTagsResult>
  /** Какой формат на самом деле у файлов (по байтам, не по расширению) */
  probeFormats(options: { uris: string[] }): Promise<{ kinds: AudioKind[] }>
  /** Починить файлы «ID3 + MP4», испорченные старой записью тегов */
  repairFiles(options: { items: { key: string; uri: string; path: string }[] }): Promise<WriteTagsResult>
  /** Вернуть файлы к состоянию до последней записи тегов */
  restoreTags(options: { items: { key: string; uri: string; path: string }[] }): Promise<WriteTagsResult>
  /** Для каких треков есть копия до записи тегов */
  tagBackups(): Promise<{ keys: string[] }>
  /** YouTube по ссылке: название, автор, обложка (единственная онлайн-функция, только на телефоне) */
  youtubeInfo(options: { url: string }): Promise<YoutubeInfo>
  /** Скачать звук ролика в «Музыка/Amber» с тегами и обложкой; ход — событиями youtubeProgress */
  youtubeDownload(options: { url: string; title?: string; artist?: string }): Promise<{ uri: string; path: string; name: string }>
  /** Удалить файлы треков (Android спрашивает подтверждение). История остаётся, трек уходит из медиатеки */
  deleteFiles(options: { items: { key: string; uri: string; path: string }[] }): Promise<{ deleted: number }>
  /** Своя картинка (base64) в общую папку обложек: ключ для CoverArt и цвета для фона */
  saveCover(options: { data: string }): Promise<{ art: string; color1?: string | null; color2?: string | null }>

  // воспроизведение: TS решает, что играть, движок решает, как
  configure(options: EngineConfig): Promise<void>
  setAudioSettings(options: AudioSettings): Promise<void>
  setQueue(options: { items: QueueItem[]; index: number; positionMs?: number; play?: boolean }): Promise<{ rev: number }>
  editQueue(options: { edits: QueueEdit[] }): Promise<{ rev: number }>
  skipTo(options: { index: number; play?: boolean }): Promise<void>
  control(options: { action: ControlAction }): Promise<void>
  seekTo(options: { positionMs: number }): Promise<void>
  setRepeat(options: { mode: RepeatMode }): Promise<void>
  getState(): Promise<PlayerSnapshot>
  /** ❤ поменяли в интерфейсе: обновить кнопку в уведомлении */
  setFavoriteState(options: { key: string; value: boolean }): Promise<void>
  /** Сон-таймер: минуты или «после этого трека»; без параметров выключает */
  setSleepTimer(options: { minutes?: number; endOfTrack?: boolean }): Promise<void>
  /** Повтор отрезка A–B; без параметров выключает */
  setAbLoop(options: { startMs?: number; endMs?: number }): Promise<void>
  setPlaybackParams(options: { speed: number; pitch: number }): Promise<void>
  /** Эффекты звука: сила каждого 0..1, отсутствующий — выключен */
  setEffects(options: { effects: Partial<Record<string, number>> }): Promise<void>

  // папка с музыкой по Wi-Fi (только телефон: android/.../filesync/FileSync.kt; компьютерная половина — desktop/filesync.ts)
  /** Есть ли доступ «ко всем файлам» */
  fsAccess(): Promise<{ granted: boolean }>
  /** Открыть настройки Android, где его дают */
  fsRequestAccess(): Promise<void>
  fsDefaultRoot(): Promise<{ root: string }>
  fsPickFolder(): Promise<{ root: string }>
  /** Послушать маячки компьютеров в сети */
  fsDiscover(options: { ms: number }): Promise<{ found: { host: string; port: number; id: string; name: string }[] }>
  fsHello(options: { base: string }): Promise<{ app: string; id: string; name: string; folder: string | null; data?: boolean }>
  fsPair(options: { base: string; code: string; name: string }): Promise<{ token: string; id: string; name: string }>
  fsRemoteList(options: { base: string; token: string }): Promise<{ folderId: string; files: FsEntry[] }>
  fsRemoteHash(options: { base: string; token: string; p: string }): Promise<{ h: string }>
  fsRemoteTrash(options: { base: string; token: string; p: string; expect: FsStat | null }): Promise<{ result: FsTrashResult }>
  fsLocalList(options: { root: string }): Promise<{ files: FsEntry[] }>
  fsLocalHash(options: { root: string; p: string }): Promise<{ h: string }>
  fsLocalTrash(options: { root: string; p: string; expect: FsStat | null }): Promise<{ result: FsTrashResult }>
  fsPull(options: FsTransfer & { rp: string; lp: string }): Promise<FsTransferResult>
  fsPush(options: FsTransfer & { lp: string; rp: string }): Promise<FsTransferResult>
  /** Корзина папки старше days дней — насовсем */
  fsCleanTrash(options: { root: string; days: number }): Promise<void>

  // связь с другими устройствами аккаунта
  /** Телефон: движок перечитывает вход в синхронизацию и переподключает свой поток событий (после входа и выхода) */
  remoteLink(): Promise<void>

  /** Телефон: «Сцена» — экран поворачивается за телефоном, без системных полос, не гаснет; off — обратно портрет */
  setStage(options: { on: boolean }): Promise<void>

  // вывод звука
  getOutputs(): Promise<OutputsEvent>
  setOutput(options: { deviceId: number | null }): Promise<void>
  openSystemOutputSwitcher(): Promise<void>

  // предпрослушивание вне очереди (дуэли, редактор миксов)
  previewSnippet(options: { uri: string; fromMs: number; durationMs: number; gainDb?: number }): Promise<void>
  previewJunction(options: JunctionPreview): Promise<void>
  previewStop(): Promise<void>

  // файлы
  exportFile(options: { name: string; data: string; mime?: string; base64?: boolean }): Promise<FileResult>
  /** Запрос окна к компьютеру в домашней сети (общие данные по Wi-Fi): http из https-окна делает Kotlin */
  lanRequest(options: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
  }): Promise<{ status: number; body: string; contentType: string }>
  /** Поток событий компьютера: события — lanEvent, конец — lanEventsClosed */
  lanEventsOpen(options: { id: string; url: string; token: string }): Promise<void>
  lanEventsClose(options: { id: string }): Promise<void>
  importFile(): Promise<ImportedFile>
  chooseBackupFolder(): Promise<{ uri: string }>
  writeBackup(options: { folderUri: string; json: string; keep: number }): Promise<{ uri: string }>

  addListener(event: 'state', cb: (e: PlayerStateEvent) => void): Promise<PluginListenerHandle>
  addListener(event: 'playLogged', cb: (e: PlayLoggedEvent) => void): Promise<PluginListenerHandle>
  addListener(event: 'scanProgress', cb: (e: ScanProgress) => void): Promise<PluginListenerHandle>
  addListener(event: 'notificationAction', cb: (e: NotificationActionEvent) => void): Promise<PluginListenerHandle>
  addListener(event: 'outputs', cb: (e: OutputsEvent) => void): Promise<PluginListenerHandle>
  addListener(event: 'analysisProgress', cb: (e: AnalysisProgress) => void): Promise<PluginListenerHandle>
  addListener(event: 'queueLow', cb: (e: { left: number }) => void): Promise<PluginListenerHandle>
  addListener(event: 'previewEnded', cb: () => void): Promise<PluginListenerHandle>
  addListener(event: 'lanEvent', cb: (e: { id: string; name: string; data: string }) => void): Promise<PluginListenerHandle>
  addListener(
    event: 'lanEventsClosed',
    cb: (e: { id: string; status: number; contentType: string; error: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(event: 'youtubeProgress', cb: (e: YoutubeProgress) => void): Promise<PluginListenerHandle>
  /** Только браузер: трек из своей папки не открылся — нужен клик, чтобы вернуть доступ */
  addListener(event: 'folderAccess', cb: () => void): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}

export interface FsStat {
  s: number
  m: number
}
export interface FsEntry extends FsStat {
  p: string
}
export type FsTrashResult = 'ok' | 'changed' | 'missing'
export interface FsTransfer {
  base: string
  token: string
  root: string
  from: FsStat
  expect: FsStat | null
}
export type FsTransferResult =
  { ok: true; l: FsStat; r: FsStat } | { ok: false; why: 'changed' | 'busy' | 'missing' | 'error'; message?: string }

export interface WebFolderInfo {
  /** desktop — приложение для компьютера: папки на диске */
  source: 'demo' | 'folder' | 'desktop'
  /** Chrome и Edge: папку можно запомнить и писать в неё теги */
  canPickDirectory: boolean
  savedName: string | null
  loaded: number
  /** Папка выбрана раньше, но после перезагрузки страницы браузер ждёт клика */
  needsAccess: boolean
  writable: boolean
  /** Компьютер: все выбранные папки с музыкой */
  folders?: string[]
}

/** Возможности только браузерной версии: своя папка с mp3 вместо демо-библиотеки */
export interface MusicCoreWebExtras {
  folderInfo(): Promise<WebFolderInfo>
  pickFolder(): Promise<{ count: number }>
  restoreFolder(): Promise<{ count: number }>
  useDemo(): Promise<void>
  /** Компьютер: общая громкость приложения 0…1 */
  setVolume(o: { volume: number }): Promise<void>
  /** Компьютер: убрать папку из библиотеки */
  removeFolder(o: { path: string }): Promise<{ folders: string[] }>
}

// Capacitor может вызвать загрузчик несколько раз, если первые вызовы пришли одновременно:
// держим один экземпляр, иначе в браузере оказалось бы две базы
let webImpl: Promise<MusicCorePlugin> | null = null

export const MusicCore = registerPlugin<MusicCorePlugin>('MusicCore', {
  web: () => (webImpl ??= import('./web/MusicCoreWeb').then((m) => new m.MusicCoreWeb())),
})

/** Вызывать только когда !isNative */
export const MusicCoreWeb = MusicCore as unknown as MusicCoreWebExtras
