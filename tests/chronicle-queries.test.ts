import { beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'

/**
 * Ускоренные запросы хроники и главной должны отвечать ровно то же, что прежние «перебором всей истории».
 * База — настоящая схема (все миграции) в sql.js, мост MusicCore подменён.
 */
const SQL = await initSqlJs()
let sdb: Database

function rows(sql: string, params: unknown[] = []) {
  const r = sdb.exec(sql, params as never)
  return { columns: r[0]?.columns ?? [], values: r[0]?.values ?? [] }
}
vi.mock('@/native/music-core', () => ({
  MusicCore: {
    query: async ({ sql, params }: { sql: string; params?: unknown[] }) => rows(sql, params),
    execute: async ({ sql, params }: { sql: string; params?: unknown[] }) => {
      sdb.run(sql, params as never)
      return { changes: sdb.getRowsModified(), lastId: 0 }
    },
    batch: async ({ statements }: { statements: { sql: string; params?: unknown[] }[] }) => {
      for (const s of statements) sdb.run(s.sql, s.params as never)
      return { results: statements.map(() => ({ changes: 0, lastId: 0 })) }
    },
  },
}))

const { migrate } = await import('@/data/db')
const { diaryFeed, milestones } = await import('@/data/repos/diary')
const { recentPlays } = await import('@/data/repos/stats')

const DAY = 86_400_000
const day = (t: number) => new Date(t).toISOString().slice(0, 10)

beforeAll(async () => {
  sdb = new SQL.Database()
  await migrate()
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const start = Date.UTC(2023, 0, 1)
  // Свои прослушивания: 1500 за последние ~два года, 60 треков
  for (let i = 0; i < 1500; i++) {
    const t = start + 400 * DAY + Math.floor(rnd() * 600 * DAY)
    const listened = Math.floor(rnd() * 240_000)
    sdb.run(
      `INSERT INTO play_events (track_key, started_at, ended_at, tz_offset, local_day, local_hour, weekday, listened_ms, duration_ms, end_reason, counted)
       VALUES (?, ?, ?, 0, ?, 12, 1, ?, 200000, 'completed', ?)`,
      [`k${Math.floor(rnd() * 60)}`, t, t + listened, day(t), listened, listened > 60_000 ? 1 : 0],
    )
  }
  // История Spotify постарше: 3000 прослушиваний, часть треков сопоставлена с медиатекой
  for (let i = 0; i < 40; i++)
    sdb.run(`INSERT INTO spotify_tracks (uri, title, artist, track_key) VALUES (?, ?, 'A', ?)`, [
      `spotify:track:${i}`,
      `S${i}`,
      i < 10 ? `k${i}` : null,
    ])
  for (let i = 0; i < 3000; i++) {
    const t = start + Math.floor(rnd() * 700 * DAY)
    sdb.run(
      `INSERT INTO spotify_plays (uri, started_at, ended_at, tz_offset, local_day, local_hour, weekday, listened_ms, duration_ms, end_reason, counted)
       VALUES (?, ?, ?, 0, ?, 9, 2, 120000, 200000, 'completed', 1)`,
      [`spotify:track:${Math.floor(rnd() * 40)}`, t, t + 120_000, day(t)],
    )
  }
  sdb.run(`INSERT INTO settings (key, value) VALUES ('spotify:on', '1')`)
})

describe('запросы хроники', () => {
  it('лента дневника: те же 20 дней с теми же числами, и страница за страницей', async () => {
    const naive = (before: string) =>
      rows(
        `SELECT local_day, SUM(listened_ms), SUM(counted), COUNT(DISTINCT track_key), MIN(started_at), MAX(started_at)
         FROM stat_plays WHERE local_day < ? GROUP BY local_day ORDER BY local_day DESC LIMIT 20`,
        [before],
      ).values
    let before = '9999-12-31'
    for (let page = 0; page < 3; page++) {
      const feed = await diaryFeed(before, 20)
      expect(feed.map((d) => [d.day, d.listenedMs, d.plays, d.tracks, d.firstAt, d.lastAt])).toEqual(naive(before))
      before = feed.at(-1)!.day
    }
  })

  it('вехи по часам — одним проходом, те же даты', async () => {
    const marks = await milestones()
    const hours = marks.filter((m) => m.kind === 'hours').sort((a, b) => a.value - b.value)
    expect(hours.length).toBeGreaterThan(0)
    for (const m of hours) {
      const [r] = rows(
        `SELECT MIN(at) FROM (SELECT started_at AS at, SUM(listened_ms) OVER (ORDER BY started_at) AS cum FROM stat_plays) WHERE cum >= ?`,
        [m.value * 3_600_000],
      ).values
      expect(m.at).toBe(r![0])
    }
  })

  it('недавно игравшие — те же треки, что перебором всей истории', async () => {
    for (const limit of [5, 16, 60]) {
      const naive = rows(
        `SELECT track_key, MAX(started_at) AS s FROM stat_plays WHERE track_key NOT LIKE 'spotify:%'
         GROUP BY track_key ORDER BY s DESC LIMIT ?`,
        [limit],
      ).values
      expect((await recentPlays(limit)).map((r) => [r.key, r.startedAt])).toEqual(naive)
    }
  })

  it('Spotify выключен — его дни в ленту не попадают', async () => {
    sdb.run(`UPDATE settings SET value = '0' WHERE key = 'spotify:on'`)
    const feed = await diaryFeed('9999-12-31', 5000)
    const own = rows(`SELECT COUNT(DISTINCT local_day) FROM play_events`).values[0]![0]
    expect(feed.length).toBe(own)
    sdb.run(`UPDATE settings SET value = '1' WHERE key = 'spotify:on'`)
  })
})
