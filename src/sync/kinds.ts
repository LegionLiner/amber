import type { SqlStatement, SqlValue } from '../native/types'

/**
 * Что синхронизируется и как. Каждый вид данных («kind») — это:
 *  - таблица и ключ записи (eid), вычисляемый из самих данных, а не из локального номера строки:
 *    прослушивание — «ключ трека@время начала», эпоха — время создания. Поэтому одна и та же запись
 *    на телефоне и на компьютере совпадает, даже если попала туда бэкапом, и история не удваивается;
 *  - триггеры: любая запись в таблицу (и из TypeScript, и из Kotlin на телефоне) кладёт eid в журнал
 *    sync_outbox; при смене ключа — оба eid, старый уйдёт на сервер как удалённый;
 *  - чтение записи для отправки и применение пришедшей с сервера.
 *
 * Сами треки, анализ, папки, эквалайзер устройства и недельные чарты не синхронизируются:
 * чарты каждое устройство считает само из общей истории.
 *
 * Модуль без зависимостей от приложения: его же используют тесты сервера.
 */

export interface SyncItem {
  kind: string
  id: string
  data: Record<string, unknown> | null
  deleted: boolean
  updatedAt: number
}

export interface SyncDb {
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>
  batch(statements: SqlStatement[]): Promise<void>
}

/** Текущее время в мс прямо в SQLite (для триггеров) */
export const NOW_MS = `CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)`

/** Триггеры пишут в журнал, только когда синхронизация включена и это не применение пришедшего с сервера */
const ACTIVE = `EXISTS (SELECT 1 FROM sync_state WHERE k = 'enabled') AND NOT EXISTS (SELECT 1 FROM sync_state WHERE k = 'applying')`

type Row = Record<string, SqlValue>

export interface KindDef {
  kind: string
  /** Таблицы, изменения в которых затрагивают этот вид, и выражение eid через NEW./OLD. */
  watch: { table: string; eid: (row: 'NEW' | 'OLD') => string }[]
  /** Все существующие записи — для первого включения: eid и время изменения */
  seed: string
  /** Запись по eid для отправки; null — записи нет (удалена); 'wait' — ещё не готова (трек играет) */
  read(db: SyncDb, eid: string): Promise<Record<string, unknown> | null | 'wait'>
  /** Пришедшая запись → SQL. Должно работать и когда записи нет, и когда она есть */
  apply(item: SyncItem): SqlStatement[]
  /** Ключи треков, на которые ссылается запись: для них отправятся «карточки» с названием */
  trackKeys?(data: Record<string, unknown>): string[]
}

const pick = (r: Row, cols: readonly string[]) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))
const vals = (d: Record<string, unknown>, cols: readonly string[]) => cols.map((c) => (d[c] ?? null) as SqlValue)
const one = async (db: SyncDb, sql: string, params: SqlValue[]) => (await db.all<Row>(sql, params))[0] ?? null
/** eid вида «a@b» → [a, b] по последнему разделителю (в ключе трека его не бывает) */
const splitAt = (eid: string): [string, number] => {
  const i = eid.lastIndexOf('@')
  return [eid.slice(0, i), Number(eid.slice(i + 1))]
}

/** Обычная таблица с естественным ключом: upsert при пришедшей записи, delete при удалённой */
function simple(opts: {
  kind: string
  table: string
  cols: readonly string[]
  /** Колонки, по которым найти строку, и как их получить из eid */
  where: string[]
  fromEid: (eid: string) => SqlValue[]
  eid: (row: 'NEW' | 'OLD') => string
  seed: string
  readFilter?: string
  trackKeys?: (d: Record<string, unknown>) => string[]
}): KindDef {
  const cond = opts.where.map((c) => `${c} = ?`).join(' AND ')
  const rest = opts.cols.filter((c) => !opts.where.includes(c))
  return {
    kind: opts.kind,
    watch: [{ table: opts.table, eid: opts.eid }],
    seed: opts.seed,
    async read(db, eid) {
      const r = await one(db, `SELECT * FROM ${opts.table} WHERE ${cond}`, opts.fromEid(eid))
      if (!r) return null
      if (opts.readFilter === 'finished' && r.end_reason == null) return 'wait'
      return pick(r, opts.cols)
    },
    apply(item) {
      const key = opts.fromEid(item.id)
      if (item.deleted || !item.data) return [{ sql: `DELETE FROM ${opts.table} WHERE ${cond}`, params: key }]
      const d = item.data
      const out: SqlStatement[] = []
      if (rest.length) {
        out.push({
          sql: `UPDATE ${opts.table} SET ${rest.map((c) => `${c} = ?`).join(', ')} WHERE ${cond}`,
          params: [...vals(d, rest), ...key],
        })
      }
      out.push({
        sql: `INSERT INTO ${opts.table} (${opts.cols.join(', ')}) SELECT ${opts.cols.map(() => '?').join(', ')}
              WHERE NOT EXISTS (SELECT 1 FROM ${opts.table} WHERE ${cond})`,
        params: [...vals(d, opts.cols), ...key],
      })
      return out
    },
    trackKeys: opts.trackKeys,
  }
}

const PLAY_COLS = [
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
] as const

/** Своя обложка трека (custom_art) — картинка на этом устройстве, её не передаём */
const TRACK_COLS = [
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
  'updated_at',
] as const

const PLAYLIST_COLS = ['name', 'kind', 'rules', 'sort', 'note', 'created_at', 'updated_at'] as const

export const KINDS: KindDef[] = [
  simple({
    kind: 'track',
    table: 'track_user',
    cols: TRACK_COLS,
    where: ['key'],
    fromEid: (e) => [e],
    eid: (r) => `${r}.key`,
    seed: `SELECT key AS eid, updated_at AS at FROM track_user`,
    trackKeys: (d) => [String(d.key)],
  }),
  simple({
    kind: 'play',
    table: 'play_events',
    cols: PLAY_COLS,
    where: ['track_key', 'started_at'],
    fromEid: (e) => splitAt(e),
    eid: (r) => `${r}.track_key || '@' || ${r}.started_at`,
    seed: `SELECT track_key || '@' || started_at AS eid, COALESCE(ended_at, started_at) AS at FROM play_events WHERE end_reason IS NOT NULL`,
    readFilter: 'finished',
    trackKeys: (d) => [String(d.track_key)],
  }),
  simple({
    kind: 'rate',
    table: 'rating_history',
    cols: ['key', 'rating', 'at'],
    where: ['key', 'at'],
    fromEid: (e) => splitAt(e),
    eid: (r) => `${r}.key || '@' || ${r}.at`,
    seed: `SELECT key || '@' || at AS eid, at FROM rating_history`,
  }),
  simple({
    kind: 'duel',
    table: 'duels',
    cols: ['a_key', 'b_key', 'result', 'at'],
    where: ['a_key', 'b_key', 'at'],
    fromEid: (e) => {
      const [ab, at] = splitAt(e)
      const i = ab.indexOf('|')
      return [ab.slice(0, i), ab.slice(i + 1), at]
    },
    eid: (r) => `${r}.a_key || '|' || ${r}.b_key || '@' || ${r}.at`,
    seed: `SELECT a_key || '|' || b_key || '@' || at AS eid, at FROM duels`,
  }),
  simple({
    kind: 'mark',
    table: 'bookmarks',
    cols: ['track_key', 'position_ms', 'end_ms', 'title', 'color', 'kind', 'note', 'created_at'],
    where: ['track_key', 'created_at'],
    fromEid: (e) => splitAt(e),
    eid: (r) => `${r}.track_key || '@' || ${r}.created_at`,
    seed: `SELECT track_key || '@' || created_at AS eid, created_at AS at FROM bookmarks`,
    trackKeys: (d) => [String(d.track_key)],
  }),
  simple({
    kind: 'era',
    table: 'eras',
    cols: ['title', 'kind', 'start_day', 'end_day', 'color', 'note', 'created_at'],
    where: ['created_at'],
    fromEid: (e) => [Number(e)],
    eid: (r) => `${r}.created_at`,
    seed: `SELECT CAST(created_at AS TEXT) AS eid, created_at AS at FROM eras`,
  }),
  simple({
    kind: 'ctx',
    table: 'contexts',
    cols: ['title', 'icon', 'color', 'rules', 'created_at'],
    where: ['created_at'],
    fromEid: (e) => [Number(e)],
    eid: (r) => `${r}.created_at`,
    seed: `SELECT CAST(created_at AS TEXT) AS eid, created_at AS at FROM contexts`,
  }),
  {
    // Интервал контекста ссылается на контекст по времени его создания, а не по локальному номеру
    kind: 'ctxi',
    watch: [
      {
        table: 'context_intervals',
        eid: (r) => `(SELECT created_at FROM contexts WHERE id = ${r}.context_id) || '@' || ${r}.start_at`,
      },
    ],
    seed: `SELECT c.created_at || '@' || i.start_at AS eid, COALESCE(i.end_at, i.start_at) AS at
           FROM context_intervals i JOIN contexts c ON c.id = i.context_id`,
    async read(db, eid) {
      const [ctx, start] = splitAt(eid)
      const r = await one(
        db,
        `SELECT i.start_at, i.end_at FROM context_intervals i JOIN contexts c ON c.id = i.context_id
         WHERE c.created_at = ? AND i.start_at = ?`,
        [Number(ctx), start],
      )
      return r ? { context: Number(ctx), start_at: r.start_at, end_at: r.end_at } : null
    },
    apply(item) {
      const [ctx, start] = splitAt(item.id)
      const cid = `(SELECT id FROM contexts WHERE created_at = ?)`
      if (item.deleted || !item.data) {
        return [{ sql: `DELETE FROM context_intervals WHERE context_id = ${cid} AND start_at = ?`, params: [Number(ctx), start] }]
      }
      return [
        // Контекст может прийти позже своего интервала: пока — заготовка, потом её перепишет сам контекст
        {
          sql: `INSERT INTO contexts (title, created_at) SELECT 'Контекст', ? WHERE NOT EXISTS (SELECT 1 FROM contexts WHERE created_at = ?)`,
          params: [Number(ctx), Number(ctx)],
        },
        {
          sql: `UPDATE context_intervals SET end_at = ? WHERE context_id = ${cid} AND start_at = ?`,
          params: [(item.data.end_at ?? null) as SqlValue, Number(ctx), start],
        },
        {
          sql: `INSERT INTO context_intervals (context_id, start_at, end_at) SELECT ${cid}, ?, ?
                WHERE NOT EXISTS (SELECT 1 FROM context_intervals WHERE context_id = ${cid} AND start_at = ?)`,
          params: [Number(ctx), start, (item.data.end_at ?? null) as SqlValue, Number(ctx), start],
        },
      ]
    },
  },
  {
    // Плейлист вместе со списком треков (и стыками миксов): так порядок и состав не расходятся
    kind: 'playlist',
    watch: [
      { table: 'playlists', eid: (r) => `${r}.created_at` },
      { table: 'playlist_items', eid: (r) => `(SELECT created_at FROM playlists WHERE id = ${r}.playlist_id)` },
    ],
    seed: `SELECT CAST(created_at AS TEXT) AS eid, updated_at AS at FROM playlists`,
    async read(db, eid) {
      const p = await one(db, `SELECT * FROM playlists WHERE created_at = ?`, [Number(eid)])
      if (!p) return null
      const items = await db.all<Row>(
        `SELECT track_key, transition, added_at FROM playlist_items WHERE playlist_id = ? ORDER BY pos, id`,
        [p.id as number],
      )
      return { ...pick(p, PLAYLIST_COLS), items: items.map((i) => [i.track_key, i.transition, i.added_at]) }
    },
    apply(item) {
      const created = Number(item.id)
      const pid = `(SELECT id FROM playlists WHERE created_at = ?)`
      if (item.deleted || !item.data) {
        return [
          { sql: `DELETE FROM playlist_items WHERE playlist_id = ${pid}`, params: [created] },
          { sql: `DELETE FROM playlists WHERE created_at = ?`, params: [created] },
        ]
      }
      const d = item.data
      const rest = PLAYLIST_COLS.filter((c) => c !== 'created_at')
      const items = (d.items as [string, string | null, number][] | undefined) ?? []
      return [
        {
          sql: `UPDATE playlists SET ${rest.map((c) => `${c} = ?`).join(', ')} WHERE created_at = ?`,
          params: [...vals(d, rest), created],
        },
        {
          sql: `INSERT INTO playlists (${PLAYLIST_COLS.join(', ')}) SELECT ${PLAYLIST_COLS.map(() => '?').join(', ')}
                WHERE NOT EXISTS (SELECT 1 FROM playlists WHERE created_at = ?)`,
          params: [...vals(d, PLAYLIST_COLS), created],
        },
        { sql: `DELETE FROM playlist_items WHERE playlist_id = ${pid}`, params: [created] },
        ...items.map(([key, transition, added], i) => ({
          sql: `INSERT INTO playlist_items (playlist_id, pos, track_key, transition, added_at) VALUES (${pid}, ?, ?, ?, ?)`,
          params: [created, i, key, transition, added] as SqlValue[],
        })),
      ]
    },
    trackKeys: (d) => ((d.items as [string][] | undefined) ?? []).map((i) => i[0]),
  },
  simple({
    kind: 'diary',
    table: 'diary',
    cols: ['day', 'mood', 'note', 'updated_at'],
    where: ['day'],
    fromEid: (e) => [e],
    eid: (r) => `${r}.day`,
    seed: `SELECT day AS eid, updated_at AS at FROM diary`,
  }),
  simple({
    kind: 'lyric',
    table: 'lyrics',
    cols: ['key', 'text', 'updated_at'],
    where: ['key'],
    fromEid: (e) => [e],
    eid: (r) => `${r}.key`,
    seed: `SELECT key AS eid, updated_at AS at FROM lyrics`,
  }),
  simple({
    kind: 'dismiss',
    table: 'dismissed',
    cols: ['kind', 'key', 'at'],
    where: ['kind', 'key'],
    fromEid: (e) => {
      const i = e.indexOf('|')
      return [e.slice(0, i), e.slice(i + 1)]
    },
    eid: (r) => `${r}.kind || '|' || ${r}.key`,
    seed: `SELECT kind || '|' || key AS eid, at FROM dismissed`,
  }),
]

/** Порядок применения: контексты раньше интервалов, плейлисты и треки — в любом */
export const APPLY_ORDER = [
  'card',
  'track',
  'ctx',
  'ctxi',
  'era',
  'playlist',
  'mark',
  'play',
  'rate',
  'duel',
  'diary',
  'lyric',
  'dismiss',
  'pref',
]

/**
 * Служебные таблицы и триггеры (миграция 4). Триггеры только добавляют строку в журнал:
 * запись приложения они не меняют и не могут сорвать (удалить + вставить, пустой eid пропускается).
 */
export function syncSchema(): string[] {
  const out = [
    `CREATE TABLE sync_state (k TEXT PRIMARY KEY, v TEXT)`,
    `CREATE TABLE sync_outbox (kind TEXT NOT NULL, eid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (kind, eid))`,
    // Карточки треков (название, исполнитель), уже отправленные на сервер
    `CREATE TABLE sync_cards (key TEXT PRIMARY KEY)`,
  ]
  const rows: { kind: string; table: string; eid: (r: 'NEW' | 'OLD') => string }[] = [
    ...KINDS.flatMap((k) => k.watch.map((w) => ({ kind: k.kind, ...w }))),
    { kind: 'pref', table: 'settings', eid: () => `'app'` },
  ]
  for (const { kind, table, eid } of rows) {
    // Не INSERT OR REPLACE: политику конфликтов в триггере перекрывает внешняя команда, и после upsert
    // приложения (INSERT … ON CONFLICT DO UPDATE) повторная запись в журнал падала вместе с самой правкой.
    // Удалить и вставить не конфликтует ни при какой внешней политике
    const put = (r: 'NEW' | 'OLD') =>
      `DELETE FROM sync_outbox WHERE kind = '${kind}' AND eid = ${eid(r)}; ` +
      `INSERT INTO sync_outbox (kind, eid, at) SELECT '${kind}', ${eid(r)}, ${NOW_MS} WHERE ${eid(r)} IS NOT NULL;`
    const only = table === 'settings' ? ` AND NEW.key = 'app'` : ''
    const onlyOld = table === 'settings' ? ` AND OLD.key = 'app'` : ''
    const name = `sync_${kind}_${table}`
    out.push(`CREATE TRIGGER ${name}_i AFTER INSERT ON ${table} WHEN ${ACTIVE}${only} BEGIN ${put('NEW')} END`)
    out.push(`CREATE TRIGGER ${name}_u AFTER UPDATE ON ${table} WHEN ${ACTIVE}${only} BEGIN ${put('OLD')} ${put('NEW')} END`)
    out.push(`CREATE TRIGGER ${name}_d AFTER DELETE ON ${table} WHEN ${ACTIVE}${onlyOld} BEGIN ${put('OLD')} END`)
  }
  return out
}
