/**
 * Недели по ISO 8601: понедельник — первый день, неделя принадлежит году, в который попадает её четверг.
 * Ключ недели — '2026-W39'. Всё по местным датам, как local_day в play_events.
 */

const pad = (n: number) => String(n).padStart(2, '0')

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

/** Понедельник недели, в которую попадает дата */
export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

export function weekKey(d: Date): string {
  const thursday = mondayOf(d)
  thursday.setDate(thursday.getDate() + 3)
  const year = thursday.getFullYear()
  const jan4 = new Date(year, 0, 4)
  const week1 = mondayOf(jan4)
  const n = Math.round((mondayOf(d).getTime() - week1.getTime()) / (7 * 86_400_000)) + 1
  return `${year}-W${pad(n)}`
}

/** Первый и последний день недели по ключу */
export function weekRange(key: string): { from: string; to: string; monday: Date } {
  const [y, w] = key.split('-W').map(Number)
  const monday = mondayOf(new Date(y!, 0, 4))
  monday.setDate(monday.getDate() + (w! - 1) * 7)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  return { from: dayKey(monday), to: dayKey(sunday), monday }
}

export function prevWeek(key: string): string {
  const { monday } = weekRange(key)
  monday.setDate(monday.getDate() - 7)
  return weekKey(monday)
}

export function nextWeek(key: string): string {
  const { monday } = weekRange(key)
  monday.setDate(monday.getDate() + 7)
  return weekKey(monday)
}

const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

/** «15–21 сентября» или «29 сентября – 5 октября» */
export function weekLabel(key: string): string {
  const { from, to } = weekRange(key)
  const a = parseDay(from)
  const b = parseDay(to)
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`
  return `${a.getDate()} ${MONTHS_GEN[a.getMonth()]} – ${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`
}

export function dayLabel(day: string, withYear = false): string {
  const d = parseDay(day)
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`
}
