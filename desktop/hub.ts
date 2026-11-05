import type http from 'node:http'
import fsp from 'node:fs/promises'
import { COMMANDS, LiveHub, type Role, type Stream } from '../server/src/live'

/**
 * Данные по Wi-Fi без серверов: компьютер сам становится «сервером синхронизации» для телефона.
 *
 * Протокол — тот же, что у server/ (src/sync/api.ts его и говорит), только живёт он в приложении на компьютере,
 * на том же порту, что и папка по Wi-Fi (desktop/filesync.ts), и с тем же подключением по коду:
 *   GET  /v1/health, GET /v1/me
 *   POST /v1/sync      {cursor, changes} → {cursor, changes, more} — из двух версий записи остаётся более поздняя
 *   GET  /v1/events    поток событий (SSE): changed, player, command
 *   POST /v1/player    что играет на устройстве; POST /v1/command — команда другому устройству
 *   POST /v1/auth/logout — устройство перестаёт синхронизировать данные (подключение остаётся)
 * Компьютер подключён к себе же: окно приложения ходит на 127.0.0.1 со своим токеном (localToken).
 * Так у телефона и компьютера один и тот же путь: записи, курсор, «что играет», «перенести туда».
 *
 * Записи — в памяти и в журнале hub.jsonl (строка на принятое изменение). При запуске журнал читается,
 * а когда в нём втрое больше строк, чем записей, переписывается заново.
 */

export interface HubDevice {
  id: string
  name: string
  platform: string
}

export interface HubHost {
  /** Файл журнала (функция: папка данных приложения известна не сразу) */
  file(): string
  /** Устройство по токену (подключённые телефоны и сам компьютер); null — не подключено */
  device(token: string): HubDevice | null
  /** Все устройства — для /v1/me */
  devices(): (HubDevice & { lastSeenAt: number | null })[]
}

interface Item {
  kind: string
  id: string
  data: unknown
  deleted: boolean
  updatedAt: number
  seq: number
  origin: string
}

/** Как в server/src/app.ts */
const PAGE = 1000
const MAX_CHANGES = 2000
const MAX_ITEM_BYTES = 256 * 1024
const MAX_STATE_BYTES = 96 * 1024
const MAX_BODY = 25 * 1024 * 1024
const HEARTBEAT_MS = 25_000
const USER = 'local'

export class HubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly en = message,
  ) {
    super(message)
  }
}

export class LocalHub {
  private items = new Map<string, Item>()
  private seq = 0
  private lines = 0
  private loaded: Promise<void> | null = null
  private writing: Promise<void> = Promise.resolve()
  readonly live = new LiveHub()

  constructor(private readonly host: HubHost) {}

  /** Сколько записей (без удалённых) — для настроек */
  get size(): number {
    let n = 0
    for (const it of this.items.values()) if (!it.deleted) n++
    return n
  }

  load(): Promise<void> {
    this.loaded ??= (async () => {
      const text = await fsp.readFile(this.host.file(), 'utf8').catch(() => '')
      for (const line of text.split('\n')) {
        if (!line) continue
        try {
          const it = JSON.parse(line) as Item
          this.items.set(key(it.kind, it.id), it)
          this.seq = Math.max(this.seq, it.seq)
          this.lines++
        } catch {
          /* оборванная последняя строка (выключили посреди записи) — без неё */
        }
      }
    })()
    return this.loaded
  }

  /** Принять изменения устройства и отдать ему чужие после курсора */
  async sync(device: HubDevice, body: { cursor?: unknown; changes?: unknown }) {
    await this.load()
    const cursor = Math.max(0, Math.floor(Number(body.cursor) || 0))
    const raw = Array.isArray(body.changes) ? body.changes : []
    if (raw.length > MAX_CHANGES)
      throw new HubError(413, `Не больше ${MAX_CHANGES} изменений за раз`, `No more than ${MAX_CHANGES} changes at once`)
    const accepted: Item[] = []
    for (const c of raw as Partial<Item>[]) {
      if (typeof c?.kind !== 'string' || typeof c.id !== 'string' || !c.kind || c.kind.length > 32 || c.id.length > 512)
        throw new HubError(400, 'Неверная запись в изменениях', 'Invalid record in changes')
      const updatedAt = Math.floor(Number(c.updatedAt) || 0)
      const data = c.deleted ? null : (c.data ?? null)
      if (data != null && JSON.stringify(data).length > MAX_ITEM_BYTES)
        throw new HubError(413, 'Запись слишком большая', 'Record too large')
      const k = key(c.kind, c.id)
      const prev = this.items.get(k)
      // При равном времени остаётся то, что уже есть (как на сервере): настройки нового устройства с временем 0
      // не затирают общие
      if (prev && prev.updatedAt >= updatedAt) continue
      const it: Item = { kind: c.kind, id: c.id, data, deleted: !!c.deleted, updatedAt, seq: ++this.seq, origin: device.id }
      this.items.set(k, it)
      accepted.push(it)
    }
    if (accepted.length) await this.append(accepted)

    const page = [...this.items.values()]
      .filter((it) => it.seq > cursor)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, PAGE)
    const result = {
      accepted: accepted.length,
      cursor: page.length ? page[page.length - 1]!.seq : Math.max(cursor, 0),
      more: page.length === PAGE,
      changes: page
        .filter((it) => it.origin !== device.id)
        .map((it) => ({ kind: it.kind, id: it.id, data: it.data, deleted: it.deleted, updatedAt: it.updatedAt })),
    }
    if (accepted.length) this.live.changed(USER, device.id)
    return result
  }

  /** Журнал: дописываем по порядку; разросся — переписываем начисто (через временный файл) */
  private append(items: Item[]): Promise<void> {
    this.writing = this.writing.then(async () => {
      if (this.lines + items.length > Math.max(5000, this.items.size * 3)) {
        const tmp = `${this.host.file()}.tmp`
        await fsp.writeFile(tmp, [...this.items.values()].map((it) => JSON.stringify(it) + '\n').join(''))
        await fsp.rename(tmp, this.host.file())
        this.lines = this.items.size
      } else {
        await fsp.appendFile(this.host.file(), items.map((it) => JSON.stringify(it) + '\n').join(''))
        this.lines += items.length
      }
    })
    return this.writing
  }

  /** Все данные забыть (компьютер перестал делиться ими) */
  async reset(): Promise<void> {
    await this.writing
    this.items.clear()
    this.seq = 0
    this.lines = 0
    this.loaded = Promise.resolve()
    await fsp.rm(this.host.file(), { force: true })
  }

  /** Запрос под /v1. false — не наш путь */
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    const p = url.pathname
    if (!p.startsWith('/v1/')) return false
    const route = `${req.method} ${p}`
    if (route === 'GET /v1/health') return json(res, { ok: true, version: 'amber-desktop' })
    const device = this.auth(req)
    if (route === 'GET /v1/me') {
      await this.load()
      return json(res, {
        email: '',
        items: this.size,
        devices: this.host.devices().map((d) => ({
          id: d.id,
          name: d.name,
          platform: d.platform,
          lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : null,
          current: d.id === device.id,
        })),
      })
    }
    if (route === 'POST /v1/sync')
      return json(res, await this.sync(device, (await body(req, MAX_BODY)) as Record<string, unknown>))
    if (route === 'GET /v1/events') {
      this.events(req, res, device, url.searchParams.get('role') === 'engine' ? 'engine' : 'ui')
      return true
    }
    if (route === 'POST /v1/player') {
      const state = ((await body(req, MAX_STATE_BYTES + 1024)) as { state?: unknown }).state ?? null
      if (state !== null && typeof state !== 'object')
        throw new HubError(400, 'Неверное состояние плеера', 'Invalid player state')
      return json(res, { ok: true, live: this.live.setState(USER, device.id, state) })
    }
    if (route === 'POST /v1/command') {
      const b = (await body(req, MAX_ITEM_BYTES + 1024)) as { to?: unknown; cmd?: unknown; args?: unknown }
      const to = typeof b.to === 'string' ? b.to : ''
      const cmd = typeof b.cmd === 'string' ? b.cmd : ''
      if (!to || !COMMANDS.has(cmd)) throw new HubError(400, 'Неизвестная команда', 'Unknown command')
      const r = this.live.command(USER, device, to, cmd, b.args)
      if (r === 'offline') throw new HubError(404, 'Устройство не на связи', 'The device is offline')
      if (r === 'no-ui') throw new HubError(409, 'На устройстве не открыт Amber', 'Amber is not open on the device')
      return json(res, { ok: true })
    }
    if (route === 'POST /v1/auth/logout') {
      this.live.drop(USER, device.id)
      return json(res, { ok: true })
    }
    throw new HubError(404, 'Не найдено', 'Not found')
  }

  private auth(req: http.IncomingMessage): HubDevice {
    const h = req.headers.authorization ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : ''
    const d = token ? this.host.device(token) : null
    if (!d) throw new HubError(401, 'Устройство не подключено к этому компьютеру', 'The device is not connected to this computer')
    return d
  }

  private events(req: http.IncomingMessage, res: http.ServerResponse, device: HubDevice, role: Role) {
    res.writeHead(200, {
      ...cors(),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    const stream: Stream = {
      deviceId: device.id,
      role,
      send: (event, data) => void res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`),
      end: () => void res.end(),
    }
    const beat = setInterval(() => void res.write(':\n\n'), HEARTBEAT_MS)
    req.socket.setKeepAlive(true, 20_000)
    res.on('close', () => {
      clearInterval(beat)
      this.live.close(USER, stream)
    })
    this.live.open(USER, stream, device)
  }

  close() {
    this.live.closeAll()
  }
}

const key = (kind: string, id: string) => `${kind}\u0000${id}`

/** Запросы приходят и из окна приложения (другой источник), и с телефона: токен в заголовке, без cookie */
export function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
  }
}

function json(res: http.ServerResponse, data: unknown, status = 200): true {
  const b = JSON.stringify(data)
  res.writeHead(status, { ...cors(), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) })
  res.end(b)
  return true
}

function body(req: http.IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new HubError(413, 'Слишком большой запрос', 'Request too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const s = Buffer.concat(chunks).toString('utf8')
        resolve(s ? JSON.parse(s) : {})
      } catch {
        reject(new HubError(400, 'Неверный запрос', 'Bad request'))
      }
    })
    req.on('error', reject)
  })
}
