/**
 * Мост к Amber для компьютера (Electron, папка desktop/). Есть только в приложении для ПК: preload кладёт
 * его в window.amberDesktop. Через него веб-движок читает и пишет файлы на диске, хранит базу в файле
 * и говорит с треем и панелью задач. В браузере и на телефоне моста нет — там свои пути.
 */

export interface DesktopEntry {
  /** Абсолютный путь на диске */
  path: string
  /** Путь от имени выбранной папки: «Музыка/Кино/Группа крови.mp3» */
  rel: string
  size: number
  /** Время изменения, мс */
  mtime: number
}

export interface DesktopYtInfo {
  id: string
  title: string
  uploader: string
  durationMs: number
  thumbnail: string | null
}

export interface DesktopYtProgress {
  stage: 'prepare' | 'download' | 'save'
  done: number
  total: number
}

export type DesktopCommand = 'toggle' | 'next' | 'prev'

export interface DesktopFileSyncState {
  enabled: boolean
  folder: string | null
  running: boolean
  port: number
  /** Не запустился (порт занят) */
  error: string | null
  name: string
  addresses: string[]
  devices: { id: string; name: string; pairedAt: number; lastSeenAt: number | null }[]
}

export interface DesktopBridge {
  // папки с музыкой
  folders(): Promise<string[]>
  /** Системный выбор папки; null — отменили */
  addFolder(): Promise<string[] | null>
  removeFolder(path: string): Promise<string[]>
  walk(): Promise<DesktopEntry[]>
  onFilesChanged(cb: () => void): void
  read(path: string, start: number, end: number): Promise<Uint8Array>
  write(path: string, data: Uint8Array): Promise<{ size: number; mtime: number }>
  /** В корзину Windows, а не безвозвратно */
  trash(path: string): Promise<void>
  reveal(path: string): Promise<void>

  // база
  readDb(): Promise<Uint8Array | null>
  writeDb(data: Uint8Array): Promise<void>
  /** Копия базы с прошлого запуска (amber.sqlite.bak), если она цела */
  readDbBackup(): Promise<{ data: Uint8Array; at: number } | null>
  /** Повреждённую базу — в сторону (amber.sqlite.broken-…); возвращает новое имя файла */
  quarantineDb(): Promise<string | null>
  /** Окно закрывается: дописать базу и сообщить done() */
  onFlush(cb: () => Promise<void>): void

  // диалоги и файлы
  chooseFolder(title: string): Promise<string | null>
  saveFile(name: string, data: Uint8Array): Promise<string | null>
  openFile(extensions: string[]): Promise<{ name: string; data: Uint8Array } | null>
  writeBackup(folder: string, name: string, json: string, keep: number): Promise<string>

  // окно, трей, панель задач
  info(): Promise<{ version: string; closeToTray: boolean; music: string }>
  setCloseToTray(v: boolean): Promise<void>
  setTitleBar(colors: { bg: string; ink: string }): void
  nowPlaying(s: { playing: boolean; title: string; artist: string }): void
  onCommand(cb: (cmd: DesktopCommand) => void): void
  quit(): void

  // YouTube
  ytInfo(url: string): Promise<DesktopYtInfo>
  ytDownload(url: string, names: { title: string; artist: string }): Promise<{ path: string; cover: string | null; id: string }>
  onYtProgress(cb: (p: DesktopYtProgress) => void): void

  // Папка с музыкой по Wi-Fi для телефона (desktop/filesync.ts)
  fileSyncState(): Promise<DesktopFileSyncState>
  fileSyncSet(patch: { enabled?: boolean; folder?: string | null }): Promise<DesktopFileSyncState>
  /** Код для подключения телефона: 6 цифр на 10 минут */
  fileSyncPair(): Promise<{ code: string; expiresAt: number }>
  fileSyncUnpair(id: string): Promise<DesktopFileSyncState>
  onFileSyncActivity(cb: (a: { device: string; op: 'pull' | 'push' | 'trash' | 'pair'; path?: string; at: number }) => void): void

  // Голосовые команды: подготовить модель речи (первый раз — скачать) → её адрес для распознавателя
  voicePrepare(): Promise<string>
  onVoiceProgress(cb: (p: { stage: 'download' | 'unpack'; done: number; total: number }) => void): void
}

export const desktop: DesktopBridge | null =
  typeof window !== 'undefined' ? ((window as unknown as { amberDesktop?: DesktopBridge }).amberDesktop ?? null) : null

export const isDesktop = desktop != null

/** Адрес аудиофайла для <audio>: главный процесс отдаёт его кусками, с перемоткой */
export function mediaUrl(path: string): string {
  return `app://amber/__media?p=${encodeURIComponent(path)}`
}
