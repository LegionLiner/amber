import { all, batch } from '../db'

/**
 * Соседи по истории: какие треки ты слушаешь рядом друг с другом.
 * Считается целиком в SQLite: для каждого засчитанного прослушивания берём четыре следующих (LEAD),
 * если они в пределах полутора часов; вес 1/расстояние, в обе стороны; у трека храним 30 сильнейших.
 */
const BUILD_SQL = `
INSERT INTO track_neighbors (key, other, score)
WITH p AS (
  SELECT track_key AS k, started_at AS t,
    LEAD(track_key, 1) OVER (ORDER BY started_at) AS k1, LEAD(started_at, 1) OVER (ORDER BY started_at) AS t1,
    LEAD(track_key, 2) OVER (ORDER BY started_at) AS k2, LEAD(started_at, 2) OVER (ORDER BY started_at) AS t2,
    LEAD(track_key, 3) OVER (ORDER BY started_at) AS k3, LEAD(started_at, 3) OVER (ORDER BY started_at) AS t3,
    LEAD(track_key, 4) OVER (ORDER BY started_at) AS k4, LEAD(started_at, 4) OVER (ORDER BY started_at) AS t4
  FROM play_events WHERE counted = 1
),
pairs AS (
  SELECT k AS a, k1 AS b, 1.0000 AS w FROM p WHERE k1 IS NOT NULL AND k1 <> k AND t1 - t < 5400000
  UNION ALL
  SELECT k AS a, k2 AS b, 0.5000 AS w FROM p WHERE k2 IS NOT NULL AND k2 <> k AND t2 - t < 5400000
  UNION ALL
  SELECT k AS a, k3 AS b, 0.3333 AS w FROM p WHERE k3 IS NOT NULL AND k3 <> k AND t3 - t < 5400000
  UNION ALL
  SELECT k AS a, k4 AS b, 0.2500 AS w FROM p WHERE k4 IS NOT NULL AND k4 <> k AND t4 - t < 5400000
),
sym AS (
  SELECT a AS key, b AS other, w FROM pairs
  UNION ALL
  SELECT b AS key, a AS other, w FROM pairs
),
summed AS (
  SELECT key, other, SUM(w) AS score FROM sym GROUP BY key, other
)
SELECT key, other, score FROM (
  SELECT key, other, score, ROW_NUMBER() OVER (PARTITION BY key ORDER BY score DESC) AS r FROM summed
) WHERE r <= 30`

const BUILT_KEY = 'neighbors:builtAt'

export async function neighborsAge(): Promise<number | null> {
  const rows = await all<{ value: string }>('SELECT value FROM settings WHERE key = ?', [BUILT_KEY])
  return rows[0] ? Date.now() - Number(rows[0].value) : null
}

export async function rebuildNeighbors(): Promise<void> {
  await batch([
    { sql: 'DELETE FROM track_neighbors' },
    { sql: BUILD_SQL },
    { sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', params: [BUILT_KEY, String(Date.now())] },
  ])
}

export function loadNeighbors(): Promise<{ key: string; other: string; score: number }[]> {
  return all('SELECT key, other, score FROM track_neighbors')
}
