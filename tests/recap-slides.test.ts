import { describe, expect, it } from 'vitest'
import { buildSlides } from '@/features/chronicle/story'
import type { Recap } from '@/data/repos/recap'
import type { Track } from '@/domain/track'

/** Минимальный трек для слайдов: название, исполнитель, обложка */
const track = (key: string, artist: string): Track =>
  ({ key, title: `Трек ${key}`, artist, artists: [artist], art: null }) as unknown as Track

const keys = Array.from({ length: 14 }, (_, i) => `k${i}`)
const byKey = new Map(keys.map((k, i) => [k, track(k, i < 7 ? 'Альфа' : 'Бета')]))

function recap(over: Partial<Recap> = {}): Recap {
  return {
    plays: 100,
    listenedMs: 3_600_000,
    tracks: 14,
    days: 5,
    // По числу раз впереди k0 (короткий трек на повторе)
    top: keys.map((k, i) => ({ key: k, plays: 30 - i, listenedMs: 60_000 * (i + 1) })),
    signature: [],
    discoveries: [],
    from: '2026-01-01',
    to: '2026-12-31',
    peakHour: 21,
    busiestDay: null,
    newFavorites: 0,
    activeDays: ['2026-03-01'],
    hours: Array(24).fill(0) as number[],
    // По минутам впереди k13
    topByTime: [...keys].reverse().map((k, i) => ({ key: k, plays: 10, listenedMs: 3_000_000 - i * 100_000 })),
    // Бета — в хвосте списка «чаще всего», но всего у неё больше
    artistRows: [
      ...keys.slice(0, 7).map((k) => ({ key: k, plays: 3, artist: 'Альфа' })),
      ...keys.slice(7).map((k) => ({ key: k, plays: 5, artist: 'Бета' })),
      { key: 'spotify:track:x', plays: 40, artist: 'Гамма feat. Альфа' },
    ],
    ...over,
  }
}

describe('итоги', () => {
  const slides = buildSlides(recap(), '2026 год', byKey)
  const find = (kicker: string) => slides.find((s) => s.kicker === kicker)

  it('трек периода — по минутам, а не по числу прослушиваний', () => {
    const s = find('Трек периода')!
    expect(s.big).toBe('Трек k13')
    expect(s.lines[0]).toMatch(/^50 мин · 10 раз$/)
  })

  it('топы — по десять', () => {
    expect(find('Топ-10')!.list).toHaveLength(10)
    expect(find('Топ-10')!.list![0]!.title).toBe('Трек k0')
    const byTime = find('Топ-10 по минутам')!
    expect(byTime.big).toBe('Больше всего')
    expect(byTime.list).toHaveLength(10)
    expect(byTime.list!.map((x) => x.right).slice(0, 2)).toEqual(['50 мин', '48 мин'])
  })

  it('исполнители — по всем трекам периода, включая треки не из медиатеки', () => {
    const s = find('Исполнители')!
    expect(s.list!.map((x) => [x.title, x.right])).toEqual([
      ['Альфа', '61×'],
      ['Гамма', '40×'],
      ['Бета', '35×'],
    ])
  })

  it('без данных по минутам трек периода берётся из «чаще всего»', () => {
    const s = buildSlides(recap({ topByTime: [] }), 'Май', byKey)
    expect(s.find((x) => x.kicker === 'Трек периода')!.big).toBe('Трек k0')
    expect(s.some((x) => x.kicker === 'Топ-10 по минутам')).toBe(false)
  })
})
