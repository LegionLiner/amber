import { all, batch, db } from '../db'
import { IN_LIBRARY } from './spotify'
import type { SqlValue } from '@/native/types'

/**
 * Контексты — ситуации, в которых звучит музыка: «Дорога», «Тренировка», «Работа».
 * Прослушивание относится к контексту, если попало в запущенный вручную интервал
 * или подходит под правила (часы, дни недели, устройство вывода).
 */

export interface ContextRules {
  /** [с, до) по часам; если «с» больше «до» — через полночь */
  hours?: [number, number]
  /** 1 = понедельник … 7 = воскресенье */
  weekdays?: number[]
  /** Начало имени вывода: 'bt:' — любые Bluetooth, 'bt:JBL' — колонка, 'wired' — провод */
  outputs?: string[]
}

export interface ContextRow {
  id: number
  title: string
  icon: string | null
  color: string | null
  rules: ContextRules
  running: number | null
}

export async function listContexts(): Promise<ContextRow[]> {
  const rows = await all<{
    id: number
    title: string
    icon: string | null
    color: string | null
    rules: string | null
    running: number | null
  }>(
    `SELECT c.id, c.title, c.icon, c.color, c.rules,
       (SELECT start_at FROM context_intervals i WHERE i.context_id = c.id AND i.end_at IS NULL ORDER BY start_at DESC LIMIT 1) AS running
     FROM contexts c ORDER BY c.created_at`,
  )
  return rows.map((r) => ({ ...r, rules: parseRules(r.rules) }))
}

function parseRules(json: string | null): ContextRules {
  if (!json) return {}
  try {
    return JSON.parse(json) as ContextRules
  } catch {
    return {}
  }
}

export async function saveContext(c: {
  id?: number
  title: string
  icon: string | null
  color: string | null
  rules: ContextRules
}): Promise<number> {
  const rules = JSON.stringify(c.rules)
  if (c.id) {
    await db.updateTable('contexts').set({ title: c.title, icon: c.icon, color: c.color, rules }).where('id', '=', c.id).execute()
    return c.id
  }
  const r = await db
    .insertInto('contexts')
    .values({ title: c.title, icon: c.icon, color: c.color, rules, createdAt: Date.now() })
    .executeTakeFirst()
  return Number(r.insertId)
}

export async function deleteContext(id: number): Promise<void> {
  await batch([db.deleteFrom('contextIntervals').where('contextId', '=', id), db.deleteFrom('contexts').where('id', '=', id)])
}

/** Запустить контекст вручную (остальные запущенные останавливаются) */
export async function startContext(id: number): Promise<void> {
  const now = Date.now()
  await batch([
    { sql: `UPDATE context_intervals SET end_at = ? WHERE end_at IS NULL`, params: [now] },
    { sql: `INSERT INTO context_intervals (context_id, start_at, end_at) VALUES (?, ?, NULL)`, params: [id, now] },
  ])
}

export async function stopContexts(): Promise<void> {
  await batch([{ sql: `UPDATE context_intervals SET end_at = ? WHERE end_at IS NULL`, params: [Date.now()] }])
}

/** SQL-условие «событие pe относится к контексту» и его параметры */
export function contextWhere(c: ContextRow): { sql: string; params: SqlValue[] } {
  const params: SqlValue[] = [c.id, Date.now()]
  const manual = `EXISTS (SELECT 1 FROM context_intervals i WHERE i.context_id = ? AND pe.started_at >= i.start_at AND pe.started_at < COALESCE(i.end_at, ?))`
  const parts: string[] = []
  const r = c.rules
  if (r.hours) {
    const [a, b] = r.hours
    parts.push(
      a <= b
        ? `(pe.local_hour >= ${Number(a)} AND pe.local_hour < ${Number(b)})`
        : `(pe.local_hour >= ${Number(a)} OR pe.local_hour < ${Number(b)})`,
    )
  }
  if (r.weekdays?.length) parts.push(`pe.weekday IN (${r.weekdays.map(Number).join(',')})`)
  if (r.outputs?.length) {
    // LIKE в SQLite не различает регистр латиницы — как и сравнение «сейчас» выше
    parts.push(`(${r.outputs.map(() => `pe.output LIKE ?`).join(' OR ')})`)
    params.push(...r.outputs.map((o) => `${o}%`))
  }
  const auto = parts.length ? ` OR (${parts.join(' AND ')})` : ''
  return { sql: `(${manual}${auto})`, params }
}

export interface ContextStats {
  plays: number
  listenedMs: number
  top: { key: string; plays: number }[]
}

export async function contextStats(c: ContextRow): Promise<ContextStats> {
  const w = contextWhere(c)
  const [tot, top] = await Promise.all([
    all<{ plays: number; listenedMs: number }>(
      `SELECT COALESCE(SUM(counted), 0) AS plays, COALESCE(SUM(listened_ms), 0) AS listenedMs FROM stat_plays pe WHERE ${w.sql}`,
      w.params,
    ),
    all<{ key: string; plays: number }>(
      `SELECT track_key AS key, SUM(counted) AS plays FROM stat_plays pe WHERE ${w.sql} AND ${IN_LIBRARY}
       GROUP BY track_key HAVING SUM(counted) > 0 ORDER BY plays DESC, SUM(listened_ms) DESC LIMIT 40`,
      w.params,
    ),
  ])
  return { plays: tot[0]?.plays ?? 0, listenedMs: tot[0]?.listenedMs ?? 0, top }
}

/** Подходит ли контекст по своим правилам к текущему моменту и устройству вывода */
export function matchesRules(c: ContextRow, now: Date, output: string): boolean {
  const r = c.rules
  if (!r.hours && !r.weekdays?.length && !r.outputs?.length) return false
  const hour = now.getHours()
  const wd = ((now.getDay() + 6) % 7) + 1
  if (r.hours) {
    const [a, b] = r.hours
    if (a <= b ? !(hour >= a && hour < b) : !(hour >= a || hour < b)) return false
  }
  if (r.weekdays?.length && !r.weekdays.includes(wd)) return false
  // Имя сравниваем без учёта регистра: система может отдать «JBL GO 4» вместо «JBL Go 4»
  const out = output.toLowerCase()
  if (r.outputs?.length && !r.outputs.some((o) => out.startsWith(o.toLowerCase()))) return false
  return true
}

/** Какой контекст сейчас: запущенный вручную, иначе первый, чьи правила подходят к текущему моменту */
export function activeContext(list: ContextRow[], now: Date, output: string): ContextRow | null {
  return list.find((c) => c.running != null) ?? list.find((c) => matchesRules(c, now, output)) ?? null
}
