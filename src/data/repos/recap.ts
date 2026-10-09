import { all } from '../db'
import { periodStats, type PeriodStats } from './eras'

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
}

export async function buildRecap(from: string, to: string): Promise<Recap> {
  const [stats, hours, busiest, favs, days] = await Promise.all([
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
