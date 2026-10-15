import { describe, expect, it } from 'vitest'
import { keyOf, makePlan, type BaseEntry, type FileEntry, type Stat } from '@/filesync/plan'
import { runSync, type BaseStore, type SyncIO, type TransferResult } from '@/filesync/run'

/**
 * Синхронизация папки по Wi-Fi на двух «устройствах» в памяти: телефон (local) и компьютер (remote).
 * Главное, что проверяется: никакой файл не пропадает без следа — либо он на месте, либо в корзине.
 */

let clock = 1_700_000_000_000
const tick = (ms = 10_000) => (clock += ms)

class Disk {
  files = new Map<string, { data: string; m: number }>()
  trash: { p: string; data: string }[] = []
  /** Файл, который сейчас «играет»: его нельзя заменить */
  busy = new Set<string>()
  constructor(readonly name: string) {}
  write(p: string, data: string, m = tick()) {
    this.files.set(p, { data, m })
  }
  del(p: string) {
    this.files.delete(p)
  }
  get(p: string) {
    return this.files.get(p)?.data
  }
  stat(p: string): Stat | null {
    const f = this.files.get(p)
    return f ? { s: f.data.length, m: f.m } : null
  }
  list(): FileEntry[] {
    return [...this.files].map(([p, f]) => ({ p, s: f.data.length, m: f.m }))
  }
  matches(p: string, expect: Stat | null) {
    const st = this.stat(p)
    return expect == null ? st == null : st != null && st.s === expect.s && Math.abs(st.m - expect.m) < 1000
  }
  /** Положить новую версию: старая — в корзину */
  replace(p: string, data: string, m: number) {
    const old = this.files.get(p)
    if (old) this.trash.push({ p, data: old.data })
    this.files.set(p, { data, m })
  }
}

/** Телефон, компьютер и запомненное состояние между ними */
function pair() {
  const phone = new Disk('phone')
  const pc = new Disk('pc')
  const saved = new Map<string, BaseEntry>()
  const base: BaseStore = {
    load: async () => [...saved.values()],
    put: async (e) => void saved.set(keyOf(e.p), structuredClone(e)),
    remove: async (k) => void saved.delete(k),
  }
  /** Передача: источник должен быть тем же, что в списке, цель — такой, как ожидаем; иначе ничего не трогаем */
  const copy = (from: Disk, to: Disk, sp: string, tp: string, st: Stat, expect: Stat | null): TransferResult => {
    if (!from.matches(sp, st)) return { ok: false, why: 'changed' }
    if (to.busy.has(tp)) return { ok: false, why: 'busy' }
    if (!to.matches(tp, expect)) return { ok: false, why: 'changed' }
    // Время файла на другом устройстве своё: копия получает «сейчас», как телефон без setLastModified
    to.replace(tp, from.get(sp)!, tick(1))
    const a = from.stat(sp)!
    const b = to.stat(tp)!
    return from === phone ? { ok: true, l: a, r: b } : { ok: true, l: b, r: a }
  }
  const trash = (d: Disk, p: string, expect: Stat) => {
    if (!d.stat(p)) return 'missing' as const
    if (!d.matches(p, expect)) return 'changed' as const
    d.trash.push({ p, data: d.get(p)! })
    d.del(p)
    return 'ok' as const
  }
  const hash = (d: Disk, p: string) => `h:${d.get(p)}`
  const io: SyncIO = {
    listLocal: async () => phone.list(),
    listRemote: async () => pc.list(),
    hashLocal: async (p) => hash(phone, p),
    hashRemote: async (p) => hash(pc, p),
    pull: async (rp, lp, from, expect) => copy(pc, phone, rp, lp, from, expect),
    push: async (lp, rp, from, expect) => copy(phone, pc, lp, rp, from, expect),
    trashLocal: async (p, e) => trash(phone, p, e),
    trashRemote: async (p, e) => trash(pc, p, e),
  }
  const sync = (opts: Parameters<typeof runSync>[2] = {}) => runSync(io, base, opts)
  /** Ни один вариант файла не пропал: всё, что было, есть на месте или в корзине */
  const contents = (d: Disk) => new Set([...[...d.files.values()].map((f) => f.data), ...d.trash.map((t) => t.data)])
  return { phone, pc, sync, saved, contents }
}

const sorted = (d: Disk) => [...d.files.keys()].sort()

describe('синхронизация папки: первая встреча', () => {
  it('новые файлы с обеих сторон расходятся в обе стороны, второй проход ничего не делает', async () => {
    const { phone, pc, sync } = pair()
    phone.write('Кино/Группа крови.mp3', 'кино-1')
    pc.write('Сплин/Выхода нет.mp3', 'сплин-1')
    pc.write('Сплин/обложка.jpg', 'jpg')
    const r = await sync()
    expect(r).toMatchObject({ pulled: 2, pushed: 1, errors: [] })
    expect(sorted(phone)).toEqual(sorted(pc))
    const again = await sync()
    expect(again).toMatchObject({ pulled: 0, pushed: 0, trashedLocal: 0, trashedRemote: 0 })
  })

  it('одинаковые файлы (как их оставил Syncthing) просто запоминаются', async () => {
    const { phone, pc, sync } = pair()
    phone.write('a.mp3', 'aaa', 5000)
    pc.write('a.mp3', 'aaa', 6500) // разница в округлении времени
    const r = await sync()
    expect(r).toMatchObject({ adopted: 1, pulled: 0, pushed: 0 })
  })

  it('одинаковый размер, разное время: решает содержимое', async () => {
    const { phone, pc, sync } = pair()
    phone.write('same.mp3', 'xyz', 1000)
    pc.write('same.mp3', 'xyz', 900_000)
    phone.write('diff.mp3', 'old', 1000)
    pc.write('diff.mp3', 'new', 900_000)
    const r = await sync()
    expect(r.adopted).toBe(1)
    expect(r.pulled).toBe(1)
    expect(phone.get('diff.mp3')).toBe('new')
    // Проигравшая версия не пропала, а лежит в корзине телефона
    expect(phone.trash).toEqual([{ p: 'diff.mp3', data: 'old' }])
  })
})

describe('синхронизация папки: правки и удаления', () => {
  it('правка на одной стороне уходит на другую, старая версия — в корзину', async () => {
    const { phone, pc, sync } = pair()
    pc.write('song.mp3', 'v1')
    await sync()
    phone.write('song.mp3', 'v2-новые-теги')
    const r = await sync()
    expect(r.pushed).toBe(1)
    expect(pc.get('song.mp3')).toBe('v2-новые-теги')
    expect(pc.trash.map((t) => t.data)).toEqual(['v1'])
  })

  it('удалили на компьютере — на телефоне в корзину', async () => {
    const { phone, pc, sync } = pair()
    pc.write('a.mp3', 'a')
    pc.write('b.mp3', 'b')
    await sync()
    pc.del('a.mp3')
    const r = await sync()
    expect(r.trashedLocal).toBe(1)
    expect(sorted(phone)).toEqual(['b.mp3'])
    expect(phone.trash).toEqual([{ p: 'a.mp3', data: 'a' }])
  })

  it('удалили там, а здесь с тех пор поменяли — файл возвращается, а не удаляется', async () => {
    const { phone, pc, sync } = pair()
    pc.write('a.mp3', 'a')
    pc.write('keep.mp3', 'k')
    await sync()
    pc.del('a.mp3')
    phone.write('a.mp3', 'a-поправленный')
    const r = await sync()
    expect(r.trashedLocal).toBe(0)
    expect(pc.get('a.mp3')).toBe('a-поправленный')
  })

  it('поменяли с обеих сторон: остаётся более новый, второй в корзине', async () => {
    const { phone, pc, sync, contents } = pair()
    pc.write('a.mp3', 'база')
    await sync()
    phone.write('a.mp3', 'телефон')
    pc.write('a.mp3', 'компьютер-позже')
    const r = await sync()
    expect(r.conflicts).toEqual(['a.mp3'])
    expect(phone.get('a.mp3')).toBe('компьютер-позже')
    expect(contents(phone).has('телефон')).toBe(true)
  })

  it('переименование (удалили старое, появилось новое) ничего не теряет', async () => {
    const { phone, pc, sync } = pair()
    pc.write('Без названия.mp3', 'трек')
    await sync()
    phone.del('Без названия.mp3')
    phone.write('Кино - Звезда.mp3', 'трек', tick())
    await sync()
    expect(pc.get('Кино - Звезда.mp3')).toBe('трек')
    expect(pc.trash.map((t) => t.p)).toEqual(['Без названия.mp3'])
  })
})

describe('синхронизация папки: страховки', () => {
  it('папка с одной стороны пуста, а раньше файлы были, — ничего не удаляется', async () => {
    const { phone, pc, sync } = pair()
    for (let i = 0; i < 8; i++) pc.write(`t${i}.mp3`, `t${i}`)
    await sync()
    phone.files.clear() // карту вынули или пропал доступ к памяти
    const r = await sync()
    expect(r.error).toBe('localEmpty')
    expect(pc.files.size).toBe(8)
  })

  it('слишком много удалений — только с подтверждением', async () => {
    const { phone, pc, sync } = pair()
    for (let i = 0; i < 40; i++) pc.write(`t${i}.mp3`, `t${i}`)
    await sync()
    for (let i = 0; i < 30; i++) pc.del(`t${i}.mp3`)
    const r = await sync()
    expect(r.held).toBe(30)
    expect(phone.files.size).toBe(40)
    const ok = await sync({ confirmDeletes: true })
    expect(ok.trashedLocal).toBe(30)
    expect(phone.files.size).toBe(10)
    expect(phone.trash).toHaveLength(30)
  })

  it('прерванный проход продолжается, недокачанное не принимается за удалённое', async () => {
    const { phone, pc, sync } = pair()
    for (let i = 0; i < 6; i++) pc.write(`t${i}.mp3`, `t${i}`)
    const ctl = new AbortController()
    const first = await sync({
      signal: ctl.signal,
      onProgress: (p) => {
        if (p.done === 2) ctl.abort()
      },
    })
    expect(first.error).toBe('cancelled')
    expect(phone.files.size).toBeLessThan(6)
    const second = await sync()
    expect(second.trashedRemote).toBe(0)
    expect(sorted(phone)).toEqual(sorted(pc))
  })

  it('файл поменяли, пока шёл проход, — его не затирают', async () => {
    const { phone, pc, sync, contents } = pair()
    pc.write('a.mp3', 'v1')
    await sync()
    pc.write('a.mp3', 'v2')
    // Между списком и записью на телефоне файл поправили
    const origList = phone.list.bind(phone)
    phone.list = () => {
      const l = origList()
      phone.write('a.mp3', 'телефон-в-процессе')
      return l
    }
    await sync()
    phone.list = origList
    expect(contents(phone).has('телефон-в-процессе')).toBe(true)
    // Следующий проход видит конфликт и решает его, ничего не теряя
    await sync()
    expect(contents(phone).has('телефон-в-процессе') || contents(pc).has('телефон-в-процессе')).toBe(true)
    expect(contents(phone).has('v2') || contents(pc).has('v2')).toBe(true)
  })

  it('занятый файл (играет) пропускается и доходит в следующий раз', async () => {
    const { phone, pc, sync } = pair()
    pc.write('a.mp3', 'v1')
    await sync()
    phone.write('a.mp3', 'v2')
    pc.busy.add('a.mp3')
    const r = await sync()
    expect(r.errors.map((e) => e.why)).toEqual(['busy'])
    expect(pc.get('a.mp3')).toBe('v1')
    pc.busy.clear()
    await sync()
    expect(pc.get('a.mp3')).toBe('v2')
  })

  it('служебные файлы, регистр и имена, недопустимые в Windows', async () => {
    const { phone, pc, sync } = pair()
    phone.write('.stfolder/x', 'служебное')
    phone.write('Музыка/.amber-trash/old.mp3', 'корзина')
    phone.write('a.mp3.amber-part', 'недокачано')
    phone.write('Song.mp3', '1')
    phone.write('song.mp3', '2')
    phone.write('Что?.mp3', 'вопрос')
    pc.write('desktop.ini', 'windows')
    const r = await sync()
    expect(pc.files.size).toBe(1)
    expect(phone.files.has('desktop.ini')).toBe(false)
    expect(r.skipped.map((s) => s.why).sort()).toEqual([
      'есть файл с тем же именем в другом регистре',
      'имя недопустимо в Windows',
    ])
  })

  it('регистр имени на разных сторонах не делает два файла', () => {
    const p = makePlan([{ p: 'Kino/Song.MP3', s: 3, m: 1 }], [{ p: 'kino/song.mp3', s: 3, m: 1 }], [])
    expect(p.actions).toEqual([
      {
        op: 'adopt',
        lp: 'Kino/Song.MP3',
        rp: 'kino/song.mp3',
        l: { p: 'Kino/Song.MP3', s: 3, m: 1 },
        r: { p: 'kino/song.mp3', s: 3, m: 1 },
      },
    ])
  })
})

describe('синхронизация папки: пустая сторона', () => {
  it('даже с парой файлов пустая папка не стирает другую сторону без подтверждения', async () => {
    const { phone, pc, sync } = pair()
    pc.write('one.mp3', '1')
    pc.write('two.mp3', '2')
    await sync()
    phone.files.clear()
    expect((await sync()).error).toBe('localEmpty')
    expect(pc.files.size).toBe(2)
    const ok = await sync({ confirmDeletes: true })
    expect(ok.trashedRemote).toBe(2)
    expect(pc.trash).toHaveLength(2)
  })
})
