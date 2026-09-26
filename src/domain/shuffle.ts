/**
 * Перемешивание. Три шага:
 * 1) порядок: равные шансы (Фишер–Йейтс) или веса (Эфраимидис–Спиракис);
 * 2) разнесение: один исполнитель не чаще раза в 3 трека, альбом не чаще раза в 4;
 * 3) веса считает smartWeight() из оценки, давности и пропусков.
 */

export type Rnd = () => number

/** Перемешивание: умное (веса), обычное, любимые чаще, давно не игравшие, по кругу без повторов */
export type ShuffleKind = 'smart' | 'normal' | 'favorites' | 'fresh' | 'fair'

export const SHUFFLE_KINDS: { id: ShuffleKind; label: string; hint: string }[] = [
  { id: 'smart', label: 'Умное', hint: 'Чаще любимое, реже недавнее и пропускаемое' },
  { id: 'normal', label: 'Обычное', hint: 'Все треки на равных' },
  { id: 'favorites', label: 'Любимое', hint: 'Избранное и высокие оценки впереди' },
  { id: 'fresh', label: 'Забытое', hint: 'Давно не звучавшее и почти не игравшее' },
  { id: 'fair', label: 'По кругу', hint: 'Каждый трек прозвучит, прежде чем повторится' },
]

export function mulberry32(seed: number): Rnd {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Фишер–Йейтс: все порядки равновероятны */
export function shuffle<T>(items: readonly T[], rnd: Rnd = Math.random): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/**
 * Взвешенный порядок без повторов: ключ = u^(1/w), сортировка по убыванию ключа.
 * У элемента с весом 2 вдвое больше шансов оказаться раньше элемента с весом 1.
 */
export function weightedShuffle<T>(items: readonly T[], weight: (t: T) => number, rnd: Rnd = Math.random): T[] {
  return items
    .map((t) => ({ t, k: Math.pow(rnd(), 1 / Math.max(weight(t), 1e-6)) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.t)
}

/**
 * Разносит одинаковых исполнителей и альбомы. Жадно: если следующий элемент
 * конфликтует с недавними, ищем ближайший подходящий дальше по списку и ставим его вперёд.
 */
export function spread<T>(
  items: readonly T[],
  artistOf: (t: T) => string,
  albumOf: (t: T) => string,
  artistGap = 3,
  albumGap = 4,
): T[] {
  const rest = items.slice()
  const out: T[] = []
  const conflicts = (t: T) => {
    const ar = artistOf(t)
    const al = albumOf(t)
    for (let i = 1; i <= Math.max(artistGap, albumGap) - 1 && out.length - i >= 0; i++) {
      const prev = out[out.length - i]!
      if (ar && i < artistGap && artistOf(prev) === ar) return true
      if (al && i < albumGap && albumOf(prev) === al) return true
    }
    return false
  }
  while (rest.length) {
    let pick = 0
    const limit = Math.min(rest.length, 40)
    while (pick < limit && conflicts(rest[pick]!)) pick++
    if (pick >= limit) pick = 0
    out.push(rest.splice(pick, 1)[0]!)
  }
  return out
}

export interface WeightInput {
  rating: number | null
  plays: number
  skips: number
  lastStartedAt: number | null
}

/** Вес трека для умного перемешивания */
export function smartWeight(t: WeightInput, now = Date.now()): number {
  const stars = t.rating != null ? t.rating / 2 : 3
  const ratingF = Math.pow(1.5, stars - 3)
  const hours = t.lastStartedAt ? (now - t.lastStartedAt) / 3_600_000 : 1e6
  const freshF = 1 - Math.exp(-hours / 36)
  const starts = t.plays + t.skips
  const skipRate = starts > 0 ? t.skips / starts : 0
  const skipF = 1 - 0.6 * skipRate
  const noveltyF = t.plays < 3 ? 1.2 : 1
  return Math.max(0.01, ratingF * Math.max(0.05, freshF) * skipF * noveltyF)
}

export interface ShuffleTrack extends WeightInput {
  favoriteAt: number | null
  artists: string[]
  album: string
}

/** Вес для «Любимого»: избранное вчетверо, каждая звезда в полтора раза */
export function favoriteWeight(t: ShuffleTrack): number {
  const stars = t.rating != null ? t.rating / 2 : 2.5
  return (t.favoriteAt ? 4 : 1) * Math.pow(1.6, stars - 3)
}

/** Вес для «Забытого»: чем дольше не звучал и чем реже играл, тем выше */
export function freshWeight(t: ShuffleTrack, now = Date.now()): number {
  const days = t.lastStartedAt ? (now - t.lastStartedAt) / 86_400_000 : 120
  return (1 + Math.min(120, days) / 4) / (1 + t.plays / 8)
}

/** Порядок для выбранного вида перемешивания, с разнесением исполнителей и альбомов */
export function orderFor<T extends ShuffleTrack>(
  kind: ShuffleKind,
  list: readonly T[],
  now = Date.now(),
  rnd: Rnd = Math.random,
): T[] {
  let ordered: T[]
  switch (kind) {
    case 'normal':
      ordered = shuffle(list, rnd)
      break
    case 'favorites':
      ordered = weightedShuffle(list, favoriteWeight, rnd)
      break
    case 'fresh':
      ordered = weightedShuffle(list, (t) => freshWeight(t, now), rnd)
      break
    case 'fair':
      // Сначала то, что звучало давнее всего; внутри нескольких дней — случайно
      ordered = list
        .map((t) => ({ t, k: (t.lastStartedAt ?? 0) + rnd() * 3 * 86_400_000 }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.t)
      break
    default:
      ordered = weightedShuffle(list, (t) => smartWeight(t, now), rnd)
  }
  return spread(
    ordered,
    (t) => t.artists[0] ?? '',
    (t) => t.album,
  )
}
