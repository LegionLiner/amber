import { splitArtists } from './names'
import { MONTHS_SHORT } from './format'

/**
 * Календарь «Каждый день» в хронике.
 *  - масштаб: 18 недель по дням (столбец — неделя, строка — день недели); год — двенадцать месяцев
 *    календариками (клетки крупнее, чем у 53 узких столбцов, даже на телефоне); все годы по неделям
 *    (строка — год, клетка — неделя);
 *  - цвет: по времени (чем больше слушал, тем ярче) или по исполнителю — три главных исполнителя показанного
 *    отрезка своими цветами, остальные дни нейтральные. Больше трёх цветов в соседних клетках на глаз
 *    не различить (проверено валидатором палитр), имя всегда видно в легенде и в подписи выбранной клетки.
 * Всё по местным датам, как local_day в истории.
 */

export type CalScale = '18w' | 'year' | 'years'
export type CalColor = 'time' | 'artists'

export interface CalCell {
  key: string
  /** Первый и последний день клетки (у дня — один и тот же) */
  from: string
  to: string
  ms: number
  /** Яркость по времени, 0 — тишина */
  level: 0 | 1 | 2 | 3 | 4
  future: boolean
  /** Главный исполнитель клетки и его место в тройке: 0..2; -1 — кто-то другой; null — тишина */
  artist: string | null
  slot: number | null
}

export interface CalAxis {
  col: number
  label: string
}

export type CalGrid =
  | { kind: 'days'; weeks: number; cells: CalCell[]; months: CalAxis[] }
  | { kind: 'weeks'; cols: number; rows: { year: number; cells: CalCell[] }[]; months: CalAxis[] }
  | { kind: 'months'; months: CalMonth[] }

/** Месяц календариком: lead — пустые клетки до 1-го числа (неделя с понедельника) */
export interface CalMonth {
  key: string
  label: string
  /** Год подписан у января и у самого первого месяца */
  year: number | null
  lead: number
  cells: CalCell[]
}

const DAY = 86_400_000

export const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))

/** Уровни яркости по четвертям: тихие дни не тонут рядом с рекордными */
function leveler(values: number[]): (ms: number) => CalCell['level'] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b)
  const q = (f: number) => v[Math.floor(f * (v.length - 1))] ?? 0
  const [t1, t2, t3] = [q(0.25), q(0.5), q(0.8)]
  return (ms) => (ms <= 0 ? 0 : ms <= t1 ? 1 : ms <= t2 ? 2 : ms <= t3 ? 3 : 4)
}

/** Кто сколько звучал в каждой клетке; дневные строки (день, исполнитель как в тегах, мс) → клетки */
export type ArtistDay = { day: string; artist: string | null; ms: number }

function artistTotals(rows: readonly ArtistDay[], cellOf: (day: string) => string | null) {
  const per = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const cell = cellOf(r.day)
    if (!cell) continue
    // «А feat. Б» — время достаётся обоим: гость тоже звучал
    for (const a of splitArtists(r.artist)) {
      let m = per.get(cell)
      if (!m) per.set(cell, (m = new Map()))
      m.set(a, (m.get(a) ?? 0) + r.ms)
    }
  }
  return per
}

/**
 * Сначала у каждой клетки — её главный исполнитель. Тройка цветов — те, кто чаще всех был главным
 * (по времени в «своих» клетках): так каждый цвет легенды действительно есть на календаре. Гость из
 * «А feat. Б», который ни разу не перевесил, место в тройке не занимает
 */
function paint(cells: CalCell[], rows: readonly ArtistDay[] | null, cellOf: (day: string) => string | null): string[] {
  if (!rows) return []
  const per = artistTotals(rows, cellOf)
  const won = new Map<string, number>()
  for (const c of cells) {
    const m = per.get(c.key)
    if (!m || !c.ms) continue
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    c.artist = best
    if (best) won.set(best, (won.get(best) ?? 0) + c.ms)
  }
  const top = [...won.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([a]) => a)
  for (const c of cells) if (c.ms && c.artist !== null) c.slot = top.indexOf(c.artist)
  for (const c of cells) if (c.ms && c.artist === null && per.has(c.key)) c.slot = -1
  return top
}

/**
 * Сетка по дням: последние `weeks` недель до сегодняшней включительно, столбец — неделя с понедельника.
 * artists — дневные строки по исполнителям (только для раскраски по исполнителям)
 */
export function dayGrid(
  days: ReadonlyMap<string, number>,
  weeks: number,
  today = new Date(),
  artists: readonly ArtistDay[] | null = null,
): { grid: CalGrid; top: string[] } {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dow = (t.getDay() + 6) % 7
  const start = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((weeks - 1) * 7 + dow))
  const level = leveler([...days.values()])
  const cells: CalCell[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const key = dayKeyOf(d)
    const ms = days.get(key) ?? 0
    cells.push({ key, from: key, to: key, ms, level: level(ms), future: d > t, artist: null, slot: null })
  }
  const inGrid = new Set(cells.map((c) => c.key))
  const top = paint(cells, artists, (day) => (inGrid.has(day) ? day : null))
  // Подписи месяцев над первой неделей месяца, если не слипаются с прошлой (на годе — каждый месяц)
  const months: CalAxis[] = []
  let last = -1
  for (let col = 0; col < weeks; col++) {
    const m = parse(cells[col * 7]!.key).getMonth()
    if (m === last) continue
    last = m
    const prev = months[months.length - 1]
    if (!prev || col - prev.col >= (weeks > 30 ? 4 : 3)) months.push({ col, label: MONTHS_SHORT[m]! })
  }
  return { grid: { kind: 'days', weeks, cells, months }, top }
}

/** Год по дням: текущий месяц и одиннадцать до него, каждый — календариком */
export function monthsGrid(
  days: ReadonlyMap<string, number>,
  today = new Date(),
  artists: readonly ArtistDay[] | null = null,
): { grid: CalGrid; top: string[] } {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const months: CalMonth[] = []
  const cellsAll: CalCell[] = []
  for (let i = 11; i >= 0; i--) {
    const first = new Date(t.getFullYear(), t.getMonth() - i, 1)
    const y = first.getFullYear()
    const m = first.getMonth()
    const n = new Date(y, m + 1, 0).getDate()
    const cells: CalCell[] = []
    for (let d = 1; d <= n; d++) {
      const date = new Date(y, m, d)
      const key = dayKeyOf(date)
      const ms = days.get(key) ?? 0
      cells.push({ key, from: key, to: key, ms, level: 0, future: date > t, artist: null, slot: null })
    }
    months.push({
      key: `${y}-${m}`,
      label: MONTHS_SHORT[m]!,
      year: m === 0 || i === 11 ? y : null,
      lead: (first.getDay() + 6) % 7,
      cells,
    })
    cellsAll.push(...cells)
  }
  // Яркость — по дням этого года, а не по всей загруженной истории
  const level = leveler(cellsAll.map((c) => c.ms))
  for (const c of cellsAll) c.level = level(c.ms)
  const inGrid = new Set(cellsAll.map((c) => c.key))
  const top = paint(cellsAll, artists, (day) => (inGrid.has(day) ? day : null))
  return { grid: { kind: 'months', months }, top }
}

/** Неделя года для клетки: от 0, понедельник — первый день; у 1 января неделя 0 */
function weekOfYear(d: Date): number {
  const jan1 = new Date(d.getFullYear(), 0, 1)
  const offset = (jan1.getDay() + 6) % 7
  const doy = Math.round((d.getTime() - jan1.getTime()) / DAY)
  return Math.floor((doy + offset) / 7)
}

/** Все годы истории: строка — год (свежие сверху), клетка — неделя года */
export function yearsGrid(
  days: ReadonlyMap<string, number>,
  today = new Date(),
  artists: readonly ArtistDay[] | null = null,
): { grid: CalGrid; top: string[] } {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const keys = [...days.keys()].filter((k) => (days.get(k) ?? 0) > 0).sort()
  const firstYear = keys.length ? Number(keys[0]!.slice(0, 4)) : t.getFullYear()
  const COLS = 54
  const sums = new Map<string, number>()
  for (const [k, ms] of days) {
    const key = `${k.slice(0, 4)}-w${weekOfYear(parse(k))}`
    sums.set(key, (sums.get(key) ?? 0) + ms)
  }
  const level = leveler([...sums.values()])
  const rows: { year: number; cells: CalCell[] }[] = []
  const cellsAll: CalCell[] = []
  for (let y = t.getFullYear(); y >= firstYear; y--) {
    const jan1 = new Date(y, 0, 1)
    const offset = (jan1.getDay() + 6) % 7
    const cells: CalCell[] = []
    for (let w = 0; w < COLS; w++) {
      // Неделя w — дни года с номерами от w*7-offset до w*7-offset+6, в пределах года
      const fromDoy = Math.max(0, w * 7 - offset)
      const from = new Date(y, 0, 1 + fromDoy)
      if (from.getFullYear() !== y) break
      const to = new Date(y, 0, 1 + Math.min(w * 7 - offset + 6, fromDoy + 6))
      const last = to.getFullYear() === y ? to : new Date(y, 11, 31)
      const key = `${y}-w${w}`
      const ms = sums.get(key) ?? 0
      cells.push({
        key,
        from: dayKeyOf(from),
        to: dayKeyOf(last),
        ms,
        level: level(ms),
        future: from > t,
        artist: null,
        slot: null,
      })
    }
    rows.push({ year: y, cells })
    cellsAll.push(...cells)
  }
  const top = paint(cellsAll, artists, (day) => `${day.slice(0, 4)}-w${weekOfYear(parse(day))}`)
  // Месяцы над столбцами — по неделе, в которую попадает 1-е число (в среднем по годам одинаково)
  const ref = new Date(t.getFullYear(), 0, 1)
  const months: CalAxis[] = MONTHS_SHORT.map((label, m) => ({
    col: weekOfYear(new Date(ref.getFullYear(), m, 1)),
    label,
  })).filter((_, m) => m % 2 === 0)
  return { grid: { kind: 'weeks', cols: COLS, rows, months }, top }
}

/** С какого дня нужна история для масштаба (null — вся) */
export function sinceFor(scale: CalScale, today = new Date()): string | null {
  if (scale === 'years') return null
  if (scale === 'year') return dayKeyOf(new Date(today.getFullYear(), today.getMonth() - 11, 1))
  return dayKeyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 18 * 7))
}
