import { describe, expect, it } from 'vitest'
import { BeatFollower } from '@/app/beat'
import type { AudioLevels } from '@/native/web/audio-graph'

/** Уровни: bass и level — шкала анализатора, low/mid/high — линейная громкость полос */
const lv = (bass: number, low: number, mid: number, high: number, level = 0.3): AudioLevels => ({ bass, level, low, mid, high })
const quiet = lv(0.2, 0.05, 0.1, 0.05, 0.2)
const kick = lv(0.6, 0.5, 0.1, 0.05, 0.3)

/** Кадры по 16 мс: n кадров с уровнями l */
function feed(b: BeatFollower, l: AudioLevels | null, n: number) {
  let last = b.update(16, l)
  for (let i = 1; i < n; i++) last = b.update(16, l)
  return last
}

describe('удары баса', () => {
  it('ровный гул не держит вспышку', () => {
    const b = new BeatFollower()
    const s = feed(b, quiet, 120)
    expect(s.hit).toBeLessThan(0.05)
    expect(s.kick).toBeLessThan(0.05)
  })

  it('удар — сразу вверх, потом спад примерно за 0,2 с', () => {
    const b = new BeatFollower()
    feed(b, quiet, 120)
    const s = b.update(16, kick)
    expect(s.hit).toBe(1)
    expect(s.kick).toBe(1)
    const after = feed(b, quiet, 25) // 0,4 с
    expect(after.hit).toBeLessThan(0.2)
    expect(after.kick).toBeLessThan(0.2)
  })

  it('отголосок голоса в басах (децибелы растут, линейный низ — нет) не считается бочкой', () => {
    const b = new BeatFollower()
    feed(b, lv(0.2, 0.01, 0.4, 0.05), 120)
    const s = b.update(16, lv(0.35, 0.015, 0.6, 0.05))
    expect(s.kick).toBeLessThan(0.2)
  })

  it('без звука всё гаснет', () => {
    const b = new BeatFollower()
    feed(b, kick, 60)
    const s = feed(b, null, 200)
    expect(s.hit).toBeLessThan(0.01)
    expect(s.kick).toBeLessThan(0.01)
    expect(s.loud).toBeLessThan(0.05)
  })
})

describe('полосы', () => {
  it('ровный звук держит полосы на спокойном уровне', () => {
    const b = new BeatFollower()
    const s = feed(b, lv(0.3, 0.3, 0.5, 0.4, 0.5), 600)
    expect(s.loud).toBeGreaterThan(0.9)
    for (const v of [s.low, s.mid, s.high]) {
      expect(v).toBeGreaterThan(0.2)
      expect(v).toBeLessThan(0.5)
    }
  })

  it('каждая полоса дышит своим звуком: вступил голос — поднимается середина, а не низ и не верха', () => {
    const b = new BeatFollower()
    feed(b, lv(0.4, 0.4, 0.15, 0.2), 600)
    const s = feed(b, lv(0.4, 0.4, 0.6, 0.2, 0.4), 40)
    expect(s.mid).toBeGreaterThan(0.8)
    expect(s.low).toBeLessThan(0.5)
    expect(s.high).toBeLessThan(0.5)
  })

  it('стихло — полоса опускается плавно, а не мигает', () => {
    const b = new BeatFollower()
    const calm = lv(0.4, 0.4, 0.15, 0.2)
    feed(b, calm, 600)
    const up = feed(b, lv(0.4, 0.4, 0.6, 0.2, 0.4), 40).mid
    const soon = feed(b, calm, 6).mid
    expect(soon).toBeGreaterThan(up * 0.7)
    expect(feed(b, calm, 150).mid).toBeLessThan(0.5)
  })
})
