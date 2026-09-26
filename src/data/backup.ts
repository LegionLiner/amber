import { all, batch } from './db'
import type { SqlStatement, SqlValue } from '@/native/types'
import { normKey } from '@/domain/names'

/**
 * Экспорт и импорт всех твоих данных в один JSON.
 * Файлы музыки не выгружаются: только то, что знает о них приложение.
 */

export const BACKUP_FORMAT = 'yantar-backup'
export const BACKUP_VERSION = 1

const PLAY_COLUMNS = [
  'track_key',
  'started_at',
  'ended_at',
  'tz_offset',
  'local_day',
  'local_hour',
  'weekday',
  'listened_ms',
  'pos_start_ms',
  'pos_end_ms',
  'duration_ms',
  'end_reason',
  'counted',
  'source_type',
  'source_id',
  'output',
  'session_id',
] as const

const USER_COLUMNS = [
  'key',
  'rating',
  'rated_at',
  'rank_score',
  'duels',
  'favorite_at',
  'note',
  'overrides',
  'trim_start_ms',
  'trim_end_ms',
  'gain_offset_db',
  'no_shuffle',
  'custom_art',
  'updated_at',
] as const

/** Простые таблицы, которые выгружаются и загружаются строками как есть */
const PLAIN_TABLES = [
  'rating_history',
  'playlists',
  'playlist_items',
  'bookmarks',
  'tags',
  'track_tags',
  'eras',
  'contexts',
  'context_intervals',
  'diary',
  'duels',
  'rank_snapshots',
  'weekly_charts',
  'lyrics',
  'dismissed',
  'device_profiles',
  'settings',
] as const
type PlainTable = (typeof PLAIN_TABLES)[number]

/** Колонки, которые хранят ключ трека и должны пересчитываться при сопоставлении */
const KEY_COLUMNS: Partial<Record<PlainTable, string[]>> = {
  rating_history: ['key'],
  playlist_items: ['track_key'],
  bookmarks: ['track_key'],
  track_tags: ['track_key'],
  duels: ['a_key', 'b_key'],
  rank_snapshots: ['track_key'],
  weekly_charts: ['track_key'],
  lyrics: ['key'],
}

export interface BackupTrack {
  key: string
  path: string
  fileName: string
  size: number
  title: string | null
  artist: string | null
  durationMs: number
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  app: string
  tracks: BackupTrack[]
  trackUser: { columns: string[]; rows: SqlValue[][] }
  plays: { columns: string[]; rows: SqlValue[][] }
  tables: Partial<Record<PlainTable, { columns: string[]; rows: SqlValue[][] }>>
}

async function dump(sql: string): Promise<{ columns: string[]; rows: SqlValue[][] }> {
  const rows = await all<Record<string, SqlValue>>(sql)
  const columns = rows[0] ? Object.keys(rows[0]) : []
  return { columns, rows: rows.map((r) => columns.map((c) => r[c] ?? null)) }
}

export async function buildBackup(): Promise<BackupFile> {
  const tracks = await all<BackupTrack>(
    `SELECT key, path, file_name AS fileName, size, title, artist, duration_ms AS durationMs FROM tracks`,
  )
  const trackUser = await dump(`SELECT ${USER_COLUMNS.join(', ')} FROM track_user`)
  const plays = await dump(`SELECT ${PLAY_COLUMNS.join(', ')} FROM play_events WHERE end_reason IS NOT NULL ORDER BY started_at`)
  const tables: BackupFile['tables'] = {}
  for (const t of PLAIN_TABLES) {
    if (t === 'settings') tables[t] = await dump(`SELECT key, value FROM settings WHERE key NOT LIKE 'snapshot:%'`)
    else tables[t] = await dump(`SELECT * FROM ${t}`)
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'Amber 0.2.0',
    tracks,
    trackUser,
    plays,
    tables,
  }
}

export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `amber-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`
}

/* ------------------------------ импорт ------------------------------ */

export interface ImportReport {
  matched: number
  byPath: number
  byMeta: number
  unmatched: number
  plays: number
  userRows: number
}

export function parseBackup(json: string): BackupFile {
  const data = JSON.parse(json) as BackupFile
  if (data?.format !== BACKUP_FORMAT) throw new Error('Это не файл бэкапа Amber')
  if (data.version > BACKUP_VERSION) throw new Error('Бэкап сделан более новой версией приложения')
  return data
}

/** Сопоставляет треки из бэкапа с треками на телефоне: отпечаток → путь → название и длительность → имя и размер */
async function matchTracks(data: BackupFile) {
  const local = await all<BackupTrack>(
    `SELECT key, path, file_name AS fileName, size, title, artist, duration_ms AS durationMs FROM tracks`,
  )
  const byKey = new Set(local.map((t) => t.key))
  const byPath = new Map(local.map((t) => [t.path, t.key]))
  const metaKey = (t: BackupTrack) => `${normKey(t.title ?? '')}|${normKey(t.artist ?? '')}`
  const byMeta = new Map<string, BackupTrack[]>()
  for (const t of local) {
    if (!t.title) continue
    const k = metaKey(t)
    byMeta.set(k, [...(byMeta.get(k) ?? []), t])
  }
  const byFile = new Map(local.map((t) => [`${t.fileName}|${t.size}`, t.key]))

  const map = new Map<string, string>()
  const report = { matched: 0, byPath: 0, byMeta: 0, unmatched: 0 }
  for (const t of data.tracks) {
    if (byKey.has(t.key)) {
      map.set(t.key, t.key)
      report.matched++
      continue
    }
    const p = byPath.get(t.path)
    if (p) {
      map.set(t.key, p)
      report.byPath++
      continue
    }
    const cands = t.title ? (byMeta.get(metaKey(t)) ?? []) : []
    const m = cands.find((c) => Math.abs(c.durationMs - t.durationMs) <= 2000)
    if (m) {
      map.set(t.key, m.key)
      report.byMeta++
      continue
    }
    const f = byFile.get(`${t.fileName}|${t.size}`)
    if (f) {
      map.set(t.key, f)
      report.byMeta++
      continue
    }
    // Не нашли: оставляем исходный ключ, данные сохранятся и оживут, когда файл появится
    map.set(t.key, t.key)
    report.unmatched++
  }
  return { map, report }
}

function insertSql(table: string, columns: string[], mode: 'ignore' | 'replace' | 'plain'): string {
  const verb = mode === 'ignore' ? 'INSERT OR IGNORE' : mode === 'replace' ? 'INSERT OR REPLACE' : 'INSERT'
  return `${verb} INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
}

async function runChunked(statements: SqlStatement[], size = 400) {
  for (let i = 0; i < statements.length; i += size) await batch(statements.slice(i, i + size))
}

export async function importBackup(data: BackupFile, mode: 'merge' | 'replace'): Promise<ImportReport> {
  // Снимок текущих данных на случай, если импорт не понравится
  const snapshot = JSON.stringify(await buildBackup())
  await batch([{ sql: `INSERT OR REPLACE INTO settings (key, value) VALUES ('snapshot:before-import', ?)`, params: [snapshot] }])

  const { map, report } = await matchTracks(data)
  const mapKey = (k: SqlValue) => (typeof k === 'string' ? (map.get(k) ?? k) : k)
  const statements: SqlStatement[] = []

  if (mode === 'replace') {
    for (const t of ['track_user', 'play_events', ...PLAIN_TABLES.filter((x) => x !== 'settings')]) {
      statements.push({ sql: `DELETE FROM ${t}` })
    }
  }

  // Твои данные о треках: при слиянии побеждает более свежая правка
  const tu = data.trackUser
  const keyIdx = tu.columns.indexOf('key')
  const updIdx = tu.columns.indexOf('updated_at')
  let existingUpd = new Map<string, number>()
  if (mode === 'merge') {
    const rows = await all<{ key: string; updatedAt: number }>(`SELECT key, updated_at AS updatedAt FROM track_user`)
    existingUpd = new Map(rows.map((r) => [r.key, r.updatedAt]))
  }
  let userRows = 0
  for (const row of tu.rows) {
    const r = row.slice()
    r[keyIdx] = mapKey(r[keyIdx] ?? null)
    const cur = existingUpd.get(String(r[keyIdx]))
    if (mode === 'merge' && cur != null && cur >= Number(r[updIdx] ?? 0)) continue
    statements.push({ sql: insertSql('track_user', tu.columns, 'replace'), params: r })
    userRows++
  }

  // Прослушивания: без дублей по «трек + время начала»
  const pl = data.plays
  const pk = pl.columns.indexOf('track_key')
  const ps = pl.columns.indexOf('started_at')
  let seen = new Set<string>()
  if (mode === 'merge') {
    const rows = await all<{ k: string; s: number }>(`SELECT track_key AS k, started_at AS s FROM play_events`)
    seen = new Set(rows.map((r) => `${r.k}|${r.s}`))
  }
  let plays = 0
  for (const row of pl.rows) {
    const r = row.slice()
    r[pk] = mapKey(r[pk] ?? null)
    const id = `${r[pk]}|${r[ps]}`
    if (seen.has(id)) continue
    seen.add(id)
    statements.push({ sql: insertSql('play_events', pl.columns, 'plain'), params: r })
    plays++
  }

  // Остальные таблицы
  for (const t of PLAIN_TABLES) {
    const tab = data.tables[t]
    if (!tab || !tab.rows.length) continue
    if (t === 'settings' && mode === 'merge') continue
    const keyCols = (KEY_COLUMNS[t] ?? []).map((c) => tab.columns.indexOf(c)).filter((i) => i >= 0)
    for (const row of tab.rows) {
      const r = row.slice()
      for (const i of keyCols) r[i] = mapKey(r[i] ?? null)
      statements.push({ sql: insertSql(t, tab.columns, mode === 'merge' ? 'ignore' : 'replace'), params: r })
    }
  }

  await runChunked(statements)
  return { ...report, plays, userRows }
}
