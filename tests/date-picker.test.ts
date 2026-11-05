import { describe, expect, it } from 'vitest'
import { clampDay, monthDays, monthOutside, shiftDay, shiftMonth } from '@/domain/date-picker'

describe('календарь выбора даты', () => {
  it('месяц — ровно шесть недель с понедельника', () => {
    // Ноябрь 2026 начинается в воскресенье: шесть дней октября впереди
    const d = monthDays(2026, 10)
    expect(d).toHaveLength(42)
    expect(d[0]!.key).toBe('2026-10-26')
    expect(d[0]!.outside).toBe(true)
    expect(d[6]!.key).toBe('2026-11-01')
    expect(d[6]!.outside).toBe(false)
    expect(d.filter((x) => !x.outside)).toHaveLength(30)
  })

  it('границы min/max', () => {
    const d = monthDays(2026, 10, '2026-11-03', '2026-11-10')
    expect(d.find((x) => x.key === '2026-11-02')!.disabled).toBe(true)
    expect(d.find((x) => x.key === '2026-11-03')!.disabled).toBe(false)
    expect(d.find((x) => x.key === '2026-11-11')!.disabled).toBe(true)
    expect(clampDay('2026-12-01', undefined, '2026-11-05')).toBe('2026-11-05')
    expect(monthOutside(2026, 11, undefined, '2026-11-05')).toBe(true)
    expect(monthOutside(2026, 10, undefined, '2026-11-05')).toBe(false)
  })

  it('сдвиги по дням и месяцам', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-11-05', 7, undefined, '2026-11-08')).toBe('2026-11-08')
    // 31 января + месяц — последний день февраля, а не 3 марта
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftMonth('2026-03-15', -12)).toBe('2025-03-15')
  })
})
