import { all, batch } from '../db'
import { nextWeek, weekKey, weekRange } from '@/domain/weeks'

/**
 * Недельные чарты и снимки рейтинга.
 * Чарт недели — топ-20 по засчитанным прослушиваниям за понедельник…воскресенье; закрытые недели
 * архивируются в weekly_charts, чтобы у трека были «пик» и «недель в чарте».
 * Снимок рейтинга — места всех оценённых треков в начале недели: от него считаются стрелки ▲▼.
 */

export const CHART_SIZE = 20

export interface ChartEntry {
  key: string
  plays: number
  listenedMs: number
}

export function liveWeekChart(week: string): Promise<ChartEntry[]> {
  const { from, to } = weekRange(week)
  return all<ChartEntry>(
    `SELECT track_key AS key, SUM(counted) AS plays, SUM(listened_ms) AS listenedMs
     FROM play_events WHERE local_day BETWEEN ? AND ?
     GROUP BY track_key HAVING SUM(counted) > 0
     ORDER BY plays DESC, listenedMs DESC LIMIT ?`,
    [from, to, CHART_SIZE],
  )
}

export async function archivedWeek(week: string): Promise<ChartEntry[]> {
  return all<ChartEntry>(
    `SELECT track_key AS key, plays, listened_ms AS listenedMs FROM weekly_charts WHERE week = ? ORDER BY position`,
    [week],
  )
}

export async function archivedWeeks(): Promise<string[]> {
  const rows = await all<{ week: string }>(`SELECT DISTINCT week FROM weekly_charts ORDER BY week DESC`)
  return rows.map((r) => r.week)
}

/** Архивирует все закрытые недели, которых ещё нет в архиве */
export async function archiveClosedWeeks(now = new Date()): Promise<number> {
  const current = weekKey(now)
  const [first] = await all<{ day: string | null }>(`SELECT MIN(local_day) AS day FROM play_events WHERE counted = 1`)
  if (!first?.day) return 0
  const [last] = await all<{ week: string | null }>(`SELECT MAX(week) AS week FROM weekly_charts`)
  const [y, m, d] = first.day.split('-').map(Number)
  let week = last?.week ? nextWeek(last.week) : weekKey(new Date(y!, m! - 1, d!))
  let n = 0
  while (week < current) {
    const rows = await liveWeekChart(week)
    if (rows.length) {
      await batch(
        rows.map((r, i) => ({
          sql: `INSERT OR REPLACE INTO weekly_charts (week, position, track_key, plays, listened_ms) VALUES (?, ?, ?, ?, ?)`,
          params: [week, i + 1, r.key, r.plays, r.listenedMs],
        })),
      )
      n++
    }
    week = nextWeek(week)
  }
  return n
}

export interface ChartHistory {
  peak: number
  weeks: number
  lastWeek: string
}

/** Пик и число недель в чарте для каждого трека из архива */
export async function chartHistory(): Promise<Map<string, ChartHistory & { positions: Map<string, number> }>> {
  const rows = await all<{ week: string; position: number; key: string }>(
    `SELECT week, position, track_key AS key FROM weekly_charts ORDER BY week`,
  )
  const out = new Map<string, ChartHistory & { positions: Map<string, number> }>()
  for (const r of rows) {
    const h = out.get(r.key) ?? { peak: r.position, weeks: 0, lastWeek: r.week, positions: new Map<string, number>() }
    h.peak = Math.min(h.peak, r.position)
    h.weeks++
    h.lastWeek = r.week
    h.positions.set(r.week, r.position)
    out.set(r.key, h)
  }
  return out
}

/* ------------------------------ снимки рейтинга ------------------------------ */

export async function hasRankSnapshot(week: string): Promise<boolean> {
  const rows = await all<{ n: number }>(`SELECT COUNT(*) AS n FROM rank_snapshots WHERE week = ?`, [week])
  return (rows[0]?.n ?? 0) > 0
}

export async function saveRankSnapshot(week: string, orderedKeys: string[]): Promise<void> {
  if (!orderedKeys.length) return
  await batch([
    { sql: `DELETE FROM rank_snapshots WHERE week = ?`, params: [week] },
    ...orderedKeys.map((key, i) => ({
      sql: `INSERT INTO rank_snapshots (week, track_key, position) VALUES (?, ?, ?)`,
      params: [week, key, i + 1],
    })),
  ])
}

/** Места из снимка недели: ключ → позиция */
export async function rankSnapshot(week: string): Promise<Map<string, number>> {
  const rows = await all<{ key: string; position: number }>(
    `SELECT track_key AS key, position FROM rank_snapshots WHERE week = ?`,
    [week],
  )
  return new Map(rows.map((r) => [r.key, r.position]))
}
