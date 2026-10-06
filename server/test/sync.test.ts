import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.ts'
import { migrate, pgDb, type Db } from '../src/db.ts'
import { MIGRATIONS } from '../../src/data/migrations'
import { enableSync, pendingCount, runSync, type SyncHooks } from '../../src/sync/engine'
import type { SyncDb } from '../../src/sync/kinds'

/**
 * Сквозная проверка: настоящий сервер (Postgres — PGlite в процессе) и два «устройства» — базы SQLite
 * с той же схемой и триггерами, что в приложении, и тем же движком синхронизации.
 *
 * TEST_DATABASE_URL=postgres://… — то же на настоящем Postgres через драйвер pg (база очищается!).
 */

function pglite(pg: PGlite): Db {
  const wrap = (c: Pick<PGlite, 'query'>): Db => ({
    query: async <T>(sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as T[],
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
  })
  return wrap(pg)
}

let SQL: SqlJsStatic
let oldToken = ''
let app: FastifyInstance

class Device {
  readonly db: Database
  prefs: Record<string, unknown> = {}
  token = ''
  constructor(readonly name: string) {
    this.db = new SQL.Database()
    for (const m of MIGRATIONS) for (const s of m.statements) this.db.run(s)
  }
  readonly sdb: SyncDb = {
    all: async <T>(sql: string, params: unknown[] = []) => this.all<T>(sql, params),
    batch: async (stmts) => {
      this.db.run('BEGIN')
      try {
        for (const s of stmts) this.db.run(s.sql, (s.params ?? []) as never)
        this.db.run('COMMIT')
      } catch (e) {
        this.db.run('ROLLBACK')
        throw e
      }
    },
  }
  all<T>(sql: string, params: unknown[] = []): T[] {
    const st = this.db.prepare(sql)
    st.bind(params as never)
    const out: T[] = []
    while (st.step()) out.push(st.getAsObject() as T)
    st.free()
    return out
  }
  run(sql: string, params: unknown[] = []) {
    this.db.run(sql, params as never)
  }
  /** Файлы обложек устройства: ключ → картинка */
  covers = new Map<string, string>()
  hooks: SyncHooks = {
    readPrefs: () => this.prefs,
    applyPrefs: (d) => (this.prefs = { ...d }),
    readCover: async (art) => this.covers.get(art) ?? null,
    saveCover: async (image) => {
      const key = `${this.name}-${image.length}-${image.slice(-6)}`
      this.covers.set(key, image)
      return key
    },
  }
  async sync() {
    const token = this.token
    return runSync(
      this.sdb,
      {
        async sync(body) {
          const r = await app.inject({
            method: 'POST',
            url: '/v1/sync',
            headers: { authorization: `Bearer ${token}` },
            payload: body,
          })
          if (r.statusCode !== 200) throw new Error(`${r.statusCode} ${r.body}`)
          return r.json()
        },
      },
      this.hooks,
    )
  }
  track(key: string, title: string) {
    this.run(
      `INSERT INTO tracks (key, uri, path, file_name, title, artist, duration_ms, added_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Кино', 200000, 1, 1)`,
      [key, `local://${key}`, `Music/${title}.mp3`, `${title}.mp3`, title],
    )
  }
  play(key: string, startedAt: number, finished = true) {
    this.run(
      `INSERT INTO play_events (track_key, started_at, ended_at, tz_offset, local_day, local_hour, weekday, listened_ms, duration_ms, end_reason, counted)
       VALUES (?, ?, ?, 180, '2026-10-05', 12, 1, 150000, 200000, ?, 1)`,
      [key, startedAt, finished ? startedAt + 150000 : null, finished ? 'completed' : null],
    )
  }
}

async function post(url: string, payload: unknown, token?: string) {
  const r = await app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  return { status: r.statusCode, body: r.json() as Record<string, unknown> }
}

let closeDb = async () => {}
let baseUrl = ''
beforeAll(async () => {
  SQL = await initSqlJs()
  let db: Db
  const url = process.env.TEST_DATABASE_URL
  if (url) {
    const pg = pgDb(url)
    await pg.query('DROP TABLE IF EXISTS items, devices, users CASCADE')
    closeDb = () => pg.close()
    db = pg
  } else {
    db = pglite(await PGlite.create())
  }
  await migrate(db)
  app = await buildApp(db, { allowSignup: true })
  baseUrl = await app.listen({ host: '127.0.0.1', port: 0 })
})
afterAll(async () => {
  await app.close()
  await closeDb()
})

/** Поток событий устройства по настоящему HTTP: названия пришедших событий по мере прихода */
async function listen(token: string) {
  const ctl = new AbortController()
  const res = await fetch(`${baseUrl}/v1/events`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal })
  const events: string[] = []
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        for (const m of dec.decode(value, { stream: true }).matchAll(/^event: (\w+)/gm)) events.push(m[1]!)
      }
    } catch {
      /* закрыли сами */
    }
  })()
  const until = async (n: number) => {
    for (let i = 0; i < 100 && events.length < n; i++) await new Promise((r) => setTimeout(r, 20))
    return events
  }
  return { status: res.status, type: res.headers.get('content-type'), events, until, close: () => ctl.abort() }
}

describe('аккаунт', () => {
  it('регистрация, вход, ошибки', async () => {
    const reg = await post('/v1/auth/register', {
      email: 'Me@Example.com ',
      password: 'secret-pass',
      device: { name: 'Телефон', platform: 'android' },
    })
    expect(reg.status).toBe(200)
    expect(reg.body.email).toBe('me@example.com')
    expect((await post('/v1/auth/register', { email: 'me@example.com', password: 'secret-pass' })).status).toBe(409)
    expect((await post('/v1/auth/register', { email: 'x@y.z', password: 'short' })).status).toBe(400)
    expect((await post('/v1/auth/login', { email: 'me@example.com', password: 'wrong-pass' })).status).toBe(401)
    const login = await post('/v1/auth/login', {
      email: 'ME@example.com',
      password: 'secret-pass',
      device: { name: 'ПК', platform: 'desktop' },
    })
    expect(login.status).toBe(200)
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${login.body.token}` } })
    expect(me.json().devices).toHaveLength(2)
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401)
  })

  it('выход отзывает токен', async () => {
    const login = await post('/v1/auth/login', { email: 'me@example.com', password: 'secret-pass' })
    const token = String(login.body.token)
    expect((await post('/v1/auth/logout', {}, token)).status).toBe(200)
    expect((await post('/v1/sync', { cursor: 0, changes: [] }, token)).status).toBe(401)
  })
})

describe('синхронизация телефона и компьютера', () => {
  let phone: Device
  let pc: Device

  beforeAll(async () => {
    phone = new Device('phone')
    pc = new Device('pc')
    phone.token = String(
      (await post('/v1/auth/login', { email: 'me@example.com', password: 'secret-pass', device: { name: 'Телефон' } })).body
        .token,
    )
    pc.token = String(
      (await post('/v1/auth/login', { email: 'me@example.com', password: 'secret-pass', device: { name: 'ПК' } })).body.token,
    )
    oldToken = String(
      (await post('/v1/auth/login', { email: 'me@example.com', password: 'secret-pass', device: { name: 'Старый' } })).body.token,
    )
  })

  it('пока синхронизация выключена, журнал не растёт', () => {
    phone.track('k1', 'Группа крови')
    phone.play('k1', 1000)
    expect(phone.all(`SELECT * FROM sync_outbox`)).toHaveLength(0)
  })

  it('первое включение: всё с телефона уходит на сервер и приходит на компьютер', async () => {
    // Телефон: оценка, избранное, прослушивания, плейлист со стыком, эпоха, контекст, дневник, метка
    phone.track('k3', 'Звезда по имени Солнце') // этого трека на компьютере нет
    phone.run(`INSERT INTO track_user (key, rating, rated_at, favorite_at, updated_at) VALUES ('k1', 8, 5000, 5000, 5000)`)
    phone.play('k1', 2000)
    phone.play('k3', 3000)
    phone.play('k1', 9000, false) // ещё играет
    phone.run(`INSERT INTO playlists (name, kind, created_at, updated_at) VALUES ('В дорогу', 'mix', 111, 111)`)
    phone.run(
      `INSERT INTO playlist_items (playlist_id, pos, track_key, transition, added_at) VALUES (1, 0, 'k1', NULL, 1), (1, 1, 'k3', '{"type":"crossfade"}', 2)`,
    )
    phone.run(`INSERT INTO eras (title, start_day, end_day, created_at) VALUES ('Лето', '2026-06-01', '2026-08-31', 222)`)
    phone.run(`INSERT INTO contexts (title, created_at) VALUES ('Пробежка', 333)`)
    phone.run(`INSERT INTO context_intervals (context_id, start_at, end_at) VALUES (1, 4000, 5000)`)
    phone.run(`INSERT INTO diary (day, mood, note, updated_at) VALUES ('2026-10-05', 4, 'Хороший день', 6000)`)
    phone.run(`INSERT INTO bookmarks (track_key, position_ms, title, created_at) VALUES ('k1', 42000, 'Припев', 7000)`)
    phone.prefs = { counting: { minMs: 30000 }, soundPresets: [{ id: 'a', name: 'Ночной' }] }

    // Компьютер: тот же трек k1 (файл тот же) и своё; одно прослушивание уже перенесено бэкапом
    pc.track('k1', 'Группа крови')
    pc.track('k2', 'Кукушка')
    pc.play('k1', 1000) // то же самое, что на телефоне
    pc.run(`INSERT INTO track_user (key, rating, updated_at) VALUES ('k1', 4, 100)`) // старее телефонной
    pc.run(`INSERT INTO track_user (key, rating, updated_at) VALUES ('k2', 10, 8000)`)
    pc.play('k2', 8000)

    await enableSync(phone.sdb)
    const r1 = await phone.sync()
    expect(r1.pushed).toBeGreaterThan(8)
    // Незаконченное прослушивание не уходит: в журнал его положит триггер, когда трек доиграет
    expect(await pendingCount(phone.sdb)).toBe(0)
    expect(phone.all(`SELECT COUNT(*) AS n FROM play_events WHERE end_reason IS NULL`)).toEqual([{ n: 1 }])

    await enableSync(pc.sdb)
    await pc.sync()

    const plays = pc.all<{ track_key: string; started_at: number }>(
      `SELECT track_key, started_at FROM play_events ORDER BY started_at`,
    )
    expect(plays.map((p) => `${p.track_key}@${p.started_at}`)).toEqual(['k1@1000', 'k1@2000', 'k3@3000', 'k2@8000'])
    expect(pc.all(`SELECT rating, favorite_at FROM track_user WHERE key = 'k1'`)).toEqual([{ rating: 8, favorite_at: 5000 }])
    const pl = pc.all<{ id: number; name: string; kind: string }>(`SELECT id, name, kind FROM playlists`)
    expect(pl).toEqual([{ id: 1, name: 'В дорогу', kind: 'mix' }])
    expect(pc.all(`SELECT track_key, transition FROM playlist_items ORDER BY pos`)).toEqual([
      { track_key: 'k1', transition: null },
      { track_key: 'k3', transition: '{"type":"crossfade"}' },
    ])
    expect(pc.all(`SELECT title FROM eras`)).toEqual([{ title: 'Лето' }])
    expect(
      pc.all(`SELECT c.title, i.start_at, i.end_at FROM context_intervals i JOIN contexts c ON c.id = i.context_id`),
    ).toEqual([{ title: 'Пробежка', start_at: 4000, end_at: 5000 }])
    expect(pc.all(`SELECT note FROM diary`)).toEqual([{ note: 'Хороший день' }])
    expect(pc.all(`SELECT title FROM bookmarks`)).toEqual([{ title: 'Припев' }])
    expect(pc.prefs).toEqual(phone.prefs)
    // Трек, которого на компьютере нет, — карточка с названием, помеченная пропавшей
    const k3 = pc.all<{ title: string; missing_since: number | null; uri: string }>(
      `SELECT title, missing_since, uri FROM tracks WHERE key = 'k3'`,
    )
    expect(k3[0]?.title).toBe('Звезда по имени Солнце')
    expect(k3[0]?.missing_since).not.toBeNull()
    // Применённое с сервера не попало в журнал компьютера (эхо не уходит обратно)
    expect(await pendingCount(pc.sdb)).toBe(0)
  })

  it('обратно: данные компьютера приходят на телефон', async () => {
    await phone.sync()
    expect(phone.all(`SELECT rating FROM track_user WHERE key = 'k2'`)).toEqual([{ rating: 10 }])
    expect(phone.all(`SELECT COUNT(*) AS n FROM play_events WHERE end_reason IS NOT NULL`)).toEqual([{ n: 4 }])
    expect(phone.all(`SELECT title FROM tracks WHERE key = 'k2'`)).toEqual([{ title: 'Кукушка' }])
  })

  it('правки и удаления расходятся, побеждает более позднее изменение', async () => {
    pc.run(`UPDATE playlists SET name = 'В дорогу (ПК)', updated_at = 9999 WHERE created_at = 111`)
    pc.run(`DELETE FROM playlist_items WHERE track_key = 'k1'`)
    pc.run(`DELETE FROM eras WHERE created_at = 222`)
    pc.run(`UPDATE diary SET note = 'Изменено на ПК', updated_at = 9999 WHERE day = '2026-10-05'`)
    await pc.sync()
    // Телефон тем временем правит ту же запись дневника позже
    await new Promise((r) => setTimeout(r, 5))
    phone.run(`UPDATE diary SET note = 'Изменено на телефоне', updated_at = 10000 WHERE day = '2026-10-05'`)
    await phone.sync()
    expect(phone.all(`SELECT name FROM playlists`)).toEqual([{ name: 'В дорогу (ПК)' }])
    expect(phone.all(`SELECT track_key FROM playlist_items`)).toEqual([{ track_key: 'k3' }])
    expect(phone.all(`SELECT COUNT(*) AS n FROM eras`)).toEqual([{ n: 0 }])
    await pc.sync()
    expect(pc.all(`SELECT note FROM diary`)).toEqual([{ note: 'Изменено на телефоне' }])
    expect(phone.all(`SELECT note FROM diary`)).toEqual([{ note: 'Изменено на телефоне' }])
  })

  it('названия на любом языке: é, иероглифы, эмодзи', async () => {
    phone.track('u1', 'Café 東京 🎵')
    phone.run(`INSERT INTO track_user (key, rating, updated_at) VALUES ('u1', 8, 30000)`)
    await phone.sync()
    await pc.sync()
    expect(pc.all(`SELECT title FROM tracks WHERE key = 'u1'`)).toEqual([{ title: 'Café 東京 🎵' }])
  })

  it('правка той же записи upsert-ом не падает (оценка дважды подряд)', async () => {
    const upsert = (r: number) =>
      phone.run(
        `INSERT INTO track_user (key, rating, updated_at) VALUES ('k1', ?, ?) ON CONFLICT(key) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
        [r, 20000 + r],
      )
    upsert(6)
    upsert(7)
    phone.run(`UPDATE OR IGNORE track_user SET note = 'x' WHERE key = 'k1'`)
    expect(phone.all(`SELECT rating FROM track_user WHERE key = 'k1'`)).toEqual([{ rating: 7 }])
    expect(phone.all(`SELECT COUNT(*) AS n FROM sync_outbox WHERE kind = 'track'`)).toEqual([{ n: 1 }])
    await phone.sync()
    await pc.sync()
    expect(pc.all(`SELECT rating FROM track_user WHERE key = 'k1'`)).toEqual([{ rating: 7 }])
  })

  it('доигравший трек уходит после окончания', async () => {
    phone.run(`UPDATE play_events SET ended_at = 9500, end_reason = 'skipped' WHERE started_at = 9000`)
    await phone.sync()
    expect(await pendingCount(phone.sdb)).toBe(0)
    await pc.sync()
    expect(pc.all(`SELECT end_reason FROM play_events WHERE started_at = 9000`)).toEqual([{ end_reason: 'skipped' }])
  })

  it('смена ключа трека не оставляет дублей', async () => {
    // Сканер пересчитал отпечаток k3 → k3new (так бывает при обновлении сканера)
    phone.run(`UPDATE play_events SET track_key = 'k3new' WHERE track_key = 'k3'`)
    await phone.sync()
    await pc.sync()
    expect(pc.all(`SELECT track_key FROM play_events WHERE started_at = 3000`)).toEqual([{ track_key: 'k3new' }])
  })

  it('группы, закрепление и порядок плейлистов расходятся; обложка — картинкой', async () => {
    phone.covers.set('art-1', 'QUJDREVGR0g=')
    phone.run(`INSERT INTO playlist_groups (name, pos, created_at, updated_at) VALUES ('Для бега', 0, 500, 500)`)
    phone.run(
      `INSERT INTO playlists (name, kind, created_at, updated_at, pos, group_at, pin_pos, cover) VALUES ('Утро', 'manual', 600, 600, 2.5, 500, 1, 'art-1')`,
    )
    await phone.sync()
    await pc.sync()
    expect(pc.all(`SELECT name, pos FROM playlist_groups`)).toEqual([{ name: 'Для бега', pos: 0 }])
    const got = pc.all<{ pos: number; group_at: number; pin_pos: number; cover: string }>(
      `SELECT pos, group_at, pin_pos, cover FROM playlists WHERE created_at = 600`,
    )[0]!
    expect([got.pos, got.group_at, got.pin_pos]).toEqual([2.5, 500, 1])
    // Обложка пришла самой картинкой и сохранилась файлом на компьютере
    expect(pc.covers.get(got.cover)).toBe('QUJDREVGR0g=')

    // Компьютер переносит плейлист из группы и открепляет; телефон получает
    pc.run(`UPDATE playlists SET group_at = NULL, pin_pos = NULL, pos = -1, updated_at = 700 WHERE created_at = 600`)
    await pc.sync()
    await phone.sync()
    expect(phone.all(`SELECT pos, group_at, pin_pos FROM playlists WHERE created_at = 600`)).toEqual([
      { pos: -1, group_at: null, pin_pos: null },
    ])
    // Правка плейлиста без смены обложки картинку заново не отправляет
    expect(phone.all(`SELECT COUNT(*) AS n FROM sync_outbox WHERE kind = 'pcover'`)).toEqual([{ n: 0 }])
  })

  it('устройство со старой версией не сбрасывает группу и закрепление', async () => {
    phone.run(`UPDATE playlists SET group_at = 500, pin_pos = 3, updated_at = 800 WHERE created_at = 600`)
    await phone.sync()
    await pc.sync()
    // Старое приложение присылает плейлист без новых полей (0.4.x о них не знает)
    const items = [
      {
        kind: 'playlist',
        id: '600',
        updatedAt: Date.now() + 60_000,
        deleted: false,
        data: { name: 'Утро!', kind: 'manual', rules: null, sort: null, note: null, created_at: 600, updated_at: 900, items: [] },
      },
    ]
    const r = await app.inject({
      method: 'POST',
      url: '/v1/sync',
      headers: { authorization: `Bearer ${oldToken}` },
      payload: { cursor: 0, changes: items },
    })
    expect(r.statusCode).toBe(200)
    await pc.sync()
    expect(pc.all(`SELECT name, group_at, pin_pos FROM playlists WHERE created_at = 600`)).toEqual([
      { name: 'Утро!', group_at: 500, pin_pos: 3 },
    ])
  })

  it('одинаковые настройки не гоняются туда-обратно', async () => {
    pc.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('app', '{"theme":"light"}')`)
    const r = await pc.sync()
    expect(r.pushed).toBe(0)
  })

  it('удаление аккаунта стирает данные с сервера', async () => {
    const tmp = await post('/v1/auth/register', { email: 'tmp@example.com', password: 'tmp-password' })
    const t = String(tmp.body.token)
    await post(
      '/v1/sync',
      { cursor: 0, changes: [{ kind: 'diary', id: 'x', data: { note: 1 }, deleted: false, updatedAt: 1 }] },
      t,
    )
    const del = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: { authorization: `Bearer ${t}` },
      payload: { password: 'tmp-password' },
    })
    expect(del.statusCode).toBe(200)
    expect((await post('/v1/auth/login', { email: 'tmp@example.com', password: 'tmp-password' })).status).toBe(401)
  })
})

describe('закрытая регистрация', () => {
  it('без кода приглашения — отказ', async () => {
    const pg = await PGlite.create()
    const db = pglite(pg)
    await migrate(db)
    const closed = await buildApp(db, { allowSignup: true, signupCode: 'amber-2026' })
    const no = await closed.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'a@b.c', password: '12345678' },
    })
    expect(no.statusCode).toBe(403)
    const yes = await closed.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'a@b.c', password: '12345678', code: 'amber-2026' },
    })
    expect(yes.statusCode).toBe(200)
    await closed.close()
  })
})

describe('мгновенная доставка', () => {
  it('изменение одного устройства сразу будит остальные, но не его само', async () => {
    const login = async (name: string) =>
      String((await post('/v1/auth/login', { email: 'me@example.com', password: 'secret-pass', device: { name } })).body.token)
    const [a, b] = [await login('А'), await login('Б')]
    const [la, lb] = [await listen(a), await listen(b)]
    expect(lb.status).toBe(200)
    expect(lb.type).toContain('text/event-stream')
    expect(await lb.until(1)).toEqual(['hello'])
    await la.until(1)

    const item = { kind: 'rate', id: 'live-1', data: { rating: 9 }, deleted: false, updatedAt: Date.now() }
    expect((await post('/v1/sync', { cursor: 0, changes: [item] }, a)).status).toBe(200)
    expect(await lb.until(2)).toEqual(['hello', 'changed'])
    // Пустая синхронизация и повтор той же записи никого не будят
    await post('/v1/sync', { cursor: 0, changes: [] }, a)
    await post('/v1/sync', { cursor: 0, changes: [item] }, a)
    await new Promise((r) => setTimeout(r, 150))
    expect(lb.events).toEqual(['hello', 'changed'])
    expect(la.events).toEqual(['hello'])
    la.close()
    lb.close()
  })

  it('без входа поток не открывается', async () => {
    const r = await fetch(`${baseUrl}/v1/events`, { headers: { authorization: 'Bearer nope' } })
    expect(r.status).toBe(401)
  })
})
