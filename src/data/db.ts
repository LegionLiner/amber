import {
  CamelCasePlugin,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from 'kysely'
import { MusicCore } from '@/native/music-core'
import type { ExecResult, QueryResult as BridgeResult, SqlStatement, SqlValue } from '@/native/types'
import type { DB } from './schema'
import { MIGRATIONS } from './migrations'

/**
 * Кто-то записал в базу из интерфейса: синхронизация по этому сигналу сразу смотрит журнал изменений.
 * Записи движка (прослушивания) сюда не попадают — их синхронизация замечает опросом журнала.
 */
let writeListener: (() => void) | null = null
export function onDbWrite(fn: () => void): void {
  writeListener = fn
}
const wrote = () => writeListener?.()

/** Превращает ответ моста { columns, values } в массив объектов */
export function toObjects<T>(res: BridgeResult): T[] {
  const { columns, values } = res
  const out = new Array<T>(values.length)
  for (let i = 0; i < values.length; i++) {
    const row = values[i]!
    const obj: Record<string, SqlValue> = {}
    for (let c = 0; c < columns.length; c++) obj[columns[c]!] = row[c] ?? null
    out[i] = obj as T
  }
  return out
}

function returnsRows(q: CompiledQuery): boolean {
  const node = q.query as { kind: string; returning?: unknown }
  if (node.kind === 'SelectQueryNode') return true
  if (node.returning) return true
  return /^\s*(select|with|pragma|explain|values)\b/i.test(q.sql)
}

/** Соединение Kysely, которое отправляет каждый запрос через Capacitor-мост */
class BridgeConnection implements DatabaseConnection {
  async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
    const params = q.parameters as SqlValue[]
    if (returnsRows(q)) {
      const res = await MusicCore.query({ sql: q.sql, params })
      return { rows: toObjects<R>(res) }
    }
    const r = await MusicCore.execute({ sql: q.sql, params })
    wrote()
    return { rows: [], numAffectedRows: BigInt(r.changes), insertId: BigInt(r.lastId) }
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('Потоковые запросы через мост не поддерживаются')
  }
}

class BridgeDriver implements Driver {
  private readonly conn = new BridgeConnection()
  async init() {}
  async acquireConnection() {
    return this.conn
  }
  async beginTransaction(): Promise<void> {
    // Транзакция через мост = несколько вызовов подряд, а между ними может писать движок.
    // Поэтому атомарные группы запросов отправляем одним вызовом: см. batch() ниже.
    throw new Error('Для атомарных изменений используй batch()')
  }
  async commitTransaction() {}
  async rollbackTransaction() {}
  async releaseConnection() {}
  async destroy() {}
}

class BridgeDialect implements Dialect {
  createAdapter() {
    return new SqliteAdapter()
  }
  createDriver() {
    return new BridgeDriver()
  }
  createIntrospector(db: Kysely<unknown>) {
    return new SqliteIntrospector(db)
  }
  createQueryCompiler() {
    return new SqliteQueryCompiler()
  }
}

export const db = new Kysely<DB>({
  dialect: new BridgeDialect(),
  plugins: [new CamelCasePlugin()],
})

type Compilable = { compile(): CompiledQuery }

function toStatement(s: SqlStatement | Compilable): SqlStatement {
  if ('compile' in s) {
    const c = s.compile()
    return { sql: c.sql, params: c.parameters as SqlValue[] }
  }
  return s
}

/** Несколько запросов в одной транзакции на стороне SQLite: либо все, либо ни одного */
export async function batch(statements: (SqlStatement | Compilable)[]): Promise<ExecResult[]> {
  if (statements.length === 0) return []
  const { results } = await MusicCore.batch({ statements: statements.map(toStatement) })
  wrote()
  return results
}

/** Сырой SELECT с результатом в виде объектов (имена колонок как в запросе) */
export async function all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
  return toObjects<T>(await MusicCore.query({ sql, params }))
}

export async function run(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
  const r = await MusicCore.execute({ sql, params })
  wrote()
  return r
}

/** Прогоняет недостающие миграции. Вызывается один раз при старте приложения. */
export async function migrate(): Promise<number> {
  const res = await MusicCore.query({ sql: 'PRAGMA user_version' })
  const current = Number(res.values[0]?.[0] ?? 0)
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    await MusicCore.batch({
      statements: [...m.statements.map((sql) => ({ sql })), { sql: `PRAGMA user_version = ${m.version}` }],
    })
  }
  return current
}
