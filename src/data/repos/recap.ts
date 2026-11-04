import { all } from '../db'
import { periodStats, type PeriodStats } from './eras'
import { IN_LIBRARY } from './spotify'

/**
 * Итоги месяца и года: всё для историй на весь экран.
 */
export interface Recap extends PeriodStats {
  from: string
  to: string
  peakHour: number | null
  busiestDay: { day: string; listenedMs: number } | null
  newFavorites: number
  activeDays: string[]
  hours: number[]
  /** Топ по времени: что слушал дольше всего (трек периода считается по нему). С запасом: треки без файла на слайдах отсеиваются */
  topByTime: { key: string; plays: number; listenedMs: number }[]
  /** Все треки периода с исполнителем из тегов — для честного топа исполнителей, а не по первой полусотне */
  artistRows: { key: string; plays: number; artist: string | null }[]
}

export async function buildRecap(from: string, to: string): Promise<Recap> {
  const [stats, hours, busiest, favs, days, byTime, artistRows] = await Promise.all([
    periodStats(from, to),
    all<{ hour: number; ms: number }>(
      `SELECT local_hour AS hour, SUM(listened_ms) AS ms FROM stat_plays WHERE local_day BETWEEN ? AND ? GROUP BY local_hour`,
      [from, to],
    ),
    all<{ day: string; listenedMs: number }>(
      `SELECT local_day AS day, SUM(listened_ms) AS listenedMs FROM stat_plays WHERE local_day BETWEEN ? AND ?
       GROUP BY local_day ORDER BY listenedMs DESC LIMIT 1`,
      [from, to],
    ),
    all<{ n: number }>(
      `SELECT COUNT(*) AS n FROM track_user WHERE favorite_at IS NOT NULL
       AND date(favorite_at / 1000, 'unixepoch', 'localtime') BETWEEN ? AND ?`,
      [from, to],
    ),
    all<{ day: string }>(
      `SELECT DISTINCT local_day AS day FROM stat_plays WHERE counted = 1 AND local_day BETWEEN ? AND ? ORDER BY day`,
      [from, to],
    ),
    all<{ key: string; plays: number; listenedMs: number }>(
      `SELECT track_key AS key, SUM(counted) AS plays, SUM(listened_ms) AS listenedMs FROM stat_plays
       WHERE local_day BETWEEN ? AND ? AND ${IN_LIBRARY} GROUP BY track_key HAVING SUM(counted) > 0
       ORDER BY listenedMs DESC, plays DESC LIMIT 50`,
      [from, to],
    ),
    all<{ key: string; plays: number; artist: string | null }>(
      `SELECT p.track_key AS key, SUM(p.counted) AS plays, COALESCE(t.artist, s.artist) AS artist
       FROM stat_plays p
       LEFT JOIN tracks t ON t.key = p.track_key
       LEFT JOIN spotify_tracks s ON s.uri = p.track_key
       WHERE p.local_day BETWEEN ? AND ?
       GROUP BY p.track_key HAVING SUM(p.counted) > 0`,
      [from, to],
    ),
  ])
  const h = Array(24).fill(0) as number[]
  for (const r of hours) h[r.hour] = r.ms
  const max = Math.max(...h)
  return {
    ...stats,
    from,
    to,
    hours: h,
    peakHour: max > 0 ? h.indexOf(max) : null,
    busiestDay: busiest[0] ?? null,
    newFavorites: favs[0]?.n ?? 0,
    activeDays: days.map((d) => d.day),
    topByTime: byTime,
    artistRows,
  }
}

/** Месяцы и годы, за которые есть что вспомнить */
export async function recapPeriods(): Promise<{ months: string[]; years: string[] }> {
  const rows = await all<{ m: string }>(
    `SELECT DISTINCT substr(local_day, 1, 7) AS m FROM stat_plays WHERE counted = 1 ORDER BY m DESC`,
  )
  const months = rows.map((r) => r.m)
  const years = [...new Set(months.map((m) => m.slice(0, 4)))]
  return { months, years }
}
