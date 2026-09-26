/** Календарные сезоны: зима — декабрь…февраль и носит двойной год («Зима 2025/26») */

export interface Season {
  id: string
  title: string
  startDay: string
  endDay: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function lastDayOfFeb(year: number): string {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return `${year}-02-${leap ? 29 : 28}`
}

export function seasonOf(d: Date): Season {
  const m = d.getMonth()
  const y = d.getFullYear()
  if (m === 11 || m <= 1) {
    const sy = m === 11 ? y : y - 1
    return {
      id: `${sy}-winter`,
      title: `Зима ${sy}/${pad((sy + 1) % 100)}`,
      startDay: `${sy}-12-01`,
      endDay: lastDayOfFeb(sy + 1),
    }
  }
  if (m <= 4) return { id: `${y}-spring`, title: `Весна ${y}`, startDay: `${y}-03-01`, endDay: `${y}-05-31` }
  if (m <= 7) return { id: `${y}-summer`, title: `Лето ${y}`, startDay: `${y}-06-01`, endDay: `${y}-08-31` }
  return { id: `${y}-autumn`, title: `Осень ${y}`, startDay: `${y}-09-01`, endDay: `${y}-11-30` }
}

/** Все сезоны, которые задевает промежуток дат, от старых к новым */
export function seasonsBetween(from: Date, to: Date): Season[] {
  const out: Season[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), 1)
  let last = ''
  while (d <= to) {
    const s = seasonOf(d)
    if (s.id !== last) {
      out.push(s)
      last = s.id
    }
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

export function dayToTs(day: string, endOfDay = false): number {
  const [y, m, dd] = day.split('-').map(Number)
  return endOfDay ? new Date(y!, m! - 1, dd!, 23, 59, 59, 999).getTime() : new Date(y!, m! - 1, dd!).getTime()
}

/** Сезон по id вида '2026-summer' или '2025-winter' */
export function seasonById(id: string): Season | null {
  const m = /^(\d{4})-(winter|spring|summer|autumn)$/.exec(id)
  if (!m) return null
  const y = Number(m[1])
  const month = { winter: 11, spring: 3, summer: 6, autumn: 9 }[m[2] as 'winter']
  return seasonOf(new Date(y, month, 1))
}
