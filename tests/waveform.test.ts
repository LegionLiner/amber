import { describe, expect, it } from 'vitest'
import { waveFromMeanSquares } from '../src/domain/waveform'

/** Средний квадрат синуса с амплитудой a — a²/2 */
const ms = (a: number) => (a * a) / 2

describe('волна трека', () => {
  it('громко сведённый трек — не ровная полоса: тише место видно', () => {
    // 100 с: почти всё на пределе (−1…−3 дБ), с 40-й по 50-ю секунду проигрыш на 6 дБ тише
    const env: number[] = []
    for (let i = 0; i < 10_000; i++) {
      const breakdown = i >= 4000 && i < 5000
      env.push(ms((breakdown ? 0.45 : 0.85) + 0.1 * Math.sin(i / 7)))
    }
    const w = waveFromMeanSquares(env)
    const avg = (from: number, to: number) => w.slice(from, to).reduce((s, x) => s + x, 0) / (to - from)
    expect(avg(420, 480)).toBeLessThan(avg(100, 300) * 0.6)
    expect(Math.max(...w)).toBeGreaterThan(240)
  })

  it('тишина — почти пустые столбики, пустой трек — нули', () => {
    const env = [...Array(2000).fill(0), ...Array(8000).fill(ms(0.5))]
    const w = waveFromMeanSquares(env)
    expect(w[50]!).toBeLessThan(10)
    expect(w[900]!).toBeGreaterThan(200)
    expect([...waveFromMeanSquares([])].every((x) => x === 0)).toBe(true)
  })
})
