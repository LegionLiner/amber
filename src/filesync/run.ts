import { keyOf, makePlan, type Action, type BaseEntry, type FileEntry, type Plan, type Stat } from './plan'

/**
 * Проход синхронизации: списки обеих сторон → план (plan.ts) → действия по одному.
 * После каждого удачного действия запоминается, какими файлы стали (base) — прерванный проход продолжится
 * с того же места, а не начнётся заново и не примет недокачанное за удалённое.
 *
 * Как именно читаются и пишутся файлы, решает SyncIO: на телефоне это движок (Kotlin, файлы и HTTP к
 * компьютеру), в тестах — две папки в памяти.
 */

/** Результат передачи: какими файлы стали с обеих сторон. changed — пока шли, файл успели поменять */
export type TransferResult =
  { ok: true; l: Stat; r: Stat } | { ok: false; why: 'changed' | 'busy' | 'missing' | 'error'; message?: string }

export interface SyncIO {
  listLocal(): Promise<FileEntry[]>
  listRemote(): Promise<FileEntry[]>
  hashLocal(p: string): Promise<string>
  hashRemote(p: string): Promise<string>
  /** Скачать: remote rp (каким он был в списке — from) → local lp; expect — каким должен быть lp сейчас */
  pull(rp: string, lp: string, from: Stat, expect: Stat | null): Promise<TransferResult>
  push(lp: string, rp: string, from: Stat, expect: Stat | null): Promise<TransferResult>
  /** В корзину, если файл всё ещё такой, как ожидаем */
  trashLocal(p: string, expect: Stat): Promise<'ok' | 'changed' | 'missing'>
  trashRemote(p: string, expect: Stat): Promise<'ok' | 'changed' | 'missing'>
}

export interface BaseStore {
  load(): Promise<BaseEntry[]>
  put(e: BaseEntry): Promise<void>
  remove(key: string): Promise<void>
}

export interface SyncProgress {
  done: number
  total: number
  bytesDone: number
  bytesTotal: number
  current: string | null
}

export interface SyncReport {
  pulled: number
  pushed: number
  trashedLocal: number
  trashedRemote: number
  adopted: number
  /** Поменяли с обеих сторон: оставлен более новый, второй в корзине */
  conflicts: string[]
  /** Удаления, которые ждут подтверждения */
  held: number
  skipped: { p: string; why: string }[]
  errors: { p: string; why: string }[]
  error?: Plan['error'] | 'cancelled'
}

const bytesOf = (a: Action) => (a.op === 'pull' || a.op === 'push' ? a.from.s : 0)
const pathOf = (a: Action) => ('lp' in a ? a.lp : 'rp' in a ? a.rp : null)

export async function runSync(
  io: SyncIO,
  base: BaseStore,
  opts: { confirmDeletes?: boolean; onProgress?: (p: SyncProgress) => void; signal?: AbortSignal } = {},
): Promise<SyncReport> {
  const report: SyncReport = {
    pulled: 0,
    pushed: 0,
    trashedLocal: 0,
    trashedRemote: 0,
    adopted: 0,
    conflicts: [],
    held: 0,
    skipped: [],
    errors: [],
  }
  const [local, remote, b] = await Promise.all([io.listLocal(), io.listRemote(), base.load()])
  const plan = makePlan(local, remote, b, { confirmDeletes: opts.confirmDeletes })
  report.skipped = plan.skipped
  report.held = plan.held.length
  if (plan.error) {
    report.error = plan.error
    return report
  }

  const work = plan.actions.filter((a) => a.op !== 'forget' && a.op !== 'adopt')
  const progress: SyncProgress = {
    done: 0,
    total: work.length,
    bytesDone: 0,
    bytesTotal: work.reduce((s, a) => s + bytesOf(a), 0),
    current: null,
  }
  opts.onProgress?.({ ...progress })

  for (const a of plan.actions) {
    if (opts.signal?.aborted) {
      report.error = 'cancelled'
      break
    }
    if (a.op === 'forget') {
      await base.remove(a.key)
      continue
    }
    if (a.op === 'adopt') {
      await base.put({ p: a.lp, l: a.l, r: a.r })
      report.adopted++
      continue
    }
    progress.current = pathOf(a)
    opts.onProgress?.({ ...progress })
    try {
      await apply(a, io, base, report)
    } catch (e) {
      report.errors.push({ p: pathOf(a) ?? '', why: e instanceof Error ? e.message : String(e) })
    }
    progress.done++
    progress.bytesDone += bytesOf(a)
    progress.current = null
    opts.onProgress?.({ ...progress })
  }
  return report
}

async function apply(a: Action, io: SyncIO, base: BaseStore, report: SyncReport): Promise<void> {
  switch (a.op) {
    case 'verify': {
      const [hl, hr] = await Promise.all([io.hashLocal(a.lp), io.hashRemote(a.rp)])
      if (hl === hr) {
        await base.put({ p: a.lp, l: a.l, r: a.r })
        report.adopted++
        return
      }
      // Содержимое разное: побеждает более новый
      const next: Action =
        a.l.m >= a.r.m
          ? { op: 'push', lp: a.lp, rp: a.rp, from: a.l, expect: a.r, conflict: a.conflict }
          : { op: 'pull', lp: a.lp, rp: a.rp, from: a.r, expect: a.l, conflict: a.conflict }
      return apply(next, io, base, report)
    }
    case 'pull':
    case 'push': {
      const r = a.op === 'pull' ? await io.pull(a.rp, a.lp, a.from, a.expect) : await io.push(a.lp, a.rp, a.from, a.expect)
      if (!r.ok) {
        // Файл поменяли, пока шёл проход, или он занят (играет) — разберётся следующий проход
        if (r.why !== 'changed') report.errors.push({ p: a.lp, why: r.message ?? r.why })
        return
      }
      await base.put({ p: a.lp, l: r.l, r: r.r })
      if (a.op === 'pull') report.pulled++
      else report.pushed++
      if (a.conflict) report.conflicts.push(a.lp)
      return
    }
    case 'trashLocal': {
      const r = await io.trashLocal(a.lp, a.expect)
      if (r === 'changed') return
      await base.remove(keyOf(a.lp))
      if (r === 'ok') report.trashedLocal++
      return
    }
    case 'trashRemote': {
      const r = await io.trashRemote(a.rp, a.expect)
      if (r === 'changed') return
      await base.remove(keyOf(a.rp))
      if (r === 'ok') report.trashedRemote++
      return
    }
  }
}
