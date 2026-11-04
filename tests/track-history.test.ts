import { describe, expect, it } from 'vitest'
import { dayBars, monthBars } from '@/domain/track-history'

// Воскресенье, 25 октября 2026, вечер
const now = new Date(2026, 9, 25, 20, 0)
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime()

describe('история трека по месяцам', () => {
  it('от месяца первого прослушивания до текущего, пустые месяцы тоже на месте', () => {
    const bars = monthBars([at(2026, 9, 1), at(2025, 10, 30), at(2026, 9, 20), at(2026, 0, 5)], now)
    expect(bars).toHaveLength(12) // ноябрь 2025 … октябрь 2026
    expect(bars[0]).toMatchObject({ tip: 'Ноябрь 2025', tick: 'ноя', sub: '2025', n: 1 })
    expect(bars.at(-1)).toMatchObject({ tip: 'Октябрь 2026', n: 2 })
    expect(bars.find((b) => b.tip === 'Январь 2026')).toMatchObject({ n: 1, sub: '2026' })
    expect(bars.find((b) => b.tip === 'Март 2026')).toMatchObject({ n: 0, sub: '' })
    expect(bars.reduce((s, b) => s + b.n, 0)).toBe(4)
  })

  it('без прослушиваний — один текущий месяц; будущее не считается', () => {
    expect(monthBars([], now)).toHaveLength(1)
    const bars = monthBars([at(2026, 10, 2)], now)
    expect(bars).toHaveLength(1)
    expect(bars[0]!.n).toBe(0)
  })

  it('несколько лет подряд', () => {
    const bars = monthBars([at(2023, 5, 1)], now)
    expect(bars).toHaveLength(12 * 3 + 5)
    expect(bars.filter((b) => b.sub).map((b) => b.sub)).toEqual(['2023', '2024', '2025', '2026'])
  })
})

describe('месяц по дням', () => {
  it('все дни месяца, подписи у 1-го и через пять дней', () => {
    const start = monthBars([at(2026, 9, 3)], now).at(-1)!.start
    const bars = dayBars([at(2026, 9, 3, 9), at(2026, 9, 3, 22), at(2026, 9, 25), at(2026, 8, 30)], start, now)
    expect(bars).toHaveLength(31)
    expect(bars[2]).toMatchObject({ n: 2, tip: '3 октября' })
    expect(bars[24]).toMatchObject({ n: 1, future: false })
    expect(bars[25]!.future).toBe(true)
    expect(bars.filter((b) => b.tick).map((b) => b.tick)).toEqual(['1', '5', '10', '15', '20', '25', '30'])
  })

  it('февраль високосного года', () => {
    expect(dayBars([], new Date(2024, 1, 1).getTime(), now)).toHaveLength(29)
  })
})
