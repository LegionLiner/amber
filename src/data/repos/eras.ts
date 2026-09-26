import { all, db } from '../db'
import type { SqlValue } from '@/native/types'

/**
 * Эпохи — отрезки жизни со своим саундтреком. Сезоны создаются сами (из дат истории),
 * свои эпохи («Переезд», «Первая работа») ты задаёшь датами.
 * Для любого отрезка считается «фирменное звучание»: треки, которые в этот период
 * звучали заметно чаще, чем обычно (lift).
 */

export interface EraRow {
  id: number
  title: string
  kind: 'season' | 'custom'
  startDay: string
  endDay: string
  color: string | null
  note: string | null
}

export function customEras(): Promise<EraRow[]> {
  return db
    .selectFrom('eras')
    .select(['id', 'title', 'kind', 'startDay', 'endDay', 'color', 'note'])
    .orderBy('startDay', 'desc')
    .execute()
}

export async function saveEra(e: Omit<EraRow, 'id' | 'kind'> & { id?: number }): Promise<number> {
  if (e.id) {
    await db
      .updateTable('eras')
      .set({ title: e.title, startDay: e.startDay, endDay: e.endDay, color: e.color, note: e.note })
      .where('id', '=', e.id)
      .execute()
    return e.id
  }
  const r = await db
    .insertInto('eras')
    .values({
      title: e.title,
      kind: 'custom',
      startDay: e.startDay,
      endDay: e.endDay,
      color: e.color,
      note: e.note,
      createdAt: Date.now(),
    })
    .executeTakeFirst()
  return Number(r.insertId)
}

export async function deleteEra(id: number): Promise<void> {
  await db.deleteFrom('eras').where('id', '=', id).execute()
}

export async function historyBounds(): Promise<{ first: string | null; last: string | null }> {
  const [r] = await all<{ first: string | null; last: string | null }>(
    `SELECT MIN(local_day) AS first, MAX(local_day) AS last FROM play_events WHERE counted = 1`,
  )
  return r ?? { first: null, last: null }
}

/** Сколько засчитано по сезонам/отрезкам сразу: для списка эпох */
export function playsByDay(): Promise<{ day: string; plays: number; listenedMs: number }[]> {
  return all(`SELECT local_day AS day, SUM(counted) AS plays, SUM(listened_ms) AS listenedMs FROM play_events GROUP BY local_day`)
}

export interface SignatureTrack {
  key: string
  plays: number
  total: number
  lift: number
}

export interface PeriodStats {
  plays: number
  listenedMs: number
  tracks: number
  days: number
  top: { key: string; plays: number; listenedMs: number }[]
  signature: SignatureTrack[]
  discoveries: string[]
}

export async function periodStats(from: string, to: string): Promise<PeriodStats> {
  const p: SqlValue[] = [from, to]
  const [tot, top, all2, discoveries, grand] = await Promise.all([
    all<{ plays: number; listenedMs: number; tracks: number; days: number }>(
      `SELECT COALESCE(SUM(counted), 0) AS plays, COALESCE(SUM(listened_ms), 0) AS listenedMs,
         COUNT(DISTINCT CASE WHEN counted = 1 THEN track_key END) AS tracks,
         COUNT(DISTINCT CASE WHEN counted = 1 THEN local_day END) AS days
       FROM play_events WHERE local_day BETWEEN ? AND ?`,
      p,
    ),
    all<{ key: string; plays: number; listenedMs: number }>(
      `SELECT track_key AS key, SUM(counted) AS plays, SUM(listened_ms) AS listenedMs FROM play_events
       WHERE local_day BETWEEN ? AND ? GROUP BY track_key HAVING SUM(counted) > 0
       ORDER BY plays DESC, listenedMs DESC LIMIT 50`,
      p,
    ),
    all<{ key: string; total: number }>(
      `SELECT track_key AS key, SUM(counted) AS total FROM play_events GROUP BY track_key HAVING SUM(counted) > 0`,
    ),
    all<{ key: string }>(
      `SELECT track_key AS key FROM play_events WHERE counted = 1 GROUP BY track_key HAVING MIN(local_day) BETWEEN ? AND ?`,
      p,
    ),
    all<{ n: number }>(`SELECT COALESCE(SUM(counted), 0) AS n FROM play_events`),
  ])
  const t = tot[0] ?? { plays: 0, listenedMs: 0, tracks: 0, days: 0 }
  const totalAll = grand[0]?.n ?? 0
  const totals = new Map(all2.map((r) => [r.key, r.total]))
  const signature = top
    .filter((r) => r.plays >= 2)
    .map((r) => {
      const total = totals.get(r.key) ?? r.plays
      const lift = t.plays && totalAll ? r.plays / t.plays / (total / totalAll) : 1
      return { key: r.key, plays: r.plays, total, lift }
    })
    .sort((a, b) => b.lift * Math.log(1 + b.plays) - a.lift * Math.log(1 + a.plays))
    .slice(0, 15)
  return { ...t, top, signature, discoveries: discoveries.map((d) => d.key) }
}
