import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { DbFile, looksLikeDb } from '../desktop/db-file'

/** amber.sqlite на компьютере: копия .bak, защита копии от битого файла, откладывание битой базы */
const SQL = await initSqlJs()

function makeDb(rows: number): Uint8Array {
  const db = new SQL.Database()
  db.run('CREATE TABLE t (n INTEGER)')
  for (let i = 0; i < rows; i++) db.run('INSERT INTO t VALUES (?)', [i])
  const out = db.export()
  db.close()
  return out
}
const rowsIn = (file: string) => Number(new SQL.Database(fs.readFileSync(file)).exec('SELECT COUNT(*) FROM t')[0]!.values[0]![0])

let dir = ''
let file = ''
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-db-'))
  file = path.join(dir, 'amber.sqlite')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('DbFile', () => {
  it('пишет базу и перед первой записью за запуск делает копию .bak', async () => {
    fs.writeFileSync(file, makeDb(3))
    const f = new DbFile(() => file)
    await f.write(makeDb(5))
    await f.write(makeDb(6))
    expect(rowsIn(file)).toBe(6)
    expect(rowsIn(`${file}.bak`)).toBe(3)
    expect(fs.existsSync(`${file}.tmp`)).toBe(false)
    expect((await f.readBackup())?.data.length).toBe(fs.statSync(`${file}.bak`).size)
  })

  it('битый файл не затирает хорошую копию .bak', async () => {
    fs.writeFileSync(`${file}.bak`, makeDb(4))
    fs.writeFileSync(file, new Uint8Array(8192))
    expect(await looksLikeDb(file)).toBe(false)
    const f = new DbFile(() => file)
    await f.write(makeDb(9))
    expect(rowsIn(`${file}.bak`)).toBe(4)
    expect(rowsIn(file)).toBe(9)
  })

  it('откладывает битую базу, а не удаляет её', async () => {
    fs.writeFileSync(file, new Uint8Array(8192))
    const f = new DbFile(() => file)
    const name = await f.quarantine()
    expect(name).toMatch(/^amber\.sqlite\.broken-\d{8}-\d{6}$/)
    expect(fs.existsSync(file)).toBe(false)
    expect(fs.statSync(path.join(dir, name!)).size).toBe(8192)
    expect(await f.read()).toBeNull()
    expect(await f.quarantine()).toBeNull()
  })

  it('ошибка одной записи не останавливает следующие', async () => {
    const f = new DbFile(() => file)
    fs.mkdirSync(`${file}.tmp`)
    await expect(f.write(makeDb(1))).rejects.toThrow()
    fs.rmdirSync(`${file}.tmp`)
    await f.write(makeDb(2))
    await f.settled()
    expect(rowsIn(file)).toBe(2)
  })

  it('копии нет или она не база — null', async () => {
    const f = new DbFile(() => file)
    expect(await f.readBackup()).toBeNull()
    fs.writeFileSync(`${file}.bak`, 'not a database')
    expect(await f.readBackup()).toBeNull()
  })
})
