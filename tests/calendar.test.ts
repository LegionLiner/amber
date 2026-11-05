import { describe, expect, it } from 'vitest'
import { dayGrid, monthsGrid, sinceFor, yearsGrid, type ArtistDay } from '@/domain/calendar'

// Среда, 5 ноября 2026
const today = new Date(2026, 10, 5, 15)
const H = 3_600_000

describe('календарь по дням', () => {
  it('18 недель и год: столбец — неделя с понедельника, последняя неделя — текущая', () => {
    for (const weeks of [18, 53]) {
      const { grid } = dayGrid(new Map(), weeks, today)
      if (grid.kind !== 'days') throw new Error()
      expect(grid.cells).toHaveLength(weeks * 7)
      expect(new Date(grid.cells[0]!.key).getDay()).toBe(1) // понедельник
      const last = grid.cells.at(-1)!
      expect(last.key).toBe('2026-11-08') // воскресенье текущей недели
      expect(last.future).toBe(true)
      expect(grid.cells.find((c) => c.key === '2026-11-05')!.future).toBe(false)
    }
  })

  it('яркость по четвертям, тишина — ноль', () => {
    const days = new Map([
      ['2026-11-01', 1 * H],
      ['2026-11-02', 2 * H],
      ['2026-11-03', 3 * H],
      ['2026-11-04', 10 * H],
    ])
    const { grid } = dayGrid(days, 18, today)
    if (grid.kind !== 'days') throw new Error()
    const lv = (k: string) => grid.cells.find((c) => c.key === k)!.level
    expect(lv('2026-11-04')).toBe(4)
    expect(lv('2026-11-01')).toBe(1)
    expect(lv('2026-10-30')).toBe(0)
  })

  it('по исполнителям: тройка главных за отрезок, у каждого дня — свой главный', () => {
    const rows: ArtistDay[] = [
      { day: '2026-11-02', artist: 'Сплин', ms: 5 * H },
      { day: '2026-11-02', artist: 'Кино', ms: 1 * H },
      { day: '2026-11-03', artist: 'Кино feat. Сплин', ms: 2 * H },
      { day: '2026-11-04', artist: 'Земфира', ms: 3 * H },
      { day: '2026-11-01', artist: 'Ночные снайперы', ms: 0.5 * H },
      // До начала сетки — не в счёт
      { day: '2020-01-01', artist: 'Аквариум', ms: 99 * H },
    ]
    const days = new Map([
      ['2026-11-01', 0.5 * H],
      ['2026-11-02', 6 * H],
      ['2026-11-03', 2 * H],
      ['2026-11-04', 3 * H],
    ])
    const { grid, top } = dayGrid(days, 18, today, rows)
    if (grid.kind !== 'days') throw new Error()
    // Тройка — по времени в днях, где исполнитель главный: Сплин 6 ч, Земфира 3 ч, Кино 2 ч
    expect(top).toEqual(['Сплин', 'Земфира', 'Кино'])
    const cell = (k: string) => grid.cells.find((c) => c.key === k)!
    expect(cell('2026-11-02')).toMatchObject({ artist: 'Сплин', slot: 0 })
    expect(cell('2026-11-04')).toMatchObject({ artist: 'Земфира', slot: 1 })
    expect(cell('2026-11-01')).toMatchObject({ artist: 'Ночные снайперы', slot: -1 })
    expect(cell('2026-10-30')).toMatchObject({ artist: null, slot: null })
  })
})

describe('легенда', () => {
  it('гость из «feat.», ни разу не бывший главным, в тройку не попадает', () => {
    const rows: ArtistDay[] = [
      { day: '2026-11-02', artist: 'Kosmos Radio feat. Late Tram', ms: 9 * H },
      { day: '2026-11-03', artist: 'Kosmos Radio', ms: 1 * H },
      { day: '2026-11-04', artist: 'Кино', ms: 1 * H },
    ]
    const days = new Map(rows.map((r) => [r.day, r.ms]))
    const { top } = dayGrid(days, 18, today, rows)
    expect(top).toEqual(['Kosmos Radio', 'Кино'])
  })
})

describe('календарь по годам', () => {
  it('строка — год (свежие сверху), клетки делят год на недели без пропусков и повторов', () => {
    const days = new Map([
      ['2024-02-29', 2 * H],
      ['2025-12-31', 1 * H],
      ['2026-01-01', 3 * H],
    ])
    const { grid } = yearsGrid(days, today)
    if (grid.kind !== 'weeks') throw new Error()
    expect(grid.rows.map((r) => r.year)).toEqual([2026, 2025, 2024])
    for (const r of grid.rows) {
      expect(r.cells[0]!.from).toBe(`${r.year}-01-01`)
      expect(r.cells.at(-1)!.to).toBe(`${r.year}-12-31`)
      for (let i = 1; i < r.cells.length; i++) {
        const prevTo = new Date(r.cells[i - 1]!.to)
        const from = new Date(r.cells[i]!.from)
        expect((from.getTime() - prevTo.getTime()) / 86_400_000).toBeCloseTo(1, 1)
      }
    }
    const total = grid.rows.flatMap((r) => r.cells).reduce((s, c) => s + c.ms, 0)
    expect(total).toBe(6 * H)
    expect(grid.rows[0]!.cells[0]!.ms).toBe(3 * H)
  })

  it('с какого дня нужна история', () => {
    expect(sinceFor('years', today)).toBeNull()
    expect(sinceFor('18w', today)).toBe('2026-07-02')
    expect(sinceFor('year', today)).toBe('2025-12-01')
  })

  it('год — двенадцать месяцев календариками, до текущего', () => {
    const H = 3_600_000
    const days = new Map([
      ['2026-11-03', 2 * H],
      ['2025-12-01', H],
      ['2025-11-30', 5 * H], // раньше года — не показывается
    ])
    const { grid } = monthsGrid(days, today)
    if (grid.kind !== 'months') throw new Error('kind')
    expect(grid.months).toHaveLength(12)
    expect(grid.months[0]!.key).toBe('2025-11')
    expect(grid.months[0]!.year).toBe(2025)
    expect(grid.months[1]!.year).toBe(2026)
    expect(grid.months[11]!.cells).toHaveLength(30)
    // 1 декабря 2025 — понедельник, 1 ноября 2026 — воскресенье
    expect(grid.months[0]!.lead).toBe(0)
    expect(grid.months[11]!.lead).toBe(6)
    const cells = grid.months.flatMap((m) => m.cells)
    expect(cells.find((c) => c.key === '2026-11-03')!.level).toBeGreaterThan(0)
    expect(cells.find((c) => c.key === '2026-11-06')!.future).toBe(true)
    expect(cells.reduce((s, c) => s + c.ms, 0)).toBe(3 * H)
  })
})
