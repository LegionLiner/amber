import { all, batch } from '../db'

export interface DuelRow {
  id: number
  aKey: string
  bKey: string
  result: number
  at: number
}

export function recentDuels(limit = 200): Promise<DuelRow[]> {
  return all<DuelRow>(`SELECT id, a_key AS aKey, b_key AS bKey, result, at FROM duels ORDER BY at DESC LIMIT ?`, [limit])
}

export async function duelCount(): Promise<number> {
  const [r] = await all<{ n: number }>(`SELECT COUNT(*) AS n FROM duels`)
  return r?.n ?? 0
}

/** Результат дуэли и новые счета обоих треков — одной транзакцией */
export async function saveDuel(aKey: string, bKey: string, result: number, aScore: number, bScore: number): Promise<void> {
  const now = Date.now()
  const upd = (key: string, score: number) => ({
    sql: `INSERT INTO track_user (key, rank_score, duels, gain_offset_db, no_shuffle, updated_at) VALUES (?, ?, 1, 0, 0, ?)
          ON CONFLICT(key) DO UPDATE SET rank_score = excluded.rank_score, duels = duels + 1, updated_at = excluded.updated_at`,
    params: [key, score, now],
  })
  await batch([
    { sql: `INSERT INTO duels (a_key, b_key, result, at) VALUES (?, ?, ?, ?)`, params: [aKey, bKey, result, now] },
    upd(aKey, aScore),
    upd(bKey, bScore),
  ])
}

/** Новый порядок внутри группы звёзд после перетаскивания */
export async function saveScores(scores: { key: string; rankScore: number }[]): Promise<void> {
  const now = Date.now()
  await batch(
    scores.map((s) => ({
      sql: `UPDATE track_user SET rank_score = ?, updated_at = ? WHERE key = ?`,
      params: [s.rankScore, now, s.key],
    })),
  )
}
