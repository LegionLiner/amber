import { all, batch, db, run } from '../db'
import type { TrackRow } from '@/domain/track'
import { countedSqlExpr } from '@/domain/counting'
import type { CountingRule } from '@/native/types'

/**
 * Вся библиотека одним запросом: файлы + твои данные + счётчики прослушиваний.
 * 5 000 треков и 100 000 событий SQLite собирает за десятки миллисекунд.
 */
export function loadTrackRows(): Promise<TrackRow[]> {
  return all<TrackRow>(`
    SELECT
      t.key, t.uri, t.path, t.folder, t.file_name AS fileName, t.size,
      t.title, t.artist, t.album, t.album_artist AS albumArtist, t.genre, t.year,
      t.track_no AS trackNo, t.disc_no AS discNo, t.duration_ms AS durationMs,
      t.bitrate, t.sample_rate AS sampleRate, t.mime, t.art, t.color1, t.color2,
      t.has_lyrics AS hasLyrics, t.rg_track_db AS rgTrackDb, t.added_at AS addedAt,
      u.rating, u.favorite_at AS favoriteAt, u.rank_score AS rankScore, u.duels, u.note, u.overrides,
      u.no_shuffle AS noShuffle, u.gain_offset_db AS gainOffsetDb,
      u.trim_start_ms AS trimStartMs, u.trim_end_ms AS trimEndMs, u.custom_art AS customArt,
      s.plays, s.skips, s.listened AS listenedMs, s.first_at AS firstPlayedAt,
      s.last_at AS lastPlayedAt, s.last_started AS lastStartedAt,
      a.lufs, a.bpm, a.energy, a.analyzed_at AS analyzedAt
    FROM tracks t
    LEFT JOIN track_user u ON u.key = t.key
    LEFT JOIN analysis a ON a.key = t.key
    LEFT JOIN (
      SELECT track_key,
        SUM(counted) AS plays,
        SUM(CASE WHEN end_reason = 'skipped' AND counted = 0 THEN 1 ELSE 0 END) AS skips,
        SUM(listened_ms) AS listened,
        MIN(CASE WHEN counted = 1 THEN started_at END) AS first_at,
        MAX(CASE WHEN counted = 1 THEN started_at END) AS last_at,
        MAX(started_at) AS last_started
      FROM stat_plays
      GROUP BY track_key
    ) s ON s.track_key = t.key
    WHERE t.missing_since IS NULL AND t.key NOT IN (SELECT key FROM dismissed WHERE kind = 'hidden')
  `)
}

/** Результаты анализа для нескольких треков (после фонового анализа) */
export function loadAnalysis(
  keys: string[],
): Promise<{ key: string; lufs: number | null; bpm: number | null; energy: number | null; analyzedAt: number }[]> {
  if (!keys.length) return Promise.resolve([])
  return all(
    `SELECT key, lufs, bpm, energy, analyzed_at AS analyzedAt FROM analysis WHERE key IN (${keys.map(() => '?').join(',')})`,
    keys,
  )
}

/** Волна трека: 1000 значений 0…255 */
export async function loadWaveform(key: string): Promise<Uint8Array | null> {
  const rows = await all<{ waveform: string | null }>('SELECT waveform FROM analysis WHERE key = ?', [key])
  const b64 = rows[0]?.waveform
  if (!b64) return null
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Обновить твои данные о треке (создаёт строку, если её ещё нет) */
export async function upsertTrackUser(
  key: string,
  patch: Partial<{
    rating: number | null
    ratedAt: number | null
    rankScore: number | null
    favoriteAt: number | null
    note: string | null
    overrides: string | null
    noShuffle: number
    gainOffsetDb: number
    trimStartMs: number | null
    trimEndMs: number | null
    customArt: string | null
  }>,
): Promise<void> {
  const now = Date.now()
  await db
    .insertInto('trackUser')
    .values({ key, duels: 0, gainOffsetDb: 0, noShuffle: 0, updatedAt: now, ...patch } as never)
    .onConflict((oc) => oc.column('key').doUpdateSet({ ...patch, updatedAt: now } as never))
    .execute()
}

/** Оценка + запись в историю одной транзакцией */
export async function saveRating(key: string, rating: number | null, rankScore: number | null): Promise<void> {
  const now = Date.now()
  await batch([
    db
      .insertInto('trackUser')
      .values({ key, rating, ratedAt: now, rankScore, duels: 0, gainOffsetDb: 0, noShuffle: 0, updatedAt: now })
      .onConflict((oc) => oc.column('key').doUpdateSet({ rating, ratedAt: now, rankScore, updatedAt: now })),
    db.insertInto('ratingHistory').values({ key, rating, at: now }),
  ])
}

/** Пересчитать «засчитано» во всей истории после смены правила */
export async function recountAll(rule: CountingRule): Promise<void> {
  await batch([
    { sql: `UPDATE play_events SET counted = ${countedSqlExpr(rule)} WHERE end_reason IS NOT NULL` },
    { sql: `UPDATE spotify_plays SET counted = ${countedSqlExpr(rule)}` },
  ])
}

/**
 * Слить дубли в один трек: история, оценка, избранное, метки и места в плейлистах переезжают
 * на выбранный файл, остальные скрываются из библиотеки (сами файлы не удаляются).
 */
export async function mergeDuplicates(bestKey: string, otherKeys: string[]): Promise<void> {
  const keys = [bestKey, ...otherKeys]
  const marks = keys.map(() => '?').join(',')
  const users = await all<{
    key: string
    rating: number | null
    favoriteAt: number | null
    rankScore: number | null
    duels: number
    note: string | null
  }>(
    `SELECT key, rating, favorite_at AS favoriteAt, rank_score AS rankScore, duels, note FROM track_user WHERE key IN (${marks})`,
    keys,
  )
  const best = users.find((u) => u.key === bestKey)
  const rated = users.filter((u) => u.rating != null).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0]
  const fav =
    users
      .map((u) => u.favoriteAt)
      .filter((x): x is number => x != null)
      .sort((a, b) => a - b)[0] ?? null
  const notes = users
    .map((u) => u.note)
    .filter(Boolean)
    .join('\n')
  const others = otherKeys.map(() => '?').join(',')
  const now = Date.now()
  await batch([
    { sql: `UPDATE play_events SET track_key = ? WHERE track_key IN (${others})`, params: [bestKey, ...otherKeys] },
    { sql: `UPDATE bookmarks SET track_key = ? WHERE track_key IN (${others})`, params: [bestKey, ...otherKeys] },
    { sql: `UPDATE rating_history SET key = ? WHERE key IN (${others})`, params: [bestKey, ...otherKeys] },
    { sql: `UPDATE OR IGNORE playlist_items SET track_key = ? WHERE track_key IN (${others})`, params: [bestKey, ...otherKeys] },
    { sql: `UPDATE OR IGNORE track_tags SET track_key = ? WHERE track_key IN (${others})`, params: [bestKey, ...otherKeys] },
    { sql: `UPDATE weekly_charts SET track_key = ? WHERE track_key IN (${others})`, params: [bestKey, ...otherKeys] },
    {
      sql: `INSERT INTO track_user (key, rating, rated_at, rank_score, duels, favorite_at, note, gain_offset_db, no_shuffle, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
            ON CONFLICT(key) DO UPDATE SET rating = excluded.rating, rank_score = excluded.rank_score, duels = excluded.duels,
              favorite_at = excluded.favorite_at, note = excluded.note, updated_at = excluded.updated_at`,
      params: [
        bestKey,
        best?.rating ?? rated?.rating ?? null,
        now,
        best?.rating != null ? best.rankScore : (rated?.rankScore ?? null),
        users.reduce((s, u) => s + (u.duels ?? 0), 0),
        fav,
        notes || null,
        now,
      ],
    },
    ...otherKeys.map((k) => ({
      sql: `INSERT OR IGNORE INTO dismissed (kind, key, at) VALUES ('hidden', ?, ?)`,
      params: [k, now],
    })),
  ])
}

export async function unhideAll(): Promise<number> {
  const r = await run(`DELETE FROM dismissed WHERE kind = 'hidden'`)
  return r.changes
}
