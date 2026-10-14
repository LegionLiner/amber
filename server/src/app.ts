import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import type { Db } from './db.ts'
import { hashPassword, newToken, tokenHash, verifyPassword } from './auth.ts'
import { COMMANDS, LiveHub, type Role, type Stream } from './live.ts'

/**
 * HTTP API сервера Amber. Всё под /v1:
 *
 *   POST   /v1/auth/register  {email, password, device: {name, platform}} → {token, email}
 *   POST   /v1/auth/login     то же                                       → {token, email}
 *   POST   /v1/auth/logout    выйти на этом устройстве
 *   GET    /v1/me             аккаунт и устройства
 *   DELETE /v1/devices/:id    выйти на другом устройстве
 *   DELETE /v1/me {password}  удалить аккаунт со всеми данными
 *   POST   /v1/sync           {cursor, changes} → {cursor, changes, more}
 *   GET    /v1/events?role=ui|engine  поток событий (SSE): changed, player, command — см. live.ts
 *   POST   /v1/player         {state} — что играет на этом устройстве; остальным уходит событие player
 *   POST   /v1/command        {to, cmd, args} — команда другому устройству: пауза, следующий, «играй отсюда»
 *   GET    /v1/health
 *
 * Синхронизация: устройство отправляет свои изменения и получает чужие после своего курсора.
 * Из двух версий записи остаётся более поздняя (по времени изменения на устройстве), при равенстве — та,
 * что пришла на сервер раньше. Удаление — тоже
 * запись (deleted), чтобы другое устройство узнало о нём. Треков на сервере нет: только данные о них.
 *
 * Мгновенная доставка: устройство держит открытым /v1/events. Как только сервер принял изменения от одного
 * устройства, остальным устройствам аккаунта уходит «changed», и они тут же делают обычный /v1/sync.
 * Сами данные по потоку не ходят — он только будит. Слушатели живут в памяти процесса: сервер один.
 */

export interface AppOptions {
  /** Можно ли заводить новые аккаунты (после своего — стоит выключить) */
  allowSignup: boolean
  /** Если задан — регистрация только с этим кодом */
  signupCode?: string
  logger?: boolean
  version?: string
}

interface Item {
  kind: string
  id: string
  data: unknown
  deleted: boolean
  updatedAt: number
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; deviceId: string }
  }
}

/** Раз в столько потоку событий шлётся пустая строка: прокси (nginx, 60–120 с) не рвёт молчащее соединение */
const HEARTBEAT_MS = 25_000
const PAGE = 1000
const MAX_CHANGES = 2000
const MAX_ITEM_BYTES = 256 * 1024
/** Состояние плеера: текущий трек и окно очереди ключами — десятки килобайт с запасом */
const MAX_STATE_BYTES = 96 * 1024

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const normEmail = (e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : '')

function deviceOf(body: Record<string, unknown>) {
  const d = (body.device ?? {}) as Record<string, unknown>
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 80) : 'Устройство'
  const platform = typeof d.platform === 'string' ? d.platform.slice(0, 20) : 'unknown'
  return { name, platform }
}

export async function buildApp(db: Db, opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ? { level: 'info', redact: ['req.headers.authorization'] } : false,
    // Первая синхронизация отправляет всю историю: до 25 МБ за раз
    bodyLimit: 25 * 1024 * 1024,
    // За nginx: адрес клиента — из X-Forwarded-For (для ограничения попыток входа)
    trustProxy: true,
  })

  // Токен в заголовке, без cookie: любой источник (окно на ПК, WebView на телефоне) может обращаться
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  })
  await app.register(rateLimit, { global: false })

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err instanceof HttpError ? err.status : (err.statusCode ?? 500)
    if (status >= 500) app.log.error(err)
    void reply.status(status).send({ error: status >= 500 ? 'Ошибка сервера' : err.message })
  })

  async function auth(req: FastifyRequest) {
    const h = req.headers.authorization ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : ''
    if (!token) throw new HttpError(401, 'Нужно войти')
    const rows = await db.query<{ id: string; user_id: string }>(`SELECT id, user_id FROM devices WHERE token_hash = $1`, [
      tokenHash(token),
    ])
    const d = rows[0]
    if (!d) throw new HttpError(401, 'Вход устарел: войди снова')
    req.auth = { userId: d.user_id, deviceId: d.id }
    await db.query(`UPDATE devices SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 minute'`, [d.id])
  }

  async function issue(userId: string, body: Record<string, unknown>) {
    const token = newToken()
    const { name, platform } = deviceOf(body)
    await db.query(`INSERT INTO devices (user_id, name, platform, token_hash) VALUES ($1, $2, $3, $4)`, [
      userId,
      name,
      platform,
      tokenHash(token),
    ])
    return token
  }

  /** Открытые потоки событий и что играет на устройствах */
  const live = new LiveHub()
  // Сервер останавливается — потоки закрываются сами, иначе close() ждал бы их вечно
  app.addHook('preClose', async () => live.closeAll())

  async function deviceRef(deviceId: string) {
    const [d] = await db.query<{ name: string; platform: string }>(`SELECT name, platform FROM devices WHERE id = $1`, [deviceId])
    return { id: deviceId, name: d?.name ?? 'Устройство', platform: d?.platform ?? 'unknown' }
  }

  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

  app.get('/v1/health', async () => ({ ok: true, version: opts.version ?? 'dev' }))

  app.post('/v1/auth/register', authLimit, async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    if (!opts.allowSignup) throw new HttpError(403, 'Регистрация на этом сервере закрыта')
    if (opts.signupCode && body.code !== opts.signupCode) throw new HttpError(403, 'Неверный код приглашения')
    const email = normEmail(body.email)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Похоже, это не адрес почты')
    if (password.length < 8) throw new HttpError(400, 'Пароль — не короче 8 символов')
    const exists = await db.query(`SELECT 1 FROM users WHERE email = $1`, [email])
    if (exists.length) throw new HttpError(409, 'Аккаунт с этой почтой уже есть: войди')
    const rows = await db.query<{ id: string }>(`INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id`, [
      email,
      await hashPassword(password),
    ])
    return { token: await issue(rows[0]!.id, body), email }
  })

  app.post('/v1/auth/login', authLimit, async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const email = normEmail(body.email)
    const password = typeof body.password === 'string' ? body.password : ''
    const rows = await db.query<{ id: string; password: string }>(`SELECT id, password FROM users WHERE email = $1`, [email])
    const u = rows[0]
    // Одинаковый ответ для «нет такой почты» и «не тот пароль»
    if (!u || !(await verifyPassword(password, u.password))) throw new HttpError(401, 'Неверная почта или пароль')
    return { token: await issue(u.id, body), email }
  })

  app.post('/v1/auth/logout', async (req) => {
    await auth(req)
    await db.query(`DELETE FROM devices WHERE id = $1`, [req.auth!.deviceId])
    live.drop(req.auth!.userId, req.auth!.deviceId)
    return { ok: true }
  })

  app.get('/v1/me', async (req) => {
    await auth(req)
    const { userId, deviceId } = req.auth!
    const [u] = await db.query<{ email: string; created_at: Date }>(`SELECT email, created_at FROM users WHERE id = $1`, [userId])
    const devices = await db.query<{ id: string; name: string; platform: string; last_seen_at: Date }>(
      `SELECT id, name, platform, last_seen_at FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
      [userId],
    )
    const [counts] = await db.query<{ n: string }>(`SELECT count(*) AS n FROM items WHERE user_id = $1 AND NOT deleted`, [userId])
    return {
      email: u!.email,
      createdAt: u!.created_at,
      items: Number(counts?.n ?? 0),
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        lastSeenAt: d.last_seen_at,
        current: d.id === deviceId,
      })),
    }
  })

  app.delete('/v1/devices/:id', async (req) => {
    await auth(req)
    const { id } = req.params as { id: string }
    await db.query(`DELETE FROM devices WHERE id = $1 AND user_id = $2`, [id, req.auth!.userId])
    live.drop(req.auth!.userId, id)
    return { ok: true }
  })

  app.delete('/v1/me', authLimit, async (req) => {
    await auth(req)
    const body = (req.body ?? {}) as Record<string, unknown>
    const [u] = await db.query<{ password: string }>(`SELECT password FROM users WHERE id = $1`, [req.auth!.userId])
    if (!u || !(await verifyPassword(String(body.password ?? ''), u.password))) throw new HttpError(401, 'Неверный пароль')
    await db.query(`DELETE FROM users WHERE id = $1`, [req.auth!.userId])
    return { ok: true }
  })

  app.get('/v1/events', async (req, reply) => {
    await auth(req)
    const { userId, deviceId } = req.auth!
    const role: Role = (req.query as { role?: string }).role === 'engine' ? 'engine' : 'ui'
    const device = await deviceRef(deviceId)
    // Ответ пишем сами: это бесконечный поток. Заголовки CORS, которые уже поставил плагин, переносим
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx не копит поток в буфере, а отдаёт сразу
      'X-Accel-Buffering': 'no',
    })
    const stream: Stream = {
      deviceId,
      role,
      // JSON в одну строку: перевод строки разорвал бы событие
      send: (event, data) => void res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`),
      end: () => void res.end(),
    }
    const beat = setInterval(() => void res.write(':\n\n'), HEARTBEAT_MS)
    res.on('close', () => {
      clearInterval(beat)
      live.close(userId, stream)
    })
    live.open(userId, stream, device)
  })

  app.post('/v1/player', async (req) => {
    await auth(req)
    const { userId, deviceId } = req.auth!
    const state = (req.body as { state?: unknown } | null)?.state ?? null
    if (state !== null && typeof state !== 'object') throw new HttpError(400, 'Неверное состояние плеера')
    if (state && JSON.stringify(state).length > MAX_STATE_BYTES) throw new HttpError(413, 'Состояние плеера слишком большое')
    return { ok: true, live: live.setState(userId, deviceId, state) }
  })

  app.post('/v1/command', async (req) => {
    await auth(req)
    const { userId, deviceId } = req.auth!
    const body = (req.body ?? {}) as { to?: unknown; cmd?: unknown; args?: unknown }
    const to = typeof body.to === 'string' ? body.to : ''
    const cmd = typeof body.cmd === 'string' ? body.cmd : ''
    if (!to || !COMMANDS.has(cmd)) throw new HttpError(400, 'Неизвестная команда')
    if (body.args != null && JSON.stringify(body.args).length > MAX_ITEM_BYTES)
      throw new HttpError(413, 'Команда слишком большая')
    const r = live.command(userId, await deviceRef(deviceId), to, cmd, body.args)
    if (r === 'offline') throw new HttpError(404, 'Устройство не на связи')
    if (r === 'no-ui') throw new HttpError(409, 'На устройстве не открыт Amber')
    return { ok: true }
  })

  app.post('/v1/sync', async (req) => {
    await auth(req)
    const { userId, deviceId } = req.auth!
    const body = (req.body ?? {}) as { cursor?: unknown; changes?: unknown }
    const cursor = Math.max(0, Math.floor(Number(body.cursor) || 0))
    const raw = Array.isArray(body.changes) ? body.changes : []
    if (raw.length > MAX_CHANGES) throw new HttpError(413, `Не больше ${MAX_CHANGES} изменений за раз`)

    // Одна запись дважды в одном запросе — оставляем более позднюю (иначе Postgres откажет в upsert)
    const latest = new Map<string, Item>()
    for (const c of raw as Item[]) {
      if (typeof c?.kind !== 'string' || typeof c.id !== 'string' || !c.kind || c.kind.length > 32 || c.id.length > 512) {
        throw new HttpError(400, 'Неверная запись в изменениях')
      }
      const updatedAt = Math.floor(Number(c.updatedAt) || 0)
      const data = c.deleted ? null : (c.data ?? null)
      if (data != null && JSON.stringify(data).length > MAX_ITEM_BYTES) throw new HttpError(413, 'Запись слишком большая')
      const k = `${c.kind}\u0000${c.id}`
      const prev = latest.get(k)
      if (!prev || prev.updatedAt <= updatedAt) latest.set(k, { kind: c.kind, id: c.id, data, deleted: !!c.deleted, updatedAt })
    }

    const result = await db.tx(async (q) => {
      // Синхронизации одного аккаунта идут по очереди: номера изменений не перепрыгивают друг через друга
      await q.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [userId])
      let accepted = 0
      if (latest.size) {
        const rows = [...latest.values()].map((c) => ({
          kind: c.kind,
          id: c.id,
          data: c.data,
          deleted: c.deleted,
          updated_at: c.updatedAt,
        }))
        const res = await q.query<{ n: number }>(
          `WITH up AS (
             INSERT INTO items (user_id, kind, id, data, deleted, updated_at, origin)
             SELECT $1, x.kind, x.id, x.data, x.deleted, x.updated_at, $2
             FROM jsonb_to_recordset($3::jsonb) AS x(kind text, id text, data jsonb, deleted boolean, updated_at bigint)
             ON CONFLICT (user_id, kind, id) DO UPDATE
               SET data = EXCLUDED.data, deleted = EXCLUDED.deleted, updated_at = EXCLUDED.updated_at,
                   origin = EXCLUDED.origin, seq = nextval('item_seq')
               -- При равном времени остаётся то, что уже на сервере: так настройки нового устройства
               -- (у них время 0) не затирают общие, заданные первым подключённым
               WHERE items.updated_at < EXCLUDED.updated_at
             RETURNING 1
           ) SELECT count(*)::int AS n FROM up`,
          [userId, deviceId, JSON.stringify(rows)],
        )
        accepted = res[0]?.n ?? 0
      }
      const page = await q.query<{
        kind: string
        id: string
        data: unknown
        deleted: boolean
        updated_at: string
        seq: string
        origin: string | null
      }>(
        `SELECT kind, id, data, deleted, updated_at, seq, origin FROM items WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT ${PAGE}`,
        [userId, cursor],
      )
      const last = page.length ? Number(page[page.length - 1]!.seq) : cursor
      return {
        accepted,
        cursor: last,
        more: page.length === PAGE,
        // Свои же изменения устройству не нужны: курсор их всё равно проходит
        changes: page
          .filter((r) => r.origin !== deviceId)
          .map((r) => ({ kind: r.kind, id: r.id, data: r.data, deleted: r.deleted, updatedAt: Number(r.updated_at) })),
      }
    })
    // После фиксации в базе: остальные устройства аккаунта сразу идут за новым
    if (result.accepted > 0) live.changed(userId, deviceId)
    return result
  })

  return app
}
