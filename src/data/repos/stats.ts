import { all } from '../db'
import { IN_LIBRARY } from './spotify'

/**
 * Запросы статистики. Всё считается из сырых событий: play_events и, если включено, история Spotify (представление stat_plays),
 * поэтому смена правила подсчёта сразу меняет все цифры.
 */

export interface PeriodTotals {
  plays: number
  starts: number
  listenedMs: number
  uniqueTracks: number
  skips: number
}

export async function periodTotals(since: number, until = Number.MAX_SAFE_INTEGER): Promise<PeriodTotals> {
  const [r] = await all<PeriodTotals>(
    `SELECT
       COALESCE(SUM(counted), 0) AS plays,
       COUNT(*) AS starts,
       COALESCE(SUM(listened_ms), 0) AS listenedMs,
       COUNT(DISTINCT CASE WHEN counted = 1 THEN track_key END) AS uniqueTracks,
       COALESCE(SUM(CASE WHEN end_reason = 'skipped' AND counted = 0 THEN 1 ELSE 0 END), 0) AS skips
     FROM stat_plays WHERE started_at >= ? AND started_at < ?`,
    [since, until],
  )
  return r ?? { plays: 0, starts: 0, listenedMs: 0, uniqueTracks: 0, skips: 0 }
}

export interface TopTrackRow {
  key: string
  plays: number
  listenedMs: number
}

export function topTracks(since: number, limit = 50, until = Number.MAX_SAFE_INTEGER): Promise<TopTrackRow[]> {
  return all<TopTrackRow>(
    `SELECT track_key AS key, SUM(counted) AS plays, SUM(listened_ms) AS listenedMs
     FROM stat_plays
     WHERE started_at >= ? AND started_at < ? AND ${IN_LIBRARY}
     GROUP BY track_key
     HAVING SUM(counted) > 0
     ORDER BY plays DESC, listenedMs DESC
     LIMIT ?`,
    [since, until, limit],
  )
}

export interface ArtistPlaysRow {
  key: string
  plays: number
  /** Исполнитель из тегов: для трека, которого нет в медиатеке (удалён, только на другом устройстве, Spotify) */
  artist: string | null
}

/** Все треки периода с числом прослушиваний — для честного подсчёта исполнителей, а не по первой десятке */
export function artistPlays(since: number, until = Number.MAX_SAFE_INTEGER): Promise<ArtistPlaysRow[]> {
  return all<ArtistPlaysRow>(
    `SELECT p.track_key AS key, SUM(p.counted) AS plays, COALESCE(t.artist, s.artist) AS artist
     FROM stat_plays p
     LEFT JOIN tracks t ON t.key = p.track_key
     LEFT JOIN spotify_tracks s ON s.uri = p.track_key
     WHERE p.started_at >= ? AND p.started_at < ?
     GROUP BY p.track_key
     HAVING SUM(p.counted) > 0`,
    [since, until],
  )
}

export interface DayRow {
  day: string
  plays: number
  listenedMs: number
}

export function daily(since: number): Promise<DayRow[]> {
  return all<DayRow>(
    `SELECT local_day AS day, SUM(counted) AS plays, SUM(listened_ms) AS listenedMs
     FROM stat_plays WHERE started_at >= ?
     GROUP BY local_day ORDER BY local_day`,
    [since],
  )
}

export interface HourRow {
  hour: number
  listenedMs: number
}

export function byHour(since: number, until = Number.MAX_SAFE_INTEGER): Promise<HourRow[]> {
  return all<HourRow>(
    `SELECT local_hour AS hour, SUM(listened_ms) AS listenedMs
     FROM stat_plays WHERE started_at >= ? AND started_at < ?
     GROUP BY local_hour`,
    [since, until],
  )
}

/** Все дни, в которые что-то засчиталось: для серий «дней подряд» */
export async function activeDays(): Promise<string[]> {
  const rows = await all<{ day: string }>(`SELECT DISTINCT local_day AS day FROM stat_plays WHERE counted = 1 ORDER BY local_day`)
  return rows.map((r) => r.day)
}

export interface RecentPlay {
  key: string
  startedAt: number
}

/** Последние запущенные треки без повторов подряд */
/**
 * Недавно игравшие треки. Сначала смотрим только последние ~400 прослушиваний каждого источника — по индексу
 * времени, а не перебором всей истории (со Spotify это десятки тысяч строк на каждый показ главной).
 * Если там набралось меньше треков, чем нужно (один трек на повторе), — считаем по всей истории
 */
export async function recentPlays(limit = 30): Promise<RecentPlay[]> {
  const q = (since: number) =>
    all<RecentPlay>(
      `SELECT track_key AS key, MAX(started_at) AS startedAt
       FROM stat_plays
       WHERE started_at >= ? AND ${IN_LIBRARY}
       GROUP BY track_key
       ORDER BY startedAt DESC
       LIMIT ?`,
      [since, limit],
    )
  // Граница источника: время 400-го с конца прослушивания; меньше 400 — с самого начала; пусто — не ограничивает
  const edge = (table: string) =>
    `CASE WHEN (SELECT COUNT(*) FROM ${table}) > 400
       THEN (SELECT started_at FROM ${table} ORDER BY started_at DESC LIMIT 1 OFFSET 400)
       WHEN EXISTS (SELECT 1 FROM ${table}) THEN 0 ELSE ${Number.MAX_SAFE_INTEGER} END`
  const [c] = await all<{ since: number }>(`SELECT MIN(${edge('play_events')}, ${edge('spotify_plays')}) AS since`)
  const since = Number(c?.since ?? 0)
  const rows = await q(since >= Number.MAX_SAFE_INTEGER ? 0 : since)
  return rows.length < limit && since > 0 ? q(0) : rows
}

export async function totalEvents(): Promise<number> {
  const [r] = await all<{ n: number }>(`SELECT COUNT(*) AS n FROM play_events`)
  return r?.n ?? 0
}
