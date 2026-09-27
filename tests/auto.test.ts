import { describe, expect, it } from 'vitest'
import { buildAuto, byDayPart, forgotten, onRepeat, partOfDay, type AutoContext } from '@/domain/auto'
import type { Track } from '@/domain/track'

const DAY = 86_400_000
const now = Date.UTC(2026, 8, 26, 12)

function t(key: string, extra: Partial<Track> = {}): Track {
  return {
    key,
    title: key,
    artist: '',
    artists: [],
    album: '',
    albumArtist: '',
    genre: '',
    fileName: key,
    folder: '',
    note: null,
    uri: '',
    path: '',
    size: 0,
    year: null,
    trackNo: null,
    discNo: null,
    durationMs: 180_000,
    bitrate: null,
    sampleRate: null,
    mime: null,
    art: null,
    hasCustomArt: false,
    color1: null,
    color2: null,
    hasLyrics: false,
    addedAt: 0,
    tags: { title: key, artist: null, album: null, genre: null },
    overrides: {},
    rating: null,
    favoriteAt: null,
    rankScore: null,
    noShuffle: false,
    gainOffsetDb: 0,
    trimStartMs: null,
    trimEndMs: null,
    plays: 0,
    skips: 0,
    listenedMs: 0,
    firstPlayedAt: null,
    lastPlayedAt: null,
    lastStartedAt: null,
    duels: 0,
    lufs: null,
    bpm: null,
    energy: null,
    analyzed: false,
    ...extra,
  }
}

describe('partOfDay', () => {
  it('границы суток', () => {
    expect(partOfDay(4)).toBe('night')
    expect(partOfDay(5)).toBe('morning')
    expect(partOfDay(16)).toBe('day')
    expect(partOfDay(22)).toBe('evening')
    expect(partOfDay(23)).toBe('night')
  })
})

describe('byDayPart', () => {
  it('ночной трек попадает в «Ночь», дневной нет', () => {
    const hours = new Map<string, number[]>()
    const night = Array(24).fill(0)
    night[1] = 5
    night[23] = 2
    const day = Array(24).fill(0)
    day[13] = 9
    hours.set('n', night)
    hours.set('d', day)
    const res = byDayPart([t('n'), t('d')], hours, 'night')
    expect(res.map((x) => x.key)).toEqual(['n'])
  })
})

describe('onRepeat', () => {
  it('всплеск за 14 дней при низкой норме', () => {
    const hot = t('hot', { plays: 10, firstPlayedAt: now - 200 * DAY })
    const steady = t('steady', { plays: 200, firstPlayedAt: now - 200 * DAY })
    const recent = new Map([
      ['hot', 8],
      ['steady', 8],
    ])
    expect(onRepeat([hot, steady], recent, now).map((x) => x.key)).toEqual(['hot'])
  })
})

describe('forgotten', () => {
  it('любимое, но давно', () => {
    const old = t('old', { rating: 9, plays: 12, lastPlayedAt: now - 90 * DAY })
    const fresh = t('fresh', { rating: 10, plays: 30, lastPlayedAt: now - 3 * DAY })
    expect(forgotten([old, fresh], now).map((x) => x.key)).toEqual(['old'])
  })
})

describe('buildAuto', () => {
  const ctx: AutoContext = { now, hours: new Map(), recent14: new Map(), yearAgo: new Set(['b']) }
  it('вечный чарт по прослушиваниям', () => {
    const res = buildAuto('eternal', [t('a', { plays: 2 }), t('b', { plays: 9 }), t('c')], ctx)
    expect(res.map((x) => x.key)).toEqual(['b', 'a'])
  })
  it('год назад', () => {
    expect(buildAuto('yearAgo', [t('a'), t('b')], ctx).map((x) => x.key)).toEqual(['b'])
  })
})
