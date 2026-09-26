import { describe, expect, it } from 'vitest'
import { mulberry32, shuffle, smartWeight, spread, weightedShuffle } from '@/domain/shuffle'

describe('shuffle', () => {
  it('сохраняет все элементы', () => {
    const a = Array.from({ length: 50 }, (_, i) => i)
    const s = shuffle(a, mulberry32(1))
    expect(s).toHaveLength(50)
    expect([...s].sort((x, y) => x - y)).toEqual(a)
    expect(s).not.toEqual(a)
  })
})

describe('weightedShuffle', () => {
  it('тяжёлые элементы в среднем раньше', () => {
    const rnd = mulberry32(7)
    let heavyFirst = 0
    for (let i = 0; i < 2000; i++) {
      const r = weightedShuffle(['heavy', 'light'], (t) => (t === 'heavy' ? 3 : 1), rnd)
      if (r[0] === 'heavy') heavyFirst++
    }
    // вероятность 3 / (3 + 1) = 0.75
    expect(heavyFirst / 2000).toBeGreaterThan(0.7)
    expect(heavyFirst / 2000).toBeLessThan(0.8)
  })
})

describe('spread', () => {
  it('не ставит одного исполнителя подряд, если есть из кого выбрать', () => {
    const items = [
      { a: 'A', al: '1' },
      { a: 'A', al: '1' },
      { a: 'A', al: '2' },
      { a: 'B', al: '3' },
      { a: 'C', al: '4' },
      { a: 'D', al: '5' },
      { a: 'E', al: '6' },
    ]
    const out = spread(
      items,
      (t) => t.a,
      (t) => t.al,
    )
    for (let i = 1; i < out.length; i++) expect(out[i]!.a === 'A' && out[i - 1]!.a === 'A').toBe(false)
    expect(out).toHaveLength(items.length)
  })
})

describe('smartWeight', () => {
  const now = Date.UTC(2026, 8, 26)
  it('5★ весит больше 3★', () => {
    const base = { plays: 10, skips: 0, lastStartedAt: now - 7 * 86_400_000 }
    expect(smartWeight({ ...base, rating: 10 }, now)).toBeGreaterThan(smartWeight({ ...base, rating: 6 }, now) * 2)
  })
  it('только что игравший трек почти не выпадает', () => {
    const t = { rating: 10, plays: 10, skips: 0 }
    expect(smartWeight({ ...t, lastStartedAt: now - 60_000 }, now)).toBeLessThan(
      smartWeight({ ...t, lastStartedAt: now - 5 * 86_400_000 }, now) * 0.1,
    )
  })
})
