import http from 'node:http'
import dgram from 'node:dgram'
import os from 'node:os'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { ignored } from '../src/filesync/plan'
import { tr } from './lang'

/**
 * Папка с музыкой по Wi-Fi: компьютер раздаёт её телефону в локальной сети (как Syncthing, только проще).
 *
 * Компьютер ничего не решает сам — он отвечает на запросы. Что куда копировать, решает телефон
 * (src/filesync/plan.ts): у него список с обеих сторон и память о прошлой синхронизации.
 *
 * Чтобы ничего не терялось:
 *  - принятый файл пишется рядом во временный (.имя.amber-part), проверяется размер, и только потом встаёт
 *    на место; прежняя версия уходит в корзину Windows;
 *  - замена и удаление — только если файл всё ещё такой, каким его видел телефон (expect); иначе 409,
 *    телефон разберётся в следующем проходе;
 *  - файл занят (играет) — 423, он придёт позже.
 *
 * Телефон находит компьютер по маячку (UDP-рассылка в локальной сети раз в 2 с) или по адресу, а подключается
 * один раз по шестизначному коду с экрана компьютера. Дальше — токен в заголовке.
 *
 * Без Electron: корзину и сохранение настроек передаёт main.ts, а тесты (tests/filesync-server.test.ts)
 * запускают тот же сервер в Node.
 */

export const FILESYNC_PORT = 47862
export const BEACON_PORT = 47863
const API = '/amber-sync/v1'
const CODE_TTL_MS = 10 * 60_000

export interface PairedDevice {
  id: string
  name: string
  tokenHash: string
  pairedAt: number
  lastSeenAt?: number
}

export interface FileSyncConfig {
  enabled: boolean
  /** Какую папку раздаём (одна из папок с музыкой) */
  folder: string | null
  devices: PairedDevice[]
  /** Постоянный номер этого компьютера: по нему телефон узнаёт его после смены адреса */
  id: string
}

export interface FileSyncActivity {
  device: string
  op: 'pull' | 'push' | 'trash' | 'list' | 'pair'
  path?: string
}

export interface FileSyncHost {
  config(): FileSyncConfig
  save(c: FileSyncConfig): void
  /** В корзину системы */
  trash(abs: string): Promise<void>
  name: string
  onActivity?(a: FileSyncActivity): void
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** Ошибка запроса: текст по-русски и по-английски — телефон получит на своём языке */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly why?: string,
    readonly en = message,
  ) {
    super(message)
  }
}

/** Адреса компьютера в локальной сети (для подсказки на экране и маячка) */
export function lanAddresses(): { address: string; broadcast: string }[] {
  const out: { address: string; broadcast: string }[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const ip = a.address.split('.').map(Number)
      const mask = a.netmask.split('.').map(Number)
      out.push({ address: a.address, broadcast: ip.map((x, i) => (x | (~mask[i]! & 255)) >>> 0).join('.') })
    }
  }
  return out
}

export class FileSyncServer {
  private server: http.Server | null = null
  private beacon: dgram.Socket | null = null
  private beaconTimer: NodeJS.Timeout | undefined
  private code: { value: string; expiresAt: number; wrong: number } | null = null
  /** Ошибка запуска (порт занят) — показать в настройках */
  error: string | null = null
  port = FILESYNC_PORT

  constructor(private readonly host: FileSyncHost) {}

  get running(): boolean {
    return this.server?.listening === true
  }

  /** Запустить или остановить по настройкам */
  async apply(): Promise<void> {
    const c = this.host.config()
    const want = c.enabled && !!c.folder
    if (want && !this.running) await this.start()
    else if (!want && this.running) await this.stop()
  }

  async start(port = this.port): Promise<void> {
    this.error = null
    const server = http.createServer((req, res) => void this.handle(req, res))
    // Песни большие, а Wi-Fi бывает медленным: таймаут на сам запрос не ставим
    server.requestTimeout = 0
    await new Promise<void>((resolve) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        this.error =
          e.code === 'EADDRINUSE'
            ? tr(`Порт ${port} занят другой программой`, `Port ${port} is used by another program`)
            : e.message
        resolve()
      })
      // AMBER_FILESYNC_BIND=127.0.0.1 — для проверок: без окна брандмауэра Windows
      server.listen(port, process.env.AMBER_FILESYNC_BIND || '0.0.0.0', () => resolve())
    })
    if (!server.listening) return
    this.server = server
    this.port = (server.address() as { port: number }).port
    this.startBeacon()
  }

  async stop(): Promise<void> {
    clearInterval(this.beaconTimer)
    this.beacon?.close()
    this.beacon = null
    const s = this.server
    this.server = null
    if (s) await new Promise<void>((r) => s.close(() => r()))
  }

  /** Новый код для подключения телефона: 6 цифр, живёт 10 минут */
  pairCode(): { code: string; expiresAt: number } {
    const value = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    this.code = { value, expiresAt: Date.now() + CODE_TTL_MS, wrong: 0 }
    return { code: value, expiresAt: this.code.expiresAt }
  }

  unpair(id: string) {
    const c = this.host.config()
    this.host.save({ ...c, devices: c.devices.filter((d) => d.id !== id) })
  }

  private startBeacon() {
    // Проверки на 127.0.0.1: в сеть ничего не рассылаем
    if (process.env.AMBER_FILESYNC_BIND) return
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    sock.on('error', () => undefined)
    sock.bind(() => {
      sock.setBroadcast(true)
      const send = () => {
        const c = this.host.config()
        const msg = Buffer.from(JSON.stringify({ amber: 'filesync', v: 1, id: c.id, name: this.host.name, port: this.port }))
        const targets = new Set(['255.255.255.255', ...lanAddresses().map((a) => a.broadcast)])
        for (const t of targets) sock.send(msg, BEACON_PORT, t, () => undefined)
      }
      send()
      this.beaconTimer = setInterval(send, 2000)
    })
    this.beacon = sock
  }

  /* ---------------- запросы ---------------- */

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      if (!url.pathname.startsWith(API)) throw new HttpError(404, 'Не найдено', undefined, 'Not found')
      const route = `${req.method} ${url.pathname.slice(API.length)}`
      if (route === 'GET /hello') return this.json(res, this.hello())
      if (route === 'POST /pair') return this.json(res, this.pair((await this.body(req)) as { code?: string; name?: string }))
      const device = this.auth(req)
      const root = this.root()
      switch (route) {
        case 'GET /list':
          this.host.onActivity?.({ device: device.name, op: 'list' })
          return this.json(res, { folderId: sha(root.toLowerCase()).slice(0, 12), files: await listFiles(root) })
        case 'GET /file':
          return await this.sendFile(res, this.resolve(root, url.searchParams.get('p')), device)
        case 'GET /hash':
          return this.json(res, { h: await hashFile(this.resolve(root, url.searchParams.get('p'))) })
        case 'PUT /file':
          return this.json(res, await this.receive(req, root, url.searchParams, device))
        case 'POST /trash': {
          const b = (await this.body(req)) as { p?: string; expect?: string }
          return this.json(res, await this.trash(root, b.p ?? '', b.expect ?? '', device))
        }
      }
      throw new HttpError(404, 'Не найдено', undefined, 'Not found')
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, e instanceof Error ? e.message : String(e))
      const en = /^en/i.test(req.headers['accept-language'] ?? '')
      if (!res.headersSent) this.json(res, { error: en ? err.en : err.message, why: err.why }, err.status)
      else res.destroy()
      // Недочитанное тело (отказали до приёма файла) не держим
      req.resume()
    }
  }

  private hello() {
    const c = this.host.config()
    return { app: 'amber', v: 1, id: c.id, name: this.host.name, folder: c.folder ? path.basename(c.folder) : null }
  }

  private pair(b: { code?: string; name?: string }) {
    const code = this.code
    if (!code || Date.now() > code.expiresAt)
      throw new HttpError(
        403,
        'Код устарел: открой подключение на компьютере заново',
        undefined,
        'The code expired: start connecting on the computer again',
      )
    if (b.code !== code.value) {
      // Перебор кода: после пяти ошибок код сгорает
      if (++code.wrong >= 5) this.code = null
      throw new HttpError(403, 'Неверный код', undefined, 'Wrong code')
    }
    this.code = null
    const token = crypto.randomBytes(24).toString('base64url')
    const c = this.host.config()
    const device: PairedDevice = {
      id: crypto.randomUUID(),
      name: (b.name ?? 'Телефон').slice(0, 60),
      tokenHash: sha(token),
      pairedAt: Date.now(),
    }
    this.host.save({ ...c, devices: [...c.devices, device] })
    this.host.onActivity?.({ device: device.name, op: 'pair' })
    return { token, id: c.id, name: this.host.name }
  }

  private auth(req: http.IncomingMessage): PairedDevice {
    const h = req.headers.authorization ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : ''
    const c = this.host.config()
    const d = token ? c.devices.find((x) => x.tokenHash === sha(token)) : undefined
    if (!d)
      throw new HttpError(
        401,
        'Телефон не подключён к этому компьютеру',
        undefined,
        'The phone is not connected to this computer',
      )
    if (!d.lastSeenAt || Date.now() - d.lastSeenAt > 60_000) {
      d.lastSeenAt = Date.now()
      this.host.save({ ...c })
    }
    return d
  }

  private root(): string {
    const f = this.host.config().folder
    if (!f || !fs.existsSync(f))
      throw new HttpError(503, 'Папка для синхронизации недоступна', undefined, 'The sync folder is unavailable')
    return path.resolve(f)
  }

  /** Путь от телефона → файл внутри папки. Выйти за её пределы нельзя */
  private resolve(root: string, p: string | null): string {
    if (!p || p.includes('\\') || p.split('/').some((x) => x === '..' || x === '') || ignored(p)) {
      throw new HttpError(400, 'Недопустимый путь', undefined, 'Invalid path')
    }
    const abs = path.resolve(root, ...p.split('/'))
    if (!abs.toLowerCase().startsWith(root.toLowerCase() + path.sep))
      throw new HttpError(400, 'Недопустимый путь', undefined, 'Invalid path')
    return abs
  }

  private async sendFile(res: http.ServerResponse, abs: string, device: PairedDevice) {
    const st = await fsp.stat(abs).catch(() => null)
    if (!st?.isFile()) throw new HttpError(404, 'Файла нет', 'missing', 'No such file')
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': st.size,
      'X-Size': String(st.size),
      'X-Mtime': String(Math.floor(st.mtimeMs)),
    })
    await pipeline(fs.createReadStream(abs), res)
    this.host.onActivity?.({ device: device.name, op: 'pull', path: abs })
  }

  /** Приём файла: во временный рядом, проверка размера и ожиданий, старая версия — в корзину, новая на место */
  private async receive(req: http.IncomingMessage, root: string, q: URLSearchParams, device: PairedDevice) {
    const p = q.get('p')
    const abs = this.resolve(root, p)
    const size = Number(q.get('s'))
    const mtime = Number(q.get('m'))
    const expect = q.get('expect') ?? ''
    if (!Number.isFinite(size) || size < 0 || !Number.isFinite(mtime))
      throw new HttpError(400, 'Нет размера или времени', undefined, 'No size or time')
    // Цель уже не та, что видел телефон, — даже не принимаем
    if (!(await matches(abs, expect)))
      throw new HttpError(409, 'Файл на компьютере изменился', 'changed', 'The file changed on the computer')
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${crypto.randomBytes(4).toString('hex')}.amber-part`)
    try {
      await pipeline(req, fs.createWriteStream(tmp))
      const got = (await fsp.stat(tmp)).size
      if (got !== size)
        throw new HttpError(
          400,
          `Файл пришёл не целиком: ${got} из ${size} байт`,
          'error',
          `The file arrived incomplete: ${got} of ${size} bytes`,
        )
      // Пока принимали, файл на компьютере могли поменять
      if (!(await matches(abs, expect)))
        throw new HttpError(409, 'Файл на компьютере изменился', 'changed', 'The file changed on the computer')
      if (expect !== 'none') {
        try {
          await this.host.trash(abs)
        } catch {
          throw new HttpError(423, 'Файл занят', 'busy', 'The file is busy')
        }
      }
      await fsp.rename(tmp, abs)
      await fsp.utimes(abs, new Date(), new Date(mtime)).catch(() => undefined)
    } finally {
      await fsp.unlink(tmp).catch(() => undefined)
    }
    const st = await fsp.stat(abs)
    this.host.onActivity?.({ device: device.name, op: 'push', path: abs })
    return { s: st.size, m: Math.floor(st.mtimeMs) }
  }

  private async trash(root: string, p: string, expect: string, device: PairedDevice) {
    const abs = this.resolve(root, p)
    if (!(await fsp.stat(abs).catch(() => null))) return { result: 'missing' }
    if (expect === 'none' || !(await matches(abs, expect))) return { result: 'changed' }
    try {
      await this.host.trash(abs)
    } catch {
      throw new HttpError(423, 'Файл занят', 'busy', 'The file is busy')
    }
    this.host.onActivity?.({ device: device.name, op: 'trash', path: abs })
    return { result: 'ok' }
  }

  private body(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let data = ''
      req.setEncoding('utf8')
      req.on('data', (c: string) => {
        data += c
        if (data.length > 64 * 1024) reject(new HttpError(413, 'Слишком большой запрос', undefined, 'Request too large'))
      })
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {})
        } catch {
          reject(new HttpError(400, 'Неверный запрос', undefined, 'Bad request'))
        }
      })
      req.on('error', reject)
    })
  }

  private json(res: http.ServerResponse, data: unknown, status = 200) {
    const body = JSON.stringify(data)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
    res.end(body)
  }
}

/** expect: 'none' — файла быть не должно; 'размер:время' — файл должен быть именно таким */
async function matches(abs: string, expect: string): Promise<boolean> {
  const st = await fsp.stat(abs).catch(() => null)
  if (expect === 'none') return st == null
  const [s, m] = expect.split(':').map(Number)
  return !!st && st.size === s && Math.abs(Math.floor(st.mtimeMs) - m!) < 1000
}

/** Все файлы папки: путь через «/», размер, время. Служебное и скрытое пропускаем */
export async function listFiles(root: string): Promise<{ p: string; s: number; m: number }[]> {
  const out: { p: string; s: number; m: number }[] = []
  const walk = async (dir: string, rel: string) => {
    const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const it of items) {
      const p = rel ? `${rel}/${it.name}` : it.name
      if (ignored(p)) continue
      const abs = path.join(dir, it.name)
      if (it.isDirectory()) await walk(abs, p)
      else if (it.isFile()) {
        const st = await fsp.stat(abs).catch(() => null)
        if (st) out.push({ p, s: st.size, m: Math.floor(st.mtimeMs) })
      }
    }
  }
  await walk(root, '')
  return out
}

export async function hashFile(abs: string): Promise<string> {
  const h = crypto.createHash('sha1')
  await pipeline(fs.createReadStream(abs), h)
  return h.digest('hex')
}
