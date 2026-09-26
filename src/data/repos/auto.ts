import { all } from '../db'
import type { AutoContext, HourStats } from '@/domain/auto'

const DAY = 86_400_000

/** Данные для автоплейлистов одним заходом: часы прослушиваний, последние 14 дней, год назад */
export async function loadAutoContext(now = Date.now()): Promise<AutoContext> {
  const [hourRows, recentRows, yearRows] = await Promise.all([
    all<{ key: string; hour: number; n: number }>(
      `SELECT track_key AS key, local_hour AS hour, COUNT(*) AS n
       FROM play_events WHERE counted = 1 GROUP BY track_key, local_hour`,
    ),
    all<{ key: string; n: number }>(
      `SELECT track_key AS key, COUNT(*) AS n FROM play_events
       WHERE counted = 1 AND started_at >= ? GROUP BY track_key`,
      [now - 14 * DAY],
    ),
    all<{ key: string }>(
      `SELECT DISTINCT track_key AS key FROM play_events
       WHERE counted = 1 AND started_at BETWEEN ? AND ?`,
      [now - 368 * DAY, now - 361 * DAY],
    ),
  ])
  const hours: HourStats = new Map()
  for (const r of hourRows) {
    let arr = hours.get(r.key)
    if (!arr) {
      arr = Array(24).fill(0) as number[]
      hours.set(r.key, arr)
    }
    arr[r.hour] = r.n
  }
  return {
    now,
    hours,
    recent14: new Map(recentRows.map((r) => [r.key, r.n])),
    yearAgo: new Set(yearRows.map((r) => r.key)),
  }
}
