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
  addListener(event: 'youtubeProgress', cb: (e: YoutubeProgress) => void): Promise<PluginListenerHandle>
  /** Только браузер: трек из своей папки не открылся — нужен клик, чтобы вернуть доступ */
  addListener(event: 'folderAccess', cb: () => void): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}

export interface WebFolderInfo {
  source: 'demo' | 'folder'
  /** Chrome и Edge: папку можно запомнить и писать в неё теги */
  canPickDirectory: boolean
  savedName: string | null
  loaded: number
  /** Папка выбрана раньше, но после перезагрузки страницы браузер ждёт клика */
  needsAccess: boolean
  writable: boolean
}

/** Возможности только браузерной версии: своя папка с mp3 вместо демо-библиотеки */
export interface MusicCoreWebExtras {
  folderInfo(): Promise<WebFolderInfo>
  pickFolder(): Promise<{ count: number }>
  restoreFolder(): Promise<{ count: number }>
  useDemo(): Promise<void>
}

// Capacitor может вызвать загрузчик несколько раз, если первые вызовы пришли одновременно:
// держим один экземпляр, иначе в браузере оказалось бы две базы
let webImpl: Promise<MusicCorePlugin> | null = null

export const MusicCore = registerPlugin<MusicCorePlugin>('MusicCore', {
  web: () => (webImpl ??= import('./web/MusicCoreWeb').then((m) => new m.MusicCoreWeb())),
})

/** Вызывать только когда !isNative */
export const MusicCoreWeb = MusicCore as unknown as MusicCoreWebExtras
