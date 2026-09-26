import { describe, expect, it } from 'vitest'
import { dayKey, mondayOf, nextWeek, prevWeek, weekKey, weekLabel, weekRange } from '@/domain/weeks'
import { applyDuel, expected, kFactor, pickPair, refinementsForOrder } from '@/domain/duels'
import { bucketBase, ratingSuggestions } from '@/domain/rating'
import { normalizeNeighbors, pickRadio, similarity, type RadioTrack } from '@/domain/radio'
import { orderFor } from '@/domain/shuffle'
import { writeId3 } from '@/native/web/id3-writer'
import { parseV2, tagSize } from '@/native/web/id3'
import { analyzeChannels } from '@/native/web/analysis'

describe('ISO-недели', () => {
  it('ключи на границах годов', () => {
    expect(weekKey(new Date(2026, 0, 1))).toBe('2026-W01') // четверг
    expect(weekKey(new Date(2027, 0, 1))).toBe('2026-W53') // пятница, неделя ещё 2026 года
    expect(weekKey(new Date(2024, 11, 30))).toBe('2025-W01')
    expect(weekKey(new Date(2026, 8, 26))).toBe('2026-W39')
  })
  it('диапазон и соседи', () => {
    expect(weekRange('2026-W39')).toMatchObject({ from: '2026-09-21', to: '2026-09-27' })
    expect(nextWeek('2026-W53')).toBe('2027-W01')
    expect(prevWeek('2026-W01')).toBe('2025-W52')
    expect(dayKey(mondayOf(new Date(2026, 8, 27)))).toBe('2026-09-21')
    expect(weekLabel('2026-W39')).toBe('21–27 сентября')
  })
})

describe('дуэли', () => {
  it('Эло: победа слабого двигает сильнее', () => {
    expect(expected(0, 0)).toBeCloseTo(0.5)
    expect(kFactor(0)).toBe(32)
    expect(kFactor(30)).toBe(12)
    const a = { key: 'a', rating: 8, rankScore: bucketBase(8) - 200, duels: 0 }
    const b = { key: 'b', rating: 8, rankScore: bucketBase(8) + 200, duels: 0 }
    const r = applyDuel(a, b, 1)
    expect(r.a - a.rankScore).toBeGreaterThan(16)
    expect(r.b).toBeLessThan(b.rankScore)
    // Сумма уточнений сохраняется при равных K
    expect(r.a + r.b).toBeCloseTo(a.rankScore + b.rankScore)
  })
  it('уточнение не выходит за свою группу звёзд', () => {
    const a = { key: 'a', rating: 6, rankScore: bucketBase(6) + 399, duels: 0 }
    const b = { key: 'b', rating: 6, rankScore: bucketBase(6) - 400, duels: 0 }
    const r = applyDuel(a, b, 1)
    expect(r.a).toBeLessThanOrEqual(bucketBase(6) + 400)
  })
  it('пара всегда из одной группы, кроме пограничных', () => {
    const tracks = Array.from({ length: 12 }, (_, i) => ({
      key: `k${i}`,
      rating: i < 6 ? 8 : 6,
      rankScore: (i < 6 ? bucketBase(8) : bucketBase(6)) + i * 10,
      duels: i,
    }))
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let n = 0; n < 50; n++) {
      const p = pickPair(tracks, new Set(), rnd)!
      expect(p).not.toBeNull()
      if (!p.border) expect(p.a.rating).toBe(p.b.rating)
      else expect(p.a.rating).toBeGreaterThan(p.b.rating!)
    }
  })
  it('порядок после перетаскивания', () => {
    expect(refinementsForOrder(3)).toEqual([400, 0, -400])
    expect(refinementsForOrder(1)).toEqual([0])
  })
})

function rt(key: string, artist: string, extra: Partial<RadioTrack> = {}): RadioTrack {
  return {
    key,
    artists: [artist],
    album: '',
    genre: '',
    rating: null,
    favoriteAt: null,
    plays: 5,
    skips: 0,
    lastStartedAt: null,
    bpm: null,
    energy: null,
    ...extra,
  }
}

describe('радио', () => {
  const pool = [
    rt('a1', 'A', { genre: 'Рок' }),
    rt('a2', 'A', { genre: 'Рок' }),
    rt('a3', 'A', { genre: 'Рок' }),
    rt('b1', 'B', { genre: 'Рок' }),
    rt('b2', 'B', { genre: 'Рок' }),
    rt('c1', 'C', { genre: 'Джаз' }),
    rt('d1', 'D', { genre: 'Рок' }),
  ]
  const nb = normalizeNeighbors([
    { key: 'a1', other: 'b1', score: 4 },
    { key: 'a1', other: 'c1', score: 1 },
  ])
  it('соседство по истории делает трек похожим', () => {
    expect(similarity(pool[0]!, pool[3]!, nb)).toBeGreaterThan(similarity(pool[0]!, pool[6]!, nb))
  })
  it('не повторяет зерно и разносит исполнителей', () => {
    const picks = pickRadio(
      pool,
      {
        seeds: [pool[0]!],
        recent: [pool[0]!],
        exclude: new Set(['a1']),
        neighbors: nb,
        dials: { adventure: 0, freshness: 0.5 },
        now: 0,
      },
      5,
      () => 0.5,
    )
    expect(picks.map((p) => p.key)).not.toContain('a1')
    expect(picks[0]!.key).toBe('b1')
    for (let i = 1; i < picks.length; i++) {
      if (picks[i]!.artists[0] === picks[i - 1]!.artists[0]) {
        // Подряд один исполнитель допустим, только когда других уже не осталось
        const left = picks.slice(i).map((p) => p.artists[0])
        expect(new Set(left).size).toBe(1)
      }
    }
  })
})

describe('виды перемешивания', () => {
  const list = Array.from({ length: 40 }, (_, i) => ({
    key: `t${i}`,
    artists: [`a${i % 8}`],
    album: `al${i % 10}`,
    rating: i < 5 ? 10 : null,
    favoriteAt: i < 5 ? 1 : null,
    plays: i,
    skips: 0,
    lastStartedAt: i < 20 ? Date.now() - i * 3_600_000 : null,
  }))
  it('каждый вид возвращает все треки ровно по разу', () => {
    for (const kind of ['smart', 'normal', 'favorites', 'fresh', 'fair'] as const) {
      const out = orderFor(kind, list)
      expect(new Set(out.map((t) => t.key)).size).toBe(40)
    }
  })
  it('«по кругу» ставит давно не звучавшее вперёд', () => {
    const out = orderFor('fair', list)
    const firstHalf = out.slice(0, 20).filter((t) => t.lastStartedAt == null).length
    expect(firstHalf).toBeGreaterThanOrEqual(15)
  })
})

describe('запись ID3', () => {
  function tag23(frames: [string, number[]][]): Uint8Array {
    const body = frames.flatMap(([id, data]) => [
      ...[...id].map((c) => c.charCodeAt(0)),
      0,
      0,
      (data.length >> 8) & 255,
      data.length & 255,
      0,
      0,
      ...data,
    ])
    const n = body.length
    return new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f, ...body])
  }
  it('меняет названия, сохраняет прочие кадры и аудио', () => {
    const old = tag23([
      ['TIT2', [0, ...'Old'.split('').map((c) => c.charCodeAt(0))]],
      ['TALB', [3, ...new TextEncoder().encode('Альбом')]],
      ['COMM', [0, 0x65, 0x6e, 0x67, 0, 0x68, 0x69]],
    ])
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5])
    const file = new Uint8Array([...old, ...audio])
    const out = writeId3(file, { title: 'Новое имя', artist: 'Кино', year: 1988 })
    const size = tagSize(out.subarray(0, 10))
    expect([...out.subarray(size)]).toEqual([...audio])
    const t = parseV2(out.subarray(0, size))!
    expect(t.title).toBe('Новое имя')
    expect(t.artist).toBe('Кино')
    expect(t.album).toBe('Альбом')
    expect(t.year).toBe(1988)
  })
})

describe('подсказки по оценкам', () => {
  it('часто слушаемый трек предлагается поднять, пропускаемый — опустить', () => {
    const now = Date.now()
    const base = { skips: 0, lastPlayedAt: now - 86_400_000 }
    const tracks = [
      ...Array.from({ length: 5 }, (_, i) => ({ key: `h${i}`, rating: 9, plays: 10, ...base })),
      { key: 'up', rating: 8, plays: 14, ...base },
      { key: 'low', rating: 8, plays: 2, ...base },
      { key: 'down', rating: 9, plays: 3, skips: 7, lastPlayedAt: now },
    ]
    const s = ratingSuggestions(tracks, now)
    expect(s.find((x) => x.key === 'up')).toMatchObject({ from: 8, to: 9 })
    expect(s.find((x) => x.key === 'low')).toBeUndefined()
    expect(s.find((x) => x.key === 'down')).toMatchObject({ from: 9, to: 8 })
  })
})

describe('анализ громкости (как на телефоне)', () => {
  it('синус 997 Гц на −12 dBFS в стерео ≈ −12 LUFS, тишина по краям', () => {
    const sr = 44100
    const n = sr * 20
    const ch = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / sr
      ch[i] = t >= 2 && t < 17 ? 0.25 * Math.sin(2 * Math.PI * 997 * t) : 0
    }
    const r = analyzeChannels([ch, ch], sr)
    // Эмулятор (Analyzer.kt) на этом же сигнале дал −12,12 LUFS, пик −12,04, тишина 2000/3000 мс
    expect(r.lufs!).toBeGreaterThan(-12.4)
    expect(r.lufs!).toBeLessThan(-11.8)
    expect(r.peakDb).toBeCloseTo(-12.04, 1)
    expect(Math.abs(r.introMs - 2000)).toBeLessThan(15)
    expect(Math.abs(r.outroMs - 3000)).toBeLessThan(15)
  })
})
