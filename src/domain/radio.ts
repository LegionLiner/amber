/**
 * Радио: бесконечная очередь «в духе» выбранных треков, собранная только из своей музыки.
 *
 * Похожесть двух треков складывается из:
 *  - соседства в истории (что ты слушал рядом с чем) — самый сильный сигнал;
 *  - общего исполнителя, альбома, жанра;
 *  - близости по звуку: энергия и темп из анализа (половинный и двойной темп считаются близкими).
 *
 * Выбор следующего трека — в духе MMR (maximal marginal relevance): берём самый подходящий,
 * но штрафуем за сходство с уже выбранными, чтобы не было пяти треков одного исполнителя подряд.
 * Ручка «смелость» сдвигает баланс от «только похожее» к «неожиданные повороты».
 */

export interface RadioTrack {
  key: string
  artists: string[]
  album: string
  genre: string
  rating: number | null
  favoriteAt: number | null
  plays: number
  skips: number
  lastStartedAt: number | null
  bpm: number | null
  energy: number | null
}

export type Neighbors = Map<string, Map<string, number>>

export interface RadioDialsInput {
  /** 0 — только похожее, 1 — смелые повороты */
  adventure: number
  /** 0 — любимое и знакомое, 1 — забытое и новое */
  freshness: number
}

export interface RadioInput<T extends RadioTrack = RadioTrack> {
  seeds: T[]
  /** Последние треки этого радио: очередь продолжает их настроение */
  recent: T[]
  /** Уже в очереди — не повторять */
  exclude: Set<string>
  neighbors: Neighbors
  dials: RadioDialsInput
  now: number
}

function bpmCloseness(a: number | null, b: number | null): number {
  if (!a || !b) return 0.5
  let r = Math.abs(Math.log(a / b))
  // Половинный и двойной темп звучат совместимо
  r = Math.min(r, Math.abs(r - Math.LN2))
  return Math.max(0, 1 - r / Math.log(1.25))
}

function audioSim(a: RadioTrack, b: RadioTrack): number {
  const e = a.energy != null && b.energy != null ? 1 - Math.abs(a.energy - b.energy) : 0.5
  return 0.6 * e + 0.4 * bpmCloseness(a.bpm, b.bpm)
}

function sameArtist(a: RadioTrack, b: RadioTrack): number {
  if (!a.artists.length || !b.artists.length) return 0
  return a.artists.some((x) => b.artists.includes(x)) ? 1 : 0
}

/** Похожесть 0…1 */
export function similarity(a: RadioTrack, b: RadioTrack, neighbors: Neighbors): number {
  const co = Math.max(neighbors.get(a.key)?.get(b.key) ?? 0, neighbors.get(b.key)?.get(a.key) ?? 0)
  const album = a.album && a.album === b.album ? 1 : 0
  const genre = a.genre && a.genre.toLowerCase() === b.genre.toLowerCase() ? 1 : 0
  return 0.42 * co + 0.24 * sameArtist(a, b) + 0.08 * album + 0.12 * genre + 0.14 * audioSim(a, b)
}

/** Насколько трек тебе близок сам по себе: оценка, избранное, пропуски; ручка «свежесть» тянет к забытому */
export function preference(t: RadioTrack, freshness: number, now: number): number {
  const stars = t.rating != null ? t.rating / 2 : 3
  const liked = Math.min(1, Math.max(0, (stars - 1) / 4) * 0.7 + (t.favoriteAt ? 0.3 : 0))
  const familiar = Math.min(1, Math.log1p(t.plays) / Math.log1p(40))
  const days = t.lastStartedAt ? (now - t.lastStartedAt) / 86_400_000 : 365
  const forgotten = Math.min(1, days / 60)
  const novelty = 0.6 * forgotten + 0.4 * (1 - familiar)
  const starts = t.plays + t.skips
  const skipF = starts > 2 ? 1 - 0.7 * (t.skips / starts) : 1
  return (0.5 * liked + 0.5 * ((1 - freshness) * familiar + freshness * novelty)) * skipF
}

/**
 * Подобрать count треков. rnd — источник случайности (в тестах фиксированный).
 */
export function pickRadio<T extends RadioTrack>(
  pool: T[],
  input: RadioInput<T>,
  count: number,
  rnd: () => number = Math.random,
): T[] {
  const { seeds, recent, exclude, neighbors, dials, now } = input
  const adv = Math.min(1, Math.max(0, dials.adventure))
  // Якоря: зерно весит больше, свежие треки радио — чуть меньше, чтобы настроение плавно дрейфовало
  const anchors: { t: T; w: number }[] = [
    ...seeds.map((t) => ({ t, w: 1 })),
    ...recent.slice(-5).map((t, i, arr) => ({ t, w: 0.35 + (0.35 * (i + 1)) / arr.length })),
  ]
  const wsum = anchors.reduce((s, a) => s + a.w, 0) || 1
  const recentlyPlayed = (t: T) => t.lastStartedAt != null && now - t.lastStartedAt < 6 * 3_600_000

  const scored = pool
    .filter((t) => !exclude.has(t.key))
    .map((t) => {
      const rel = anchors.reduce((s, a) => s + a.w * similarity(a.t, t, neighbors), 0) / wsum
      let score = (1 - 0.55 * adv) * rel + 0.3 * preference(t, dials.freshness, now) + adv * 0.35 * rnd()
      if (recentlyPlayed(t)) score *= 0.25
      return { t, score }
    })
    .sort((a, b) => b.score - a.score)
    // MMR по верхушке: дальше хвост всё равно не выиграет
    .slice(0, Math.max(count * 12, 150))

  // Штраф за повтор: тот же исполнитель сразу следом — сильный, в пределах четырёх треков — слабее.
  // Смелость усиливает разнообразие.
  const diversity = 1 + 0.5 * adv
  const picked: T[] = []
  while (picked.length < count && scored.length) {
    const window = [...recent.slice(-4), ...picked].slice(-4)
    const prev = window[window.length - 1]
    let best = -1
    let bestVal = -Infinity
    for (let i = 0; i < scored.length; i++) {
      const c = scored[i]!
      let penalty = 0
      if (prev && sameArtist(prev, c.t)) penalty = 0.45
      else if (window.some((p) => sameArtist(p, c.t))) penalty = 0.2
      if (window.some((p) => p.album && p.album === c.t.album)) penalty += 0.1
      const val = c.score - diversity * penalty
      if (val > bestVal) {
        bestVal = val
        best = i
      }
    }
    picked.push(scored.splice(best, 1)[0]!.t)
  }
  return picked
}

/** Нормирует соседей: у каждого трека самый сильный сосед получает 1 */
export function normalizeNeighbors(rows: { key: string; other: string; score: number }[]): Neighbors {
  const out: Neighbors = new Map()
  for (const r of rows) {
    let m = out.get(r.key)
    if (!m) out.set(r.key, (m = new Map()))
    m.set(r.other, r.score)
  }
  for (const m of out.values()) {
    const top = Math.max(...m.values())
    if (top > 0) for (const [k, v] of m) m.set(k, v / top)
  }
  return out
}
