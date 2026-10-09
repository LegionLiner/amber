import { all, batch, run } from '../db'
import { countedSqlExpr, localParts } from '@/domain/counting'
import { buildMatcher, estimateDurations, type MatchableTrack, type SpotifyStream } from '@/domain/spotify'
import type { CountingRule, SqlStatement, SqlValue } from '@/native/types'

/**
 * История Spotify в базе: spotify_tracks (трек Spotify → файл медиатеки) и spotify_plays (сами прослушивания).
 * Статистика читает их через представление stat_plays (migrations.ts, версия 6), пока включён переключатель.
 */

/** Ключ в settings, который читает представление stat_plays. Не синхронизируется: история лежит на этом устройстве */
const ON_KEY = 'spotify:on'

/** Условие «трек есть в медиатеке» для списков треков: остальные ключи Spotify в них не показать */
export const IN_LIBRARY = `track_key NOT LIKE 'spotify:%'`

export async function spotifyEnabled(): Promise<boolean> {
  const rows = await all<{ value: string }>('SELECT value FROM settings WHERE key = ?', [ON_KEY])
  return rows[0]?.value === '1'
}

export async function setSpotifyEnabled(on: boolean): Promise<void> {
  await run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [ON_KEY, on ? '1' : '0'])
}

export interface SpotifySummary {
  plays: number
  counted: number
  listenedMs: number
  tracks: number
  matched: number
  /** Сколько засчитанных прослушиваний пришлось на треки из медиатеки */
  matchedPlays: number
  first: number | null
  last: number | null
}

export async function spotifySummary(): Promise<SpotifySummary> {
  const [[p], [t]] = await Promise.all([
    all<Omit<SpotifySummary, 'tracks' | 'matched'>>(
      `SELECT COUNT(*) AS plays, COALESCE(SUM(p.counted), 0) AS counted, COALESCE(SUM(p.listened_ms), 0) AS listenedMs,
         COALESCE(SUM(CASE WHEN t.track_key IS NOT NULL THEN p.counted ELSE 0 END), 0) AS matchedPlays,
         MIN(p.started_at) AS first, MAX(p.started_at) AS last
       FROM spotify_plays p LEFT JOIN spotify_tracks t ON t.uri = p.uri`,
    ),
    all<{ tracks: number; matched: number }>(`SELECT COUNT(*) AS tracks, COUNT(track_key) AS matched FROM spotify_tracks`),
  ])
  return {
    plays: p?.plays ?? 0,
    counted: p?.counted ?? 0,
    listenedMs: p?.listenedMs ?? 0,
    matchedPlays: p?.matchedPlays ?? 0,
    first: p?.first ?? null,
    last: p?.last ?? null,
    tracks: t?.tracks ?? 0,
    matched: t?.matched ?? 0,
  }
}

export interface SpotifyTopArtist {
  artist: string
  plays: number
  listenedMs: number
}

/** Любимые исполнители по истории Spotify — в том числе те, кого нет в медиатеке */
export function spotifyTopArtists(limit = 10): Promise<SpotifyTopArtist[]> {
  return all<SpotifyTopArtist>(
    `SELECT t.artist, SUM(p.counted) AS plays, SUM(p.listened_ms) AS listenedMs
     FROM spotify_plays p JOIN spotify_tracks t ON t.uri = p.uri
     GROUP BY t.artist ORDER BY listenedMs DESC LIMIT ?`,
    [limit],
  )
}

/** Сколько параметров в одном INSERT: у SQLite на Android предел 999 */
const ROWS_PER_INSERT = 80
/** Сколько INSERT отправлять за один вызов моста */
const STATEMENTS_PER_BATCH = 40

function chunkInserts(head: string, cols: number, rows: SqlValue[][]): SqlStatement[] {
  const out: SqlStatement[] = []
  const one = `(${Array(cols).fill('?').join(', ')})`
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const part = rows.slice(i, i + ROWS_PER_INSERT)
    out.push({ sql: `${head} VALUES ${part.map(() => one).join(', ')}`, params: part.flat() })
  }
  return out
}

async function runChunked(statements: SqlStatement[], onProgress?: (done: number, total: number) => void) {
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    await batch(statements.slice(i, i + STATEMENTS_PER_BATCH))
    onProgress?.(Math.min(i + STATEMENTS_PER_BATCH, statements.length), statements.length)
  }
}

export interface SpotifyImportReport {
  /** Новых прослушиваний (повторный импорт того же файла ничего не добавляет) */
  added: number
  total: number
}

/**
 * Записывает прослушивания из выгрузки. Уже загруженные пропускаются (uri + время начала),
 * так что можно загружать и свежую выгрузку поверх старой.
 */
export async function importSpotify(
  streams: SpotifyStream[],
  onProgress?: (done: number, total: number) => void,
): Promise<SpotifyImportReport> {
  const [before] = await all<{ n: number }>('SELECT COUNT(*) AS n FROM spotify_plays')

  // Треки: метаданные из самой свежей записи, длительность — по дослушанным прослушиваниям (и старым, и новым)
  const meta = new Map<string, SpotifyStream>()
  for (const s of streams) {
    const m = meta.get(s.uri)
    if (!m || s.startedAt > m.startedAt) meta.set(s.uri, s)
  }
  const known = new Map(
    (await all<{ uri: string; durationMs: number }>('SELECT uri, duration_ms AS durationMs FROM spotify_tracks')).map((r) => [
      r.uri,
      r.durationMs,
    ]),
  )
  const durations = estimateDurations(streams)
  const trackRows: SqlValue[][] = [...meta.values()].map((s) => [
    s.uri,
    s.title,
    s.artist,
    s.album,
    Math.max(durations.get(s.uri) ?? 0, known.get(s.uri) ?? 0),
  ])

  const playRows: SqlValue[][] = streams.map((s) => {
    const p = localParts(s.startedAt)
    return [s.uri, s.startedAt, s.endedAt, p.tzOffset, p.localDay, p.localHour, p.weekday, s.listenedMs, s.endReason]
  })

  await runChunked(
    [
      ...chunkInserts(`INSERT INTO spotify_tracks (uri, title, artist, album, duration_ms)`, 5, trackRows).map((st) => ({
        ...st,
        sql: `${st.sql} ON CONFLICT(uri) DO UPDATE SET title = excluded.title, artist = excluded.artist,
          album = COALESCE(excluded.album, album), duration_ms = excluded.duration_ms`,
      })),
      ...chunkInserts(
        `INSERT OR IGNORE INTO spotify_plays (uri, started_at, ended_at, tz_offset, local_day, local_hour, weekday, listened_ms, end_reason)`,
        9,
        playRows,
      ),
    ],
    onProgress,
  )
  const [after] = await all<{ n: number }>('SELECT COUNT(*) AS n FROM spotify_plays')
  return { added: (after?.n ?? 0) - (before?.n ?? 0), total: after?.n ?? 0 }
}

/**
 * Заново сопоставляет треки Spotify с файлами медиатеки и пересчитывает «засчитано»:
 * длительность берётся у файла, если он нашёлся, иначе — оценка по истории.
 * Возвращает, сколько сопоставлений поменялось. recount — пересчитать, даже если ничего не поменялось (после импорта).
 */
export async function rematchSpotify(tracks: MatchableTrack[], rule: CountingRule, recount = false): Promise<number> {
  const rows = await all<{ uri: string; title: string; artist: string; key: string | null }>(
    'SELECT uri, title, artist, track_key AS key FROM spotify_tracks',
  )
  if (!rows.length) return 0
  const match = buildMatcher(tracks)
  const changes: SqlStatement[] = []
  for (const r of rows) {
    const key = match(r.artist, r.title)
    if (key !== r.key) changes.push({ sql: 'UPDATE spotify_tracks SET track_key = ? WHERE uri = ?', params: [key, r.uri] })
  }
  await runChunked(changes)
  if (changes.length || recount) await recountSpotify(rule)
  return changes.length
}

/** Пересчитать «засчитано» у прослушиваний Spotify (после смены правила или сопоставления) */
export async function recountSpotify(rule: CountingRule): Promise<void> {
  await batch([
    {
      sql: `UPDATE spotify_plays SET duration_ms = COALESCE((
          SELECT COALESCE(NULLIF(f.duration_ms, 0), t.duration_ms)
          FROM spotify_tracks t LEFT JOIN tracks f ON f.key = t.track_key
          WHERE t.uri = spotify_plays.uri), 0)`,
    },
    { sql: `UPDATE spotify_plays SET counted = ${countedSqlExpr(rule)}` },
  ])
}

export async function clearSpotify(): Promise<void> {
  await batch([{ sql: 'DELETE FROM spotify_plays' }, { sql: 'DELETE FROM spotify_tracks' }])
}

/** Есть ли что-то из Spotify вообще: без этого незачем сопоставлять после сканирования */
export async function hasSpotify(): Promise<boolean> {
  const rows = await all<{ n: number }>('SELECT COUNT(*) AS n FROM spotify_tracks')
  return (rows[0]?.n ?? 0) > 0
}
