import initSqlJs, { type Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { ExecResult, QueryResult, SqlStatement, SqlValue } from '../types'
import { desktop } from '../desktop/bridge'

/**
 * SQLite в браузере (sql.js) для разработки без телефона и для приложения на компьютере.
 * База сохраняется через секунду после последней записи: в браузере — в IndexedDB,
 * на компьютере — файлом amber.sqlite в папке данных приложения.
 */

const IDB_NAME = 'yantar-web'
const IDB_STORE = 'kv'
const IDB_KEY = 'db'

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const d = await idb()
  return new Promise((resolve, reject) => {
    const req = d.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve(req.result as Uint8Array | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: Uint8Array): Promise<void> {
  const d = await idb()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export class WebDb {
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  /** С какого момента есть несохранённые изменения (0 — всё сохранено) */
  private dirtySince = 0
  /** Последняя запись на диск (компьютер): перед выходом её дожидаемся */
  private writing: Promise<void> = Promise.resolve()

  private constructor(private readonly db: Database) {
    // Окно закрывается: главный процесс ждёт, пока база допишется
    desktop?.onFlush(async () => {
      this.flush()
      await this.writing
    })
    // Уходя со страницы, сохраняем сразу: иначе последние секунды истории пропадут
    addEventListener('pagehide', () => this.flush())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush()
    })
  }

  static async open(): Promise<WebDb> {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl })
    let saved: Uint8Array | undefined
    try {
      saved = desktop ? ((await desktop.readDb()) ?? undefined) : await idbGet(IDB_KEY)
    } catch {
      saved = undefined
    }
    return new WebDb(saved ? new SQL.Database(saved) : new SQL.Database())
  }

  query(sql: string, params: SqlValue[] = []): QueryResult {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const columns = stmt.getColumnNames()
      const values: SqlValue[][] = []
      while (stmt.step()) values.push(stmt.get() as SqlValue[])
      return { columns, values }
    } finally {
      stmt.free()
    }
  }

  execute(sql: string, params: SqlValue[] = []): ExecResult {
    this.db.run(sql, params)
    const changes = this.db.getRowsModified()
    const lastId = Number(this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0)
    this.scheduleSave()
    return { changes, lastId }
  }

  batch(statements: SqlStatement[]): ExecResult[] {
    const results: ExecResult[] = []
    this.db.run('BEGIN')
    try {
      for (const s of statements) {
        this.db.run(s.sql, s.params ?? [])
        const changes = this.db.getRowsModified()
        const lastId = Number(this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0)
        results.push({ changes, lastId })
      }
      this.db.run('COMMIT')
    } catch (e) {
      this.db.run('ROLLBACK')
      throw e
    }
    this.scheduleSave()
    return results
  }

  /**
   * Сохранение через секунду после последней записи, но не реже раза в полторы секунды:
   * при непрерывных записях (анализ, учёт прослушиваний) одна задержка откладывала бы его бесконечно.
   */
  private scheduleSave() {
    if (!this.dirtySince) this.dirtySince = Date.now()
    clearTimeout(this.saveTimer)
    const overdue = Date.now() - this.dirtySince > 1500
    this.saveTimer = setTimeout(() => this.flush(), overdue ? 0 : 1000)
  }

  flush() {
    if (!this.dirtySince) return
    clearTimeout(this.saveTimer)
    this.dirtySince = 0
    const bytes = this.db.export()
    const save = desktop ? desktop.writeDb(bytes) : idbSet(IDB_KEY, bytes)
    this.writing = save.catch((e) => console.warn('web-db: не удалось сохранить', e))
  }
}
