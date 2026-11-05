import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FileSyncServer, type FileSyncConfig } from '../desktop/filesync'

/**
 * Общие данные по Wi-Fi без серверов (desktop/hub.ts): настоящий сервер компьютера, «окно компьютера»
 * со своим токеном и «телефон», подключённый по коду. Говорят на том же протоколе, что server/.
 */

// Без маячка в сеть: только 127.0.0.1
process.env.AMBER_FILESYNC_BIND = '127.0.0.1'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-hub-'))
const hubFile = path.join(tmp, 'hub.jsonl')
let config: FileSyncConfig = { enabled: true, folder: null, devices: [], id: 'pc-1' }
const make = () =>
  new FileSyncServer({
    config: () => config,
    save: (c) => (config = c),
    trash: async () => undefined,
    name: 'Тестовый ПК',
    hubFile: () => hubFile,
  })
let server = make()
let root = ''
let pcToken = ''
let phoneToken = ''

type Change = { kind: string; id: string; data: unknown; deleted: boolean; updatedAt: number }
type SyncRes = { cursor: number; changes: Change[]; more: boolean; accepted: number }

async function call(method: string, p: string, token: string | null, body?: unknown) {
  return fetch(`${root}${p}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
const sync = async (token: string, cursor: number, changes: Change[]) =>
  (await (await call('POST', '/v1/sync', token, { cursor, changes })).json()) as SyncRes
const item = (id: string, data: unknown, updatedAt: number, deleted = false): Change => ({
  kind: 'rate',
  id,
  data: deleted ? null : data,
  deleted,
  updatedAt,
})

/** Поток событий: события копятся в массив, пока не закроют */
async function listen(token: string) {
  const ctl = new AbortController()
  const events: { name: string; data: Record<string, unknown> }[] = []
  const res = await fetch(`${root}/v1/events?role=ui`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    signal: ctl.signal,
  })
  expect(res.headers.get('content-type')).toContain('text/event-stream')
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  void (async () => {
    let buf = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const name = /^event: (.*)$/m.exec(block)?.[1]
          const data = /^data: (.*)$/m.exec(block)?.[1]
          if (name) events.push({ name, data: data ? (JSON.parse(data) as Record<string, unknown>) : {} })
        }
      }
    } catch {
      /* закрыли */
    }
  })()
  const until = async (pred: () => boolean) => {
    for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 20))
    expect(pred()).toBe(true)
  }
  return { events, close: () => ctl.abort(), until }
}

beforeAll(async () => {
  await server.start(0)
  root = `http://127.0.0.1:${server.port}`
})
afterAll(async () => {
  await server.stop()
  await fsp.rm(tmp, { recursive: true, force: true })
})

describe('общие данные по Wi-Fi', () => {
  it('без подключения — нельзя', async () => {
    expect((await call('GET', '/v1/health', null)).status).toBe(200)
    expect((await call('POST', '/v1/sync', null, { cursor: 0, changes: [] })).status).toBe(401)
    expect((await call('POST', '/v1/sync', 'stranger', { cursor: 0, changes: [] })).status).toBe(401)
  })

  it('окно компьютера и телефон по коду', async () => {
    pcToken = server.localAccess().token
    expect(server.localAccess().token).toBe(pcToken)
    const { code } = server.pairCode()
    const r = (await (await call('POST', '/amber-sync/v1/pair', null, { code, name: 'Телефон' })).json()) as { token: string }
    phoneToken = r.token
    const me = (await (await call('GET', '/v1/me', phoneToken)).json()) as {
      devices: { name: string; platform: string; current: boolean }[]
    }
    expect(me.devices.map((d) => d.platform).sort()).toEqual(['android', 'desktop'])
    expect(me.devices.find((d) => d.current)?.name).toBe('Телефон')
  })

  it('обмен изменениями и «последнее побеждает»', async () => {
    const a = await sync(pcToken, 0, [item('t1', { r: 8 }, 100), item('t2', { r: 6 }, 100)])
    expect(a.accepted).toBe(2)
    expect(a.changes).toEqual([])
    // Телефон отправляет своё и получает чужое; t2 теперь его (позднее) — обратно ему не приходит
    const b = await sync(phoneToken, 0, [item('t2', { r: 10 }, 200), item('t3', { r: 4 }, 50)])
    expect(b.accepted).toBe(2)
    expect(b.changes.map((c) => c.id)).toEqual(['t1'])
    // Компьютер догоняет: более позднее t2 с телефона и новое t3
    const c = await sync(pcToken, a.cursor, [item('t3', { r: 2 }, 10)])
    expect(c.accepted).toBe(0)
    const got = Object.fromEntries(c.changes.map((x) => [x.id, x.data]))
    expect(got).toEqual({ t2: { r: 10 }, t3: { r: 4 } })
    // Удаление — тоже запись
    const d = await sync(pcToken, c.cursor, [item('t1', null, 300, true)])
    const e = await sync(phoneToken, b.cursor, [])
    expect(e.changes.find((x) => x.id === 't1')?.deleted).toBe(true)
    expect(d.accepted).toBe(1)
  })

  it('переживает перезапуск компьютера', async () => {
    await server.stop()
    server = make()
    await server.start(0)
    root = `http://127.0.0.1:${server.port}`
    const all = await sync(phoneToken, 0, [])
    const byId = Object.fromEntries(all.changes.map((x) => [x.id, x]))
    // Своё телефон не получает обратно; чужое — в последнем виде
    expect(byId.t1?.deleted).toBe(true)
    expect(byId.t2).toBeUndefined()
    expect(Object.keys(byId).sort()).toEqual(['t1'])
    const pc = await sync(pcToken, 0, [])
    expect(pc.changes.map((x) => x.id).sort()).toEqual(['t2', 't3'])
  })

  it('что играет и перенос музыки', async () => {
    const phone = await listen(phoneToken)
    await phone.until(() => phone.events.some((e) => e.name === 'hello'))
    const pc = await listen(pcToken)
    await pc.until(() => pc.events.some((e) => e.name === 'hello'))
    const pcId = `pc-${config.id}`
    // Компьютер играет — телефон видит
    await call('POST', '/v1/player', pcToken, { state: { key: 'abc', playing: true, positionMs: 1000 } })
    await phone.until(() => phone.events.some((e) => e.name === 'player' && e.data.id === pcId))
    // Изменения с компьютера будят телефон
    await sync(pcToken, 0, [item('t9', { r: 2 }, 900)])
    await phone.until(() => phone.events.some((e) => e.name === 'changed'))
    // «Слушать здесь»: телефон ставит компьютер на паузу
    expect((await call('POST', '/v1/command', phoneToken, { to: pcId, cmd: 'pause' })).status).toBe(200)
    await pc.until(() => pc.events.some((e) => e.name === 'command' && e.data.cmd === 'pause'))
    expect((await call('POST', '/v1/command', phoneToken, { to: 'никто', cmd: 'pause' })).status).toBe(404)
    phone.close()
    pc.close()
  })

  it('окно компьютера спрашивает разрешения (CORS)', async () => {
    const res = await fetch(`${root}/v1/sync`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization')
    const ok = await call('GET', '/v1/me', pcToken)
    expect(ok.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('данные выключили — их не отдают, папка без раздачи — тоже', async () => {
    config = { ...config, data: false }
    expect((await call('POST', '/v1/sync', pcToken, { cursor: 0, changes: [] })).status).toBe(404)
    config = { ...config, data: true }
    const list = await call('GET', '/amber-sync/v1/list', phoneToken)
    expect(list.status).toBe(503)
    expect(((await list.json()) as { why: string }).why).toBe('nofolder')
  })
})
