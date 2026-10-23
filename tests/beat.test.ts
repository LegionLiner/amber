import { describe, expect, it } from 'vitest'
import { BeatFollower } from '@/app/beat'

const quiet = { bass: 0.2, mid: 0.2, high: 0.1, level: 0.2 }
const kick = { bass: 0.6, mid: 0.2, high: 0.1, level: 0.3 }

/** Кадры по 16 мс: n кадров с уровнями l */
function feed(b: BeatFollower, l: typeof quiet | null, n: number) {
  let last = b.update(16, l)
  for (let i = 1; i < n; i++) last = b.update(16, l)
  return last
}

describe('удары баса', () => {
  it('ровный гул не держит вспышку', () => {
    const b = new BeatFollower()
    expect(feed(b, quiet, 120).hit).toBeLessThan(0.05)
  })

  it('удар — сразу вверх, потом спад примерно за 0,2 с', () => {
    const b = new BeatFollower()
    feed(b, quiet, 120)
    expect(b.update(16, kick).hit).toBe(1)
    const after = feed(b, quiet, 25) // 0,4 с
    expect(after.hit).toBeLessThan(0.2)
  })

  it('без звука всё гаснет', () => {
    const b = new BeatFollower()
    feed(b, kick, 60)
    const s = feed(b, null, 200)
    expect(s.hit).toBeLessThan(0.01)
    expect(s.loud).toBeLessThan(0.05)
  })

  it('громкость, середина и верха — от 0 до 1 относительно недавнего максимума', () => {
    const b = new BeatFollower()
    const s = feed(b, { bass: 0.3, mid: 0.9, high: 0.8, level: 0.9 }, 200)
    for (const v of [s.loud, s.mid, s.high]) {
      expect(v).toBeGreaterThan(0.9)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
