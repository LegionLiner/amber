import { describe, expect, it } from 'vitest'
import { lrclibId, normTitle, rank, toSaved, type LrclibRecord } from '@/domain/lrclib'
import { parseLrc, plainText } from '@/domain/lyrics'

const rec = (id: number, o: Partial<LrclibRecord>): LrclibRecord => ({
  id,
  trackName: 'Crimewave',
  artistName: 'Crystal Castles',
  albumName: 'Crystal Castles',
  duration: 258,
  instrumental: false,
  plainLyrics: 'Eyes lit\nOn sharp threats',
  syncedLyrics: null,
  ...o,
})

const q = { title: 'Crimewave', artist: 'Crystal Castles', durationMs: 257_500 }

describe('LRCLIB', () => {
  it('названия сравниваются без пометок и регистра', () => {
    expect(normTitle('Crimewave (Remastered 2011)')).toBe('crimewave')
    expect(normTitle('Ёлка feat. Кто-то')).toBe('елка')
  })

  it('лучший вариант — синхронный и близкий по длительности; чужие и далёкие отброшены', () => {
    const list = [
      rec(1, {}),
      rec(2, { syncedLyrics: '[00:01.00]Eyes lit\n[00:03.00]On sharp threats' }),
      rec(3, { duration: 400, syncedLyrics: '[00:01.00]a\n[00:02.00]b' }),
      rec(4, { trackName: 'Совсем другая песня', artistName: 'Кто-то' }),
      rec(5, { plainLyrics: null, syncedLyrics: null }),
    ]
    expect(rank(list, q).map((r) => r.id)).toEqual([2, 1, 4])
  })

  it('сохранённый текст помнит, откуда он, и играет как обычный', () => {
    const saved = toSaved(rec(2, { syncedLyrics: '[00:01.00]Eyes lit\n[00:03.00]On sharp threats' }))!
    expect(lrclibId(saved)).toBe(2)
    expect(parseLrc(saved)?.map((l) => l.line)).toEqual(['Eyes lit', 'On sharp threats'])
    const plain = toSaved(rec(7, {}))!
    expect(lrclibId(plain)).toBe(7)
    expect(plainText(plain)).toBe('Eyes lit\nOn sharp threats')
    expect(lrclibId('[00:01.00]свой текст')).toBeNull()
    expect(lrclibId('[re:LRCLIB #0]')).toBe(0)
  })
})

describe('автоподстановка', () => {
  it('сама — только для того же трека', async () => {
    const { score, AUTO_MAX } = await import('@/domain/lrclib')
    expect(score(rec(1, {}), q)).toBeLessThanOrEqual(AUTO_MAX)
    expect(score(rec(4, { trackName: 'Совсем другая песня', artistName: 'Кто-то' }), q)).toBeGreaterThan(AUTO_MAX)
  })
})
