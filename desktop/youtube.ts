import { nativeImage } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * YouTube на компьютере — через утилиту yt-dlp (на телефоне это делает NewPipe).
 * Утилита скачивается один раз при первом использовании в папку данных приложения.
 * Для разбора защиты YouTube ей нужен JavaScript: подставляем сам Electron в режиме Node.
 * Теги и обложку в файл пишет уже страница — тем же кодом, что правит теги в медиатеке.
 */

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'

export interface YtInfo {
  id: string
  title: string
  uploader: string
  durationMs: number
  thumbnail: string | null
}

export interface YtProgress {
  stage: 'prepare' | 'download' | 'save'
  done: number
  total: number
}

function binDir(userData: string) {
  return path.join(userData, 'bin')
}
let tool: string | null = null

async function ensureTool(userData: string, progress?: (p: YtProgress) => void): Promise<string> {
  if (tool && fs.existsSync(tool)) return tool
  const file = path.join(binDir(userData), 'yt-dlp.exe')
  if (!fs.existsSync(file)) {
    await fsp.mkdir(binDir(userData), { recursive: true })
    const res = await fetch(YTDLP_URL)
    if (!res.ok || !res.body) throw new Error(`Не удалось скачать загрузчик (${res.status})`)
    const total = Number(res.headers.get('content-length') ?? 0)
    const tmp = `${file}.part`
    const out = fs.createWriteStream(tmp)
    let done = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      out.write(chunk)
      done += chunk.length
      progress?.({ stage: 'prepare', done, total })
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())))
    await fsp.rename(tmp, file)
  }
  tool = file
  return file
}

/** Запуск yt-dlp; Electron в режиме Node служит ему движком JavaScript */
function run(bin: string, args: string[], onLine?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['--js-runtimes', `node:${process.execPath}`, '--no-warnings', ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      windowsHide: true,
    })
    let out = ''
    let err = ''
    let buf = ''
    p.stdout.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      out += s
      if (!onLine) return
      buf += s
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      lines.forEach(onLine)
    })
    p.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(humanError(err) || `yt-dlp завершился с кодом ${code}`))
    })
  })
}

function humanError(stderr: string): string {
  const line = stderr
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith('ERROR'))
  if (!line) return stderr.trim().split(/\r?\n/).pop() ?? ''
  if (/private video/i.test(line)) return 'Видео приватное'
  if (/unavailable|not available/i.test(line)) return 'Видео недоступно'
  if (/sign in to confirm your age/i.test(line)) return 'Видео с возрастным ограничением: без входа в аккаунт не скачать'
  if (/sign in to confirm/i.test(line)) return 'YouTube просит подтвердить, что это не бот. Попробуй позже'
  if (/is not a valid url|unsupported url/i.test(line)) return 'Это не ссылка на видео YouTube'
  return line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?(\S+:\s*)?/, '')
}

let dataDir = ''
export async function youtubeInfo(url: string): Promise<YtInfo> {
  const bin = await ensureTool(dataDir)
  const j = JSON.parse(await run(bin, ['-J', '--no-playlist', url])) as {
    id: string
    title?: string
    uploader?: string
    channel?: string
    duration?: number
    thumbnail?: string
  }
  return {
    id: j.id,
    title: j.title ?? 'Без названия',
    uploader: j.uploader ?? j.channel ?? '',
    durationMs: Math.round((j.duration ?? 0) * 1000),
    thumbnail: j.thumbnail ?? `https://i.ytimg.com/vi/${j.id}/hqdefault.jpg`,
  }
}

/** Обложка: самая крупная из стандартных картинок ролика, обрезанная в квадрат */
async function squareCover(id: string): Promise<string | null> {
  for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${id}/${name}.jpg`)
      if (!res.ok) continue
      const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
      const { width, height } = img.getSize()
      if (!width || !height) continue
      // У hq/sd по краям чёрные полосы 4:3: квадрат берём из середины кадра 16:9
      const contentH = name === 'maxresdefault' ? height : Math.round((width * 9) / 16)
      const side = Math.min(width, contentH)
      const sq = img
        .crop({ x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), width: side, height: side })
        .resize({ width: Math.min(side, 720), height: Math.min(side, 720), quality: 'best' })
      return sq.toJPEG(90).toString('base64')
    } catch {
      /* следующий размер */
    }
  }
  return null
}

const safeName = (s: string) =>
  s
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

/**
 * Скачать звук в папку out. Имя файла — «Исполнитель - Название.m4a» (или .webm/.opus, если AAC нет).
 * Возвращает путь и квадратную обложку для тегов.
 */
export async function youtubeDownload(
  url: string,
  out: string,
  userData: string,
  progress: (p: YtProgress) => void,
  names?: { title: string; artist: string },
): Promise<{ path: string; cover: string | null; id: string }> {
  dataDir = userData
  const bin = await ensureTool(userData, progress)
  const info = await youtubeInfo(url)
  const base = safeName(names ? `${names.artist} - ${names.title}` : info.title) || info.id
  const tmpDir = path.join(userData, 'yt-tmp')
  await fsp.mkdir(tmpDir, { recursive: true })
  progress({ stage: 'download', done: 0, total: 0 })
  await run(
    bin,
    [
      '--no-playlist',
      '-f',
      'bestaudio[ext=m4a]/bestaudio',
      '--newline',
      '--progress-template',
      'download:AMBER %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
      '-o',
      path.join(tmpDir, `${info.id}.%(ext)s`),
      url,
    ],
    (line) => {
      const m = /^AMBER (\d+) (\d+(?:\.\d+)?)/.exec(line.trim())
      if (m) progress({ stage: 'download', done: Number(m[1]), total: Math.round(Number(m[2])) })
    },
  )
  const got = (await fsp.readdir(tmpDir)).find((f) => f.startsWith(`${info.id}.`) && !f.endsWith('.part'))
  if (!got) throw new Error('Файл не скачался')
  progress({ stage: 'save', done: 0, total: 0 })
  const ext = path.extname(got)
  let target = path.join(out, `${base}${ext}`)
  for (let i = 2; fs.existsSync(target); i++) target = path.join(out, `${base} (${i})${ext}`)
  await fsp.copyFile(path.join(tmpDir, got), target)
  await fsp.unlink(path.join(tmpDir, got)).catch(() => undefined)
  return { path: target, cover: ext === '.m4a' ? await squareCover(info.id) : null, id: info.id }
}

export function setYoutubeDataDir(dir: string) {
  dataDir = dir
}
