import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { FileSyncServer, listFiles, hashFile, type FileSyncConfig } from '../desktop/filesync'
import { keyOf, type BaseEntry, type Stat } from '@/filesync/plan'
import { runSync, type BaseStore, type SyncIO, type TransferResult } from '@/filesync/run'

/**
 * Сквозная проверка папки по Wi-Fi: настоящий сервер компьютера (desktop/filesync.ts) на временной папке
 * и «телефон» — вторая папка и тот же движок синхронизации (src/filesync), что на телефоне. Телефонная часть
 * здесь на Node: она делает ровно то, что в приложении делает Kotlin (online/FileSync.kt).
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-filesync-'))
const pcDir = path.join(tmp, 'pc')
const pcTrash = path.join(tmp, 'pc-trash')
const phoneDir = path.join(tmp, 'phone')
const phoneTrash = path.join(phoneDir, '.amber-trash')
let config: FileSyncConfig = { enabled: true, folder: pcDir, devices: [], id: 'pc-1' }
const server = new FileSyncServer({
  config: () => config,
  save: (c) => (config = c),
  trash: async (abs) => {
    if (abs.includes('LOCKED')) throw new Error('EBUSY')
    await fsp.mkdir(pcTrash, { recursive: true })
    await fsp.rename(abs, path.join(pcTrash, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${path.basename(abs)}`))
  },
  name: 'Тестовый ПК',
})
let base = ''
let token = ''

const statOf = async (abs: string): Promise<Stat | null> => {
  const st = await fsp.stat(abs).catch(() => null)
  return st ? { s: st.size, m: Math.floor(st.mtimeMs) } : null
}
const matches = (st: Stat | null, expect: Stat | null) =>
  expect == null ? st == null : st != null && st.s === expect.s && Math.abs(st.m - expect.m) < 1000
const local = (p: string) => path.join(phoneDir, ...p.split('/'))
const expectParam = (e: Stat | null) => (e ? `${e.s}:${e.m}` : 'none')

async function toTrash(abs: string) {
  await fsp.mkdir(phoneTrash, { recursive: true })
  await fsp.rename(abs, path.join(phoneTrash, `${Date.now()}-${path.basename(abs)}`))
}

/** «Телефон» на Node: то же, что FileSync.kt */
const io: SyncIO = {
  listLocal: () => listFiles(phoneDir),
  listRemote: async () => ((await (await call('GET', '/list')).json()) as { files: never[] }).files,
  hashLocal: (p) => hashFile(local(p)),
  hashRemote: async (p) => ((await (await call('GET', `/hash?p=${encodeURIComponent(p)}`)).json()) as { h: string }).h,
  async pull(rp, lp, from, expect): Promise<TransferResult> {
    const res = await call('GET', `/file?p=${encodeURIComponent(rp)}`)
    if (res.status === 404) return { ok: false, why: 'changed' }
    const r = { s: Number(res.headers.get('x-size')), m: Number(res.headers.get('x-mtime')) }
    if (!matches(r, from)) return { ok: false, why: 'changed' }
    const abs = local(lp)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    const part = path.join(path.dirname(abs), `.${path.basename(abs)}.amber-part`)
    await fsp.writeFile(part, Buffer.from(await res.arrayBuffer()))
    if ((await fsp.stat(part)).size !== from.s || !matches(await statOf(abs), expect)) {
      await fsp.unlink(part)
      return { ok: false, why: 'changed' }
    }
    if (expect) await toTrash(abs)
    await fsp.rename(part, abs)
    return { ok: true, l: (await statOf(abs))!, r }
  },
  async push(lp, rp, from, expect): Promise<TransferResult> {
    const abs = local(lp)
    if (!matches(await statOf(abs), from)) return { ok: false, why: 'changed' }
    const q = `p=${encodeURIComponent(rp)}&s=${from.s}&m=${from.m}&expect=${expectParam(expect)}`
    const res = await call('PUT', `/file?${q}`, await fsp.readFile(abs))
    if (!res.ok) {
      const b = (await res.json()) as { why?: TransferResult extends { why: infer W } ? W : never; error: string }
      return { ok: false, why: b.why ?? 'error', message: b.error }
    }
    return { ok: true, l: from, r: (await res.json()) as Stat }
  },
  async trashLocal(p, expect) {
    const abs = local(p)
    const st = await statOf(abs)
    if (!st) return 'missing'
    if (!matches(st, expect)) return 'changed'
    await toTrash(abs)
    return 'ok'
  },
  async trashRemote(p, expect) {
    const res = await call('POST', '/trash', JSON.stringify({ p, expect: expectParam(expect) }))
    return ((await res.json()) as { result: 'ok' | 'changed' | 'missing' }).result
  },
}

const saved = new Map<string, BaseEntry>()
const store: BaseStore = {
  load: async () => [...saved.values()],
  put: async (e) => void saved.set(keyOf(e.p), e),
  remove: async (k) => void saved.delete(k),
}

function call(method: string, p: string, body?: Uint8Array | string) {
  return fetch(`${base}${p}`, {
    method,
    body: body as BodyInit | undefined,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}
async function put(dir: string, p: string, data: string | Buffer, mtime?: number) {
  const abs = path.join(dir, ...p.split('/'))
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  await fsp.writeFile(abs, data)
  if (mtime) await fsp.utimes(abs, new Date(mtime), new Date(mtime))
}
const read = (dir: string, p: string) => fsp.readFile(path.join(dir, ...p.split('/')), 'utf8').catch(() => null)
const names = async (dir: string) => (await listFiles(dir)).map((f) => f.p).sort()

beforeAll(async () => {
  for (const d of [pcDir, phoneDir]) await fsp.mkdir(d, { recursive: true })
  await server.start(0)
  base = `http://127.0.0.1:${server.port}/amber-sync/v1`
})
afterAll(async () => {
  await server.stop()
  await fsp.rm(tmp, { recursive: true, force: true })
})

describe('папка по Wi-Fi: компьютер', () => {
  it('без кода не пускает, по коду подключает один раз', async () => {
    const hello = (await (await call('GET', '/hello')).json()) as { app: string; name: string }
    expect(hello).toMatchObject({ app: 'amber', name: 'Тестовый ПК' })
    expect((await call('GET', '/list')).status).toBe(401)
    const { code } = server.pairCode()
    const wrong = await call('POST', '/pair', JSON.stringify({ code: code === '000000' ? '111111' : '000000', name: 'Телефон' }))
    expect(wrong.status).toBe(403)
    const ok = (await (await call('POST', '/pair', JSON.stringify({ code, name: 'Телефон' }))).json()) as { token: string }
    token = ok.token
    expect(config.devices).toHaveLength(1)
    // Код одноразовый
    expect((await call('POST', '/pair', JSON.stringify({ code, name: 'Чужой' }))).status).toBe(403)
    expect((await call('GET', '/list')).status).toBe(200)
  })

  it('за пределы папки не выйти', async () => {
    for (const p of ['../secret.txt', 'a/../../x', '.amber-trash/x', 'C:\\Windows\\win.ini']) {
      expect((await call('GET', `/file?p=${encodeURIComponent(p)}`)).status).toBe(400)
    }
  })

  it('первая синхронизация в обе стороны, кириллица и вложенные папки', async () => {
    await put(pcDir, 'Кино/Группа крови.mp3', 'кино'.repeat(1000))
    await put(pcDir, 'Сплин/Выхода нет.mp3', 'сплин'.repeat(500))
    await put(phoneDir, 'С телефона/Запись.m4a', 'телефон'.repeat(300))
    // Уже одинаковые (как после Syncthing): только запоминаются
    await put(pcDir, 'Общее.mp3', 'общее', 1_700_000_000_000)
    await put(phoneDir, 'Общее.mp3', 'общее', 1_700_000_000_000)
    const r = await runSync(io, store)
    expect(r).toMatchObject({ pulled: 2, pushed: 1, adopted: 1, errors: [] })
    expect(await names(phoneDir)).toEqual(await names(pcDir))
    expect(await read(pcDir, 'С телефона/Запись.m4a')).toBe('телефон'.repeat(300))
    const again = await runSync(io, store)
    expect(again).toMatchObject({ pulled: 0, pushed: 0, trashedLocal: 0, trashedRemote: 0 })
  })

  it('правка и удаление доходят, прежние версии — в корзине', async () => {
    await put(phoneDir, 'Кино/Группа крови.mp3', 'новые теги'.repeat(1000))
    await fsp.unlink(path.join(pcDir, 'Сплин', 'Выхода нет.mp3'))
    const r = await runSync(io, store)
    expect(r).toMatchObject({ pushed: 1, trashedLocal: 1, errors: [] })
    expect(await read(pcDir, 'Кино/Группа крови.mp3')).toBe('новые теги'.repeat(1000))
    // Старая версия на компьютере и удалённый файл на телефоне — в корзинах
    expect((await fsp.readdir(pcTrash)).some((n) => n.endsWith('Группа крови.mp3'))).toBe(true)
    expect((await fsp.readdir(phoneTrash)).some((n) => n.endsWith('Выхода нет.mp3'))).toBe(true)
  })

  it('занятый файл на компьютере не трогается и приходит позже', async () => {
    await put(pcDir, 'LOCKED.mp3', 'v1')
    await runSync(io, store)
    await put(phoneDir, 'LOCKED.mp3', 'v2-длиннее')
    const r = await runSync(io, store)
    expect(r.errors.map((e) => e.why)).toEqual(['Файл занят'])
    expect(await read(pcDir, 'LOCKED.mp3')).toBe('v1')
    // Временных файлов не осталось
    expect((await fsp.readdir(pcDir)).filter((n) => n.includes('amber-part'))).toEqual([])
  })

  it('файл на компьютере поменяли после списка — сервер не принимает замену', async () => {
    await put(pcDir, 'race.mp3', 'v1')
    await runSync(io, store)
    const st = (await statOf(path.join(pcDir, 'race.mp3')))!
    await put(pcDir, 'race.mp3', 'компьютер-v2', st.m + 5000)
    const res = await call('PUT', `/file?p=race.mp3&s=3&m=${Date.now()}&expect=${st.s}:${st.m}`, 'abc')
    expect(res.status).toBe(409)
    expect(await read(pcDir, 'race.mp3')).toBe('компьютер-v2')
  })

  it('недокачанный файл не встаёт на место', async () => {
    const res = await call('PUT', `/file?p=half.mp3&s=100&m=${Date.now()}&expect=none`, 'короче')
    expect(res.status).toBe(400)
    expect(fs.existsSync(path.join(pcDir, 'half.mp3'))).toBe(false)
  })
})
