import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { DbRecovery, ExecResult, QueryResult, SqlStatement, SqlValue } from '../types'
import { desktop } from '../desktop/bridge'

/**
 * SQLite в браузере (sql.js) для разработки без телефона и для приложения на компьютере.
 * База сохраняется через секунду после последней записи: в браузере — в IndexedDB,
 * на компьютере — файлом amber.sqlite в папке данных приложения.
 * При открытии база проверяется (quick_check, десятки миллисекунд): если файл повреждён — например,
 * компьютер выключили из розетки посреди записи, — он откладывается, а на его место встаёт копия
 * с прошлого запуска (amber.sqlite.bak). Так приложение запускается, а не падает с «file is not a database».
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

/** Открыть сохранённые байты и убедиться, что это целая база. Битая — null */
export function openChecked(SQL: SqlJsStatic, bytes: Uint8Array): Database | null {
  let db: Database | null = null
  try {
    db = new SQL.Database(bytes)
    if (db.exec('PRAGMA quick_check')[0]?.values[0]?.[0] === 'ok') return db
  } catch {
    /* file is not a database / database disk image is malformed */
  }
  db?.close()
  return null
}

export class WebDb {
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  /** С какого момента есть несохранённые изменения (0 — всё сохранено) */
  private dirtySince = 0
  /** Последняя запись на диск (компьютер): перед выходом её дожидаемся */
  private writing: Promise<void> = Promise.resolve()

  private constructor(
    private readonly db: Database,
    /** База была повреждена при запуске: что с ней сделали (показывается один раз) */
    private recovery: DbRecovery | null = null,
  ) {
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
    if (!saved) return new WebDb(new SQL.Database())
    const db = openChecked(SQL, saved)
    if (db) return new WebDb(db)

    // База повреждена: откладываем её (не удаляем) и берём копию с прошлого запуска, если она цела
    console.error('web-db: сохранённая база повреждена')
    let brokenFile: string | null = null
    let restored: { db: Database; at: number } | null = null
    if (desktop) {
      brokenFile = await desktop.quarantineDb().catch(() => null)
      const bak = await desktop.readDbBackup().catch(() => null)
      const d = bak ? openChecked(SQL, bak.data) : null
      if (d && bak) restored = { db: d, at: bak.at }
    } else {
      brokenFile = `${IDB_KEY}-broken-${Date.now()}`
      await idbSet(brokenFile, saved).catch(() => undefined)
    }
    const w = new WebDb(restored?.db ?? new SQL.Database(), { restoredFrom: restored?.at ?? null, brokenFile })
    // Сразу на диск: на месте битого файла должна лежать целая база
    w.dirtySince = Date.now()
    w.flush()
    return w
  }

  /** Что случилось с базой при запуске; отдаётся один раз */
  takeRecovery(): DbRecovery | null {
    const r = this.recovery
    this.recovery = null
    return r
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
