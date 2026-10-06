import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, shell, Tray, type NativeImage } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { thumbIcons } from './icons'
import { setYoutubeDataDir, youtubeDownload, youtubeInfo } from './youtube'
import { voiceModelPath } from './voice'

/**
 * Amber для компьютера: главный процесс Electron.
 *
 * Интерфейс и звуковой движок — та же веб-версия (src/native/web), что работает в браузере. Здесь только то,
 * чего браузер не умеет: папки с музыкой на диске, база в файле, трей, кнопки на панели задач, закрытие в трей.
 * Приложение и музыка отдаются по своей схеме app://amber/ — у страницы и файлов один источник, поэтому
 * Web Audio (эквалайзер, эффекты, переходы) работает с файлами без ограничений.
 */

const DEV_URL = process.env.AMBER_DEV_URL
const ORIGIN = 'app://amber'
const AUDIO = /\.(mp3|flac|m4a|aac|ogg|opus|wav)$/i
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'node_modules', '.git'])

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true },
  },
])

/* ---------------- настройки приложения на этом компьютере ---------------- */

interface DesktopConfig {
  folders: string[]
  closeToTray: boolean
  bounds?: { x: number; y: number; width: number; height: number; maximized: boolean }
}

const userData = () => app.getPath('userData')
const configPath = () => path.join(userData(), 'desktop.json')
let config: DesktopConfig = { folders: [], closeToTray: true }

function loadConfig() {
  try {
    config = { ...config, ...(JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<DesktopConfig>) }
  } catch {
    /* первый запуск */
  }
}
let configTimer: NodeJS.Timeout | undefined
function saveConfig(now = false) {
  clearTimeout(configTimer)
  const write = () => fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
  if (now) write()
  else configTimer = setTimeout(write, 500)
}

/** Музыку отдаём только из выбранных папок */
function allowed(p: string): boolean {
  const abs = path.resolve(p).toLowerCase()
  return config.folders.some((root) => abs.startsWith(path.resolve(root).toLowerCase() + path.sep))
}

/* ---------------- файлы: приложение и музыка ---------------- */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
}

const distDir = () => path.join(__dirname, 'dist')

async function serveApp(url: URL): Promise<Response> {
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  let file = path.join(distDir(), rel)
  if (!file.startsWith(distDir()) || !fs.existsSync(file)) file = path.join(distDir(), 'index.html')
  const body = await fsp.readFile(file)
  return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } })
}

/** Модель распознавания речи для голосовых команд (готовит voice.ts) — её скачивает распознаватель на странице */
async function serveVoice(): Promise<Response> {
  const file = path.join(userData(), 'voice', 'model-ru-small.tar.gz')
  try {
    const st = await fsp.stat(file)
    const stream = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream
    return new Response(stream, { headers: { 'content-type': 'application/gzip', 'content-length': String(st.size) } })
  } catch {
    return new Response('not found', { status: 404 })
  }
}

/**
 * Аудиофайл с поддержкой Range: плеер просит куски файла при перемотке, а не читает его целиком.
 * Доступ открыт и странице разработки (localhost), поэтому ответ с CORS-заголовком.
 */
async function serveMedia(req: Request, url: URL): Promise<Response> {
  const p = url.searchParams.get('p') ?? ''
  const cors = { 'access-control-allow-origin': '*' }
  if (!p || !allowed(p)) return new Response('forbidden', { status: 403, headers: cors })
  let size: number
  try {
    size = (await fsp.stat(p)).size
  } catch {
    return new Response('not found', { status: 404, headers: cors })
  }
  const type = MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream'
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
  let start = 0
  let end = size - 1
  if (range) {
    if (range[1]) start = Number(range[1])
    if (range[2]) end = Math.min(size - 1, Number(range[2]))
    if (!range[1] && range[2]) {
      start = Math.max(0, size - Number(range[2]))
      end = size - 1
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...cors, 'content-range': `bytes */${size}` } })
    }
  }
  const stream = Readable.toWeb(fs.createReadStream(p, { start, end })) as unknown as ReadableStream
  return new Response(stream, {
    status: range ? 206 : 200,
    headers: {
      ...cors,
      'content-type': type,
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
      ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    },
  })
}

/* ---------------- обход папок ---------------- */

interface Entry {
  path: string
  rel: string
  size: number
  mtime: number
}

async function walk(root: string): Promise<Entry[]> {
  const out: Entry[] = []
  const base = path.basename(root) || root
  const visit = async (dir: string, prefix: string) => {
    let items: fs.Dirent[]
    try {
      items = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const files: Promise<void>[] = []
    for (const it of items) {
      const full = path.join(dir, it.name)
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name.toLowerCase()) || it.name.startsWith('.')) continue
        await visit(full, `${prefix}${it.name}/`)
      } else if (it.isFile() && AUDIO.test(it.name)) {
        files.push(
          fsp.stat(full).then(
            (st) => void out.push({ path: full, rel: `${prefix}${it.name}`, size: st.size, mtime: Math.round(st.mtimeMs) }),
            () => undefined,
          ),
        )
      }
    }
    await Promise.all(files)
  }
  await visit(root, `${base}/`)
  return out
}

/** Слежение за папками: файл добавили, переименовали или удалили — библиотека пересканируется сама */
let watchers: fs.FSWatcher[] = []
let changeTimer: NodeJS.Timeout | undefined
function watchFolders() {
  for (const w of watchers) w.close()
  watchers = []
  for (const root of config.folders) {
    try {
      const w = fs.watch(root, { recursive: true }, (_ev, name) => {
        if (name && !AUDIO.test(String(name)) && path.extname(String(name))) return
        clearTimeout(changeTimer)
        changeTimer = setTimeout(() => win?.webContents.send('files:changed'), 2500)
      })
      w.on('error', () => undefined)
      watchers.push(w)
    } catch {
      /* папку удалили или отключили диск */
    }
  }
}

/* ---------------- база ---------------- */

const dbPath = () => path.join(userData(), 'amber.sqlite')
let dbWrite: Promise<void> = Promise.resolve()
let backedUp = false

/** Запись базы целиком: во временный файл, потом подмена. Перед первой записью за запуск — копия .bak */
function writeDb(bytes: Uint8Array): Promise<void> {
  dbWrite = dbWrite.then(async () => {
    const file = dbPath()
    if (!backedUp && fs.existsSync(file)) {
      await fsp.copyFile(file, `${file}.bak`).catch(() => undefined)
      backedUp = true
    }
    const tmp = `${file}.tmp`
    await fsp.writeFile(tmp, bytes)
    await fsp.rename(tmp, file)
  })
  return dbWrite
}

/* ---------------- журнал ---------------- */

/** Падения и зависания пишутся в amber.log в папке данных: по нему видно, что случилось */
function log(...parts: unknown[]) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}
`
  try {
    fs.appendFileSync(path.join(userData(), 'amber.log'), line)
  } catch {
    /* без журнала */
  }
}

/* ---------------- окно, трей, панель задач ---------------- */

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let flushed = false
let nowPlaying = { playing: false, title: '', artist: '' }

function appIcon(): NativeImage {
  return nativeImage.createFromPath(path.join(__dirname, 'icon.png'))
}

function send(cmd: string) {
  win?.webContents.send('command', cmd)
}

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function updateTray() {
  if (!tray) return
  const label = nowPlaying.title ? `${nowPlaying.title}${nowPlaying.artist ? ` — ${nowPlaying.artist}` : ''}` : 'Amber'
  tray.setToolTip(label.length > 120 ? `${label.slice(0, 117)}…` : label)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть Amber', click: showWindow },
      { type: 'separator' },
      { label: nowPlaying.playing ? 'Пауза' : 'Играть', click: () => send('toggle') },
      { label: 'Следующий', click: () => send('next') },
      { label: 'Предыдущий', click: () => send('prev') },
      { type: 'separator' },
      { label: 'Выйти', click: () => app.quit() },
    ]),
  )
}

/** Кнопки «назад / пауза / вперёд» в миниатюре окна на панели задач Windows */
function updateThumbar() {
  if (!win || process.platform !== 'win32') return
  const icons = thumbIcons()
  win.setThumbarButtons([
    { tooltip: 'Предыдущий', icon: icons.prev, click: () => send('prev') },
    {
      tooltip: nowPlaying.playing ? 'Пауза' : 'Играть',
      icon: nowPlaying.playing ? icons.pause : icons.play,
      click: () => send('toggle'),
    },
    { tooltip: 'Следующий', icon: icons.next, click: () => send('next') },
  ])
}

function createWindow() {
  const b = config.bounds
  win = new BrowserWindow({
    width: b?.width ?? 1280,
    height: b?.height ?? 820,
    x: b?.x,
    y: b?.y,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: 'Amber',
    icon: appIcon(),
    backgroundColor: '#0e0d0c',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e0d0c', symbolColor: '#f5f1ea', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      // Музыка не должна затихать, когда окно свёрнуто или спрятано в трей
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  if (b?.maximized) win.maximize()
  // AMBER_HIDDEN — для автоматических проверок: окно рисуется как обычно, но далеко за краем экрана
  // и не забирает фокус (совсем скрытое окно браузер почти не отрисовывает)
  win.once('ready-to-show', () => {
    if (!process.env.AMBER_HIDDEN) return win?.show()
    win?.setPosition(-32000, 0)
    win?.showInactive()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const remember = () => {
    if (!win || win.isMinimized() || process.env.AMBER_HIDDEN) return
    config.bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() }
    saveConfig()
  }
  win.on('resize', remember)
  win.on('move', remember)

  win.on('close', (e) => {
    if (!quitting && config.closeToTray) {
      // Крестик прячет окно в трей: музыка играет дальше. Выйти — из меню значка или Ctrl+Q
      e.preventDefault()
      win?.hide()
      return
    }
    if (!flushed) {
      // Перед выходом страница дописывает базу на диск
      e.preventDefault()
      quitting = true
      const done = () => {
        if (flushed) return
        flushed = true
        void dbWrite.finally(() => app.quit())
      }
      ipcMain.once('app:flushed', done)
      setTimeout(done, 3000)
      win?.webContents.send('app:flush')
    }
  })
  win.on('closed', () => (win = null))

  // Страница упала (нехватка памяти, сбой) — вместо чёрного окна перезагружаем её
  win.webContents.on('render-process-gone', (_e, d) => {
    log('render-process-gone', d)
    if (!quitting && d.reason !== 'clean-exit') setTimeout(() => win?.webContents.reload(), 500)
  })
  win.webContents.on('unresponsive', () => log('unresponsive'))
  win.webContents.on('responsive', () => log('responsive'))
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') log('console', e.message.slice(0, 500))
  })

  if (DEV_URL) void win.loadURL(DEV_URL)
  else void win.loadURL(`${ORIGIN}/index.html`)
  updateThumbar()
}

/* ---------------- обмен со страницей ---------------- */

function setupIpc() {
  ipcMain.handle('folders:list', () => config.folders)
  ipcMain.handle('folders:add', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Папка с музыкой',
      properties: ['openDirectory', 'multiSelections'],
      defaultPath: app.getPath('music'),
    })
    if (r.canceled || !r.filePaths.length) return null
    for (const p of r.filePaths) {
      const abs = path.resolve(p)
      // Вложенную в уже выбранную папку второй раз не добавляем, а выбранную вложенную заменяем общей
      if (config.folders.some((f) => abs.toLowerCase().startsWith(path.resolve(f).toLowerCase() + path.sep) || f === abs))
        continue
      config.folders = config.folders.filter(
        (f) =>
          !path
            .resolve(f)
            .toLowerCase()
            .startsWith(abs.toLowerCase() + path.sep),
      )
      config.folders.push(abs)
    }
    saveConfig(true)
    watchFolders()
    return config.folders
  })
  ipcMain.handle('folders:remove', (_e, p: string) => {
    config.folders = config.folders.filter((f) => f !== p)
    saveConfig(true)
    watchFolders()
    return config.folders
  })
  ipcMain.handle('folders:walk', async () => (await Promise.all(config.folders.map(walk))).flat())

  ipcMain.handle('file:read', async (_e, p: string, start: number, end: number) => {
    if (!allowed(p)) throw new Error('Файл вне папок с музыкой')
    const fh = await fsp.open(p, 'r')
    try {
      const len = Math.max(0, Math.min(end, (await fh.stat()).size) - start)
      const buf = Buffer.alloc(len)
      const { bytesRead } = await fh.read(buf, 0, len, start)
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead)
    } finally {
      await fh.close()
    }
  })
  ipcMain.handle('file:write', async (_e, p: string, data: Uint8Array) => {
    if (!allowed(p)) throw new Error('Файл вне папок с музыкой')
    // Сначала рядом, потом подмена: если запись прервётся, исходный файл цел
    const tmp = `${p}.amber-tmp`
    await fsp.writeFile(tmp, data)
    try {
      await fsp.rename(tmp, p)
    } catch {
      // Файл кто-то держит открытым (другой плеер): пишем поверх, временный убираем
      await fsp.copyFile(tmp, p)
      await fsp.unlink(tmp).catch(() => undefined)
    }
    const st = await fsp.stat(p)
    return { size: st.size, mtime: Math.round(st.mtimeMs) }
  })
  ipcMain.handle('file:trash', async (_e, p: string) => {
    if (!allowed(p)) throw new Error('Файл вне папок с музыкой')
    await shell.trashItem(p)
  })
  ipcMain.handle('file:reveal', (_e, p: string) => {
    if (allowed(p)) shell.showItemInFolder(p)
  })

  ipcMain.handle('db:read', async () => {
    try {
      return new Uint8Array(await fsp.readFile(dbPath()))
    } catch {
      return null
    }
  })
  ipcMain.handle('db:write', (_e, data: Uint8Array) => writeDb(data))

  ipcMain.handle('dialog:folder', async (_e, title: string) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ipcMain.handle('dialog:save', async (_e, name: string, data: Uint8Array) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: path.join(app.getPath('documents'), name) })
    if (r.canceled || !r.filePath) return null
    await fsp.writeFile(r.filePath, data)
    return r.filePath
  })
  ipcMain.handle('dialog:open', async (_e, extensions: string[]) => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'Файлы', extensions }],
    })
    const p = r.filePaths[0]
    if (r.canceled || !p) return null
    return { name: path.basename(p), data: new Uint8Array(await fsp.readFile(p)) }
  })
  /** Автобэкап: файл дня в выбранной папке, старые копии сверх keep удаляются */
  ipcMain.handle('backup:write', async (_e, folder: string, name: string, json: string, keep: number) => {
    await fsp.mkdir(folder, { recursive: true })
    const file = path.join(folder, name)
    await fsp.writeFile(file, json, 'utf8')
    const old = (await fsp.readdir(folder)).filter((f) => /^amber-backup-.*\.json$/.test(f)).sort()
    for (const f of old.slice(0, Math.max(0, old.length - keep))) await fsp.unlink(path.join(folder, f)).catch(() => undefined)
    return file
  })

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), closeToTray: config.closeToTray, music: app.getPath('music') }))
  ipcMain.handle('app:closeToTray', (_e, v: boolean) => {
    config.closeToTray = v
    saveConfig(true)
  })
  ipcMain.on('app:titlebar', (_e, c: { bg: string; ink: string }) => {
    try {
      win?.setTitleBarOverlay({ color: c.bg, symbolColor: c.ink, height: 44 })
      win?.setBackgroundColor(c.bg)
    } catch {
      /* не Windows */
    }
  })
  ipcMain.on('app:nowPlaying', (_e, s: typeof nowPlaying) => {
    const changed = s.playing !== nowPlaying.playing
    nowPlaying = s
    updateTray()
    if (changed) updateThumbar()
    win?.setTitle(s.title ? `${s.title} — Amber` : 'Amber')
  })
  ipcMain.on('app:quit', () => app.quit())

  // Голосовые команды: модель речи скачивается при первом включении, дальше лежит в папке данных
  ipcMain.handle('voice:prepare', async (e) => {
    await voiceModelPath(userData(), (p) => e.sender.send('voice:progress', p))
    return 'app://amber/__voice/model.tar.gz'
  })

  ipcMain.handle('yt:info', (_e, url: string) => youtubeInfo(url))
  ipcMain.handle('yt:download', async (e, url: string, names?: { title: string; artist: string }) => {
    // Скачанное ложится в «Музыка/Amber»; если эта папка не в библиотеке — добавляем
    const out = process.env.AMBER_YT_DIR ?? path.join(app.getPath('music'), 'Amber')
    await fsp.mkdir(out, { recursive: true })
    if (!allowed(path.join(out, 'x'))) {
      config.folders.push(out)
      saveConfig(true)
      watchFolders()
    }
    return youtubeDownload(url, out, userData(), (p) => e.sender.send('yt:progress', p), names)
  })
}

/* ---------------- запуск ---------------- */

// Отдельная папка данных для проверок, чтобы не трогать настоящую библиотеку
if (process.env.AMBER_USER_DATA) app.setPath('userData', process.env.AMBER_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.setAppUserModelId('app.yantar.player.desktop')

  void app.whenReady().then(() => {
    loadConfig()
    setYoutubeDataDir(userData())
    Menu.setApplicationMenu(null)
    protocol.handle('app', (req) => {
      const url = new URL(req.url)
      if (url.pathname === '/__media') return serveMedia(req, url)
      if (url.pathname === '/__voice/model.tar.gz') return serveVoice()
      return serveApp(url)
    })
    setupIpc()
    createWindow()
    watchFolders()
    tray = new Tray(appIcon().resize({ width: 16, height: 16 }))
    tray.on('click', showWindow)
    updateTray()
  })

  app.on('child-process-gone', (_e, d) => log('child-process-gone', d))

  app.on('before-quit', () => {
    quitting = true
    saveConfig(true)
  })
  app.on('window-all-closed', () => app.quit())
}
