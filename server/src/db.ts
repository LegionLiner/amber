import pg from 'pg'

/**
 * Доступ к Postgres. Сервер говорит с базой только через этот маленький интерфейс: в работе это пул pg,
 * в тестах — PGlite (настоящий Postgres внутри процесса), код маршрутов один и тот же.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Всё внутри — одной транзакцией */
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>
}

/**
 * Для запуска без Docker (разработка на своём компьютере): Postgres внутри процесса, данные в папке.
 * DATABASE_URL=pglite:./data. В образе для сервера этого пакета нет — там настоящий Postgres.
 */
export async function pgliteDb(dir: string): Promise<Db & { close(): Promise<void> }> {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create(dir)
  const wrap = (c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): Db => ({
    query: async <T>(sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as T[],
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
  })
  return { ...wrap(pg), close: () => pg.close() }
}

export function pgDb(url: string): Db & { close(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: url, max: 10 })
  const wrap = (c: pg.Pool | pg.PoolClient): Db => ({
    query: async <T>(sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as T[],
    tx: () => Promise.reject(new Error('вложенная транзакция')),
  })
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const r = await fn(wrap(client))
        await client.query('COMMIT')
        return r
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw e
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

/**
 * Схема. Сервер не знает, что внутри записей: для него это «вид, ключ, данные JSON, время изменения».
 * Так новые виды данных в приложении не требуют менять сервер.
 *
 * items.seq — сквозной номер изменения: устройство просит «всё после номера N» и запоминает новый N.
 */
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    platform text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS devices_user ON devices (user_id)`,
  `CREATE SEQUENCE IF NOT EXISTS item_seq`,
  `CREATE TABLE IF NOT EXISTS items (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    id text NOT NULL,
    data jsonb,
    deleted boolean NOT NULL DEFAULT false,
    updated_at bigint NOT NULL,
    origin uuid,
    seq bigint NOT NULL DEFAULT nextval('item_seq'),
    PRIMARY KEY (user_id, kind, id)
  )`,
  `CREATE INDEX IF NOT EXISTS items_user_seq ON items (user_id, seq)`,
]

export async function migrate(db: Db): Promise<void> {
  // Названия треков бывают на любом языке: в базе не в UTF-8 запись с «é» или эмодзи упала бы
  const [enc] = await db.query<{ e: string }>(
    `SELECT pg_encoding_to_char(encoding) AS e FROM pg_database WHERE datname = current_database()`,
  )
  if (enc && enc.e !== 'UTF8') throw new Error(`База в кодировке ${enc.e}, нужна UTF8: пересоздай её с --encoding=UTF8`)
  for (const s of SCHEMA) await db.query(s)
}
