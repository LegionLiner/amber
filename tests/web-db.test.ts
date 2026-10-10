import { beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs from 'sql.js'

/**
 * Повреждённая база на компьютере: файл после выключения из розетки забит нулями или обрезан.
 * WebDb.open должен отложить его, взять копию .bak и запуститься, а не упасть с «file is not a database».
 */
const SQL = await initSqlJs()

function makeDb(rows: number): Uint8Array {
  const db = new SQL.Database()
  db.run('CREATE TABLE play_events (id INTEGER PRIMARY KEY, track_key TEXT, started_at INTEGER)')
  db.run('CREATE INDEX ix ON play_events(track_key, started_at)')
  for (let i = 0; i < rows; i++) db.run('INSERT INTO play_events (track_key, started_at) VALUES (?, ?)', [`k${i % 50}`, i])
  const out = db.export()
  db.close()
  return out
}

const disk: { main: Uint8Array | null; bak: Uint8Array | null; broken: string[]; writes: Uint8Array[] } = {
  main: null,
  bak: null,
  broken: [],
  writes: [],
}

vi.stubGlobal('window', {
  amberDesktop: {
    readDb: async () => disk.main,
    writeDb: async (d: Uint8Array) => {
      disk.writes.push(d)
      disk.main = d
    },
    readDbBackup: async () => (disk.bak ? { data: disk.bak, at: 1_760_000_000_000 } : null),
    quarantineDb: async () => {
      if (!disk.main) return null
      disk.broken.push('amber.sqlite.broken-1')
      disk.main = null
      return 'amber.sqlite.broken-1'
    },
    onFlush: () => undefined,
  },
})
vi.stubGlobal('addEventListener', () => undefined)
vi.stubGlobal('document', { addEventListener: () => undefined, visibilityState: 'visible' })
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: '' }))
vi.mock('sql.js', async (orig) => {
  const real = (await orig()) as { default: typeof initSqlJs }
  return { default: () => real.default() }
})

const { WebDb, openChecked } = await import('@/native/web/web-db')

const count = (w: Awaited<ReturnType<typeof WebDb.open>>) => Number(w.query('SELECT COUNT(*) FROM play_events').values[0]![0])

beforeEach(() => {
  disk.main = null
  disk.bak = null
  disk.broken = []
  disk.writes = []
})

describe('openChecked', () => {
  it('целая база открывается, битая — нет', () => {
    const good = makeDb(2000)
    expect(openChecked(SQL, good)).not.toBeNull()
    expect(openChecked(SQL, new Uint8Array(good.length))).toBeNull()
    expect(openChecked(SQL, good.slice(0, good.length / 2))).toBeNull()
    const holed = good.slice()
    holed.fill(0, 4096 * 3, 4096 * 6)
    expect(openChecked(SQL, holed)).toBeNull()
  })
})

describe('WebDb.open на компьютере', () => {
  it('обычный запуск: ничего не восстанавливает', async () => {
    disk.main = makeDb(10)
    const w = await WebDb.open()
    expect(count(w)).toBe(10)
    expect(w.takeRecovery()).toBeNull()
    expect(disk.broken).toEqual([])
  })

  it('файл забит нулями: откладывает его и берёт копию .bak', async () => {
    disk.bak = makeDb(7)
    disk.main = new Uint8Array(disk.bak.length)
    const w = await WebDb.open()
    expect(count(w)).toBe(7)
    expect(w.takeRecovery()).toEqual({ restoredFrom: 1_760_000_000_000, brokenFile: 'amber.sqlite.broken-1' })
    expect(w.takeRecovery()).toBeNull()
    // Восстановленная база сразу записана на место битой
    expect(disk.writes).toHaveLength(1)
    expect(openChecked(SQL, disk.main!)).not.toBeNull()
  })

  it('копии нет или она тоже битая: начинает пустую базу, а не падает', async () => {
    disk.main = new Uint8Array(8192)
    disk.bak = new Uint8Array(8192)
    const w = await WebDb.open()
    expect(w.query('SELECT COUNT(*) FROM sqlite_master').values[0]![0]).toBe(0)
    expect(w.takeRecovery()).toEqual({ restoredFrom: null, brokenFile: 'amber.sqlite.broken-1' })
  })
})
