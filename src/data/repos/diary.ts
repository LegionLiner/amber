import { all, db } from '../db'
import { IN_LIBRARY } from './spotify'

/**
 * Дневник: каждый день с музыкой получает запись сам (время, трек дня, открытия),
 * ты добавляешь настроение и заметку. Плюс «в этот день» и вехи.
 */

export interface DiaryNote {
  day: string
  mood: number | null
  note: string | null
}

export interface DayRow {
  day: string
  listenedMs: number
  plays: number
  tracks: number
  firstAt: number
  lastAt: number
}

export interface DiaryDay extends DayRow {
  topKey: string | null
  discoveries: number
  mood: number | null
  note: string | null
}

export async function diaryFeed(beforeDay: string, limit = 20): Promise<DiaryDay[]> {
  const days = await all<DayRow>(
    `SELECT local_day AS day, SUM(listened_ms) AS listenedMs, SUM(counted) AS plays,
       COUNT(DISTINCT track_key) AS tracks, MIN(started_at) AS firstAt, MAX(started_at) AS lastAt
     FROM stat_plays WHERE local_day < ? GROUP BY local_day ORDER BY local_day DESC LIMIT ?`,
    [beforeDay, limit],
  )
  if (!days.length) return []
  const list = days.map((d) => d.day)
  const marks = list.map(() => '?').join(',')
  const [tops, disc, notes] = await Promise.all([
    all<{ day: string; key: string }>(
      `SELECT day, key FROM (
         SELECT local_day AS day, track_key AS key,
           ROW_NUMBER() OVER (PARTITION BY local_day ORDER BY SUM(counted) DESC, SUM(listened_ms) DESC) AS r
         FROM stat_plays WHERE local_day IN (${marks}) AND ${IN_LIBRARY} GROUP BY local_day, track_key
       ) WHERE r = 1`,
      list,
    ),
    all<{ day: string; n: number }>(
      `SELECT day, COUNT(*) AS n FROM (
         SELECT track_key, MIN(local_day) AS day FROM stat_plays WHERE counted = 1 GROUP BY track_key
       ) WHERE day IN (${marks}) GROUP BY day`,
      list,
    ),
    all<DiaryNote>(`SELECT day, mood, note FROM diary WHERE day IN (${marks})`, list),
  ])
  const top = new Map(tops.map((t) => [t.day, t.key]))
  const dn = new Map(disc.map((d) => [d.day, d.n]))
  const nn = new Map(notes.map((n) => [n.day, n]))
  return days.map((d) => ({
    ...d,
    topKey: top.get(d.day) ?? null,
    discoveries: dn.get(d.day) ?? 0,
    mood: nn.get(d.day)?.mood ?? null,
    note: nn.get(d.day)?.note ?? null,
  }))
}

export interface DayTrack {
  key: string
  plays: number
  listenedMs: number
  firstAt: number
  isNew: number
}

/** Все треки дня: сколько раз, сколько времени, впервые ли */
export function dayTracks(day: string): Promise<DayTrack[]> {
  return all<DayTrack>(
    `SELECT p.track_key AS key, SUM(p.counted) AS plays, SUM(p.listened_ms) AS listenedMs, MIN(p.started_at) AS firstAt,
       CASE WHEN f.first_day = ? THEN 1 ELSE 0 END AS isNew
     FROM stat_plays p
     LEFT JOIN (SELECT track_key, MIN(local_day) AS first_day FROM stat_plays WHERE counted = 1 GROUP BY track_key) f
       ON f.track_key = p.track_key
     WHERE p.local_day = ?
     GROUP BY p.track_key ORDER BY plays DESC, listenedMs DESC`,
    [day, day],
  )
}

export async function diaryNote(day: string): Promise<DiaryNote | null> {
  const rows = await all<DiaryNote>(`SELECT day, mood, note FROM diary WHERE day = ?`, [day])
  return rows[0] ?? null
}

export async function saveDiaryNote(day: string, mood: number | null, note: string | null): Promise<void> {
  const updatedAt = Date.now()
  await db
    .insertInto('diary')
    .values({ day, mood, note, updatedAt })
    .onConflict((oc) => oc.column('day').doUpdateSet({ mood, note, updatedAt }))
    .execute()
}

export interface OnThisDay {
  day: string
  key: string
  plays: number
}

/** Что звучало в этот же день в прошлые годы (и месяц назад, если лет истории ещё нет) */
export async function onThisDay(today: string): Promise<OnThisDay[]> {
  const md = today.slice(5)
  const rows = await all<OnThisDay>(
    `SELECT local_day AS day, track_key AS key, SUM(counted) AS plays FROM stat_plays
     WHERE substr(local_day, 6) = ? AND local_day < ?
     GROUP BY local_day, track_key HAVING SUM(counted) > 0
     ORDER BY local_day DESC, plays DESC`,
    [md, today],
  )
  if (rows.length) return rows
  const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, Number(today.slice(8, 10)))
  const monthAgo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return all<OnThisDay>(
    `SELECT local_day AS day, track_key AS key, SUM(counted) AS plays FROM stat_plays
     WHERE local_day = ? AND ${IN_LIBRARY} GROUP BY track_key HAVING SUM(counted) > 0 ORDER BY plays DESC LIMIT 10`,
    [monthAgo],
  )
}

export interface Milestone {
  at: number
  kind: 'plays' | 'hours' | 'track'
  value: number
  key?: string
}

const PLAY_MARKS = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]
const HOUR_MARKS = [10, 50, 100, 250, 500, 1000, 2500, 5000]
const TRACK_MARKS = [25, 50, 100, 250, 500]

/** Вехи: сотое прослушивание, сотый час, пятидесятый раз одного трека */
export async function milestones(): Promise<Milestone[]> {
  const [plays, tracks] = await Promise.all([
    all<{ n: number; at: number }>(
      `SELECT n, at FROM (SELECT ROW_NUMBER() OVER (ORDER BY started_at) AS n, started_at AS at FROM stat_plays WHERE counted = 1)
       WHERE n IN (${PLAY_MARKS.join(',')})`,
    ),
    all<{ key: string; n: number; at: number }>(
      `SELECT key, n, at FROM (
         SELECT track_key AS key, started_at AS at, ROW_NUMBER() OVER (PARTITION BY track_key ORDER BY started_at) AS n
         FROM stat_plays WHERE counted = 1 AND ${IN_LIBRARY}
       ) WHERE n IN (${TRACK_MARKS.join(',')})`,
    ),
  ])
  const hours: Milestone[] = []
  for (const h of HOUR_MARKS) {
    const [r] = await all<{ at: number | null }>(
      `SELECT MIN(at) AS at FROM (SELECT started_at AS at, SUM(listened_ms) OVER (ORDER BY started_at) AS cum FROM stat_plays)
       WHERE cum >= ?`,
      [h * 3_600_000],
    )
    if (!r?.at) break
    hours.push({ at: r.at, kind: 'hours', value: h })
  }
  return [
    ...plays.map((p) => ({ at: p.at, kind: 'plays' as const, value: p.n })),
    ...hours,
    ...tracks.map((t) => ({ at: t.at, kind: 'track' as const, value: t.n, key: t.key })),
  ].sort((a, b) => b.at - a.at)
}
