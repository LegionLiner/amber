import { dayKey, dayLabel } from './weeks'
import { MONTHS_SHORT, monthYear } from './format'

/**
 * График прослушиваний одного трека в карточке: вся история по месяцам — от месяца первого прослушивания
 * до текущего, и любой месяц по дням. Всё по местному календарю.
 */
export interface HistoryBar {
  /** Начало столбика, мс */
  start: number
  /** Сколько раз трек засчитан за этот месяц или день */
  n: number
  /** Подпись под столбиком: «окт» или число дня (пусто — без подписи, чтобы не теснились) */
  tick: string
  /** Вторая строка подписи: год — у первого месяца и у каждого января */
  sub: string
  /** Полная подпись: «Октябрь 2026», «12 октября» */
  tip: string
  /** День ещё не наступил (текущий месяц по дням) */
  future: boolean
}

/** Номер месяца от начала эпохи: удобно считать разницу между месяцами */
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth()

/** times — моменты засчитанных прослушиваний (мс), в любом порядке. Без прослушиваний — один текущий месяц */
export function monthBars(times: readonly number[], now = new Date()): HistoryBar[] {
  const last = monthIndex(now)
  let first = last
  for (const t of times) if (t <= now.getTime()) first = Math.min(first, monthIndex(new Date(t)))
  const bars: HistoryBar[] = []
  for (let m = first; m <= last; m++) {
    const d = new Date(Math.floor(m / 12), m % 12, 1)
    bars.push({
      start: d.getTime(),
      n: 0,
      tick: MONTHS_SHORT[d.getMonth()]!,
      sub: m === first || d.getMonth() === 0 ? String(d.getFullYear()) : '',
      tip: monthYear(d),
      future: false,
    })
  }
  for (const t of times) {
    if (t > now.getTime()) continue
    const i = monthIndex(new Date(t)) - first
    if (i >= 0 && i < bars.length) bars[i]!.n++
  }
  return bars
}

/** Один месяц по дням; monthStart — начало месяца (start столбика из monthBars) */
export function dayBars(times: readonly number[], monthStart: number, now = new Date()): HistoryBar[] {
  const m0 = new Date(monthStart)
  const y = m0.getFullYear()
  const m = m0.getMonth()
  const days = new Date(y, m + 1, 0).getDate()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const bars: HistoryBar[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(y, m, i + 1)
    const day = i + 1
    return {
      start: d.getTime(),
      n: 0,
      tick: day === 1 || day % 5 === 0 ? String(day) : '',
      sub: '',
      tip: dayLabel(dayKey(d)),
      future: d.getTime() > today,
    }
  })
  for (const t of times) {
    const d = new Date(t)
    if (d.getFullYear() === y && d.getMonth() === m && t <= now.getTime()) bars[d.getDate() - 1]!.n++
  }
  return bars
}
