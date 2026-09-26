import { bucketBase, clampRefine, refinementOf } from './rating'

/**
 * Дуэли: два трека рядом, ты выбираешь лучший. Внутри одинаковых звёзд уточнение места
 * работает как рейтинг Эло: победа над сильным даёт больше, чем над слабым.
 * Коэффициент K падает с 32 до 12 по мере того, как у трека копятся дуэли: первые решают много,
 * потом порядок устаканивается.
 */

export interface DuelTrack {
  key: string
  rating: number | null
  rankScore: number | null
  duels: number
}

export function kFactor(duels: number): number {
  return Math.max(12, 32 - duels * 2)
}

export function expected(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400))
}

/**
 * Новые счета после дуэли. result: 1 — победил A, 0 — победил B, 0.5 — ничья.
 * Если звёзды разные (пограничная дуэль), звёзды не трогаем: меняется только уточнение внутри своих групп.
 */
export function applyDuel(a: DuelTrack, b: DuelTrack, result: number): { a: number; b: number } {
  const ra = refinementOf(a.rating, a.rankScore)
  const rb = refinementOf(b.rating, b.rankScore)
  const ea = expected(ra, rb)
  const na = clampRefine(ra + kFactor(a.duels) * (result - ea))
  const nb = clampRefine(rb + kFactor(b.duels) * (1 - result - (1 - ea)))
  return { a: bucketBase(a.rating ?? 0) + na, b: bucketBase(b.rating ?? 0) + nb }
}

export interface DuelPair<T> {
  a: T
  b: T
  /** Пограничная: нижний трек группы выше против верхнего трека группы ниже */
  border: boolean
}

/**
 * Выбор пары. 80% — внутри одной группы звёзд: трек с меньшим числом дуэлей против
 * соседа с самым близким счётом (там порядок наименее ясен). 20% — пограничные:
 * если нижний из 4★ проиграет верхнему из 3½★, приложение предложит поменять им звёзды.
 */
export function pickPair<T extends DuelTrack>(
  tracks: T[],
  recent: Set<string>,
  rnd: () => number = Math.random,
): DuelPair<T> | null {
  const rated = tracks.filter((t) => t.rating != null)
  const buckets = new Map<number, T[]>()
  for (const t of rated) buckets.set(t.rating!, [...(buckets.get(t.rating!) ?? []), t])
  const pairKey = (x: T, y: T) => (x.key < y.key ? `${x.key}|${y.key}` : `${y.key}|${x.key}`)

  const ratings = [...buckets.keys()].sort((x, y) => y - x)
  if (rnd() < 0.2 && ratings.length > 1) {
    const i = Math.floor(rnd() * (ratings.length - 1))
    const upper = [...buckets.get(ratings[i]!)!].sort((x, y) => (x.rankScore ?? 0) - (y.rankScore ?? 0))
    const lower = [...buckets.get(ratings[i + 1]!)!].sort((x, y) => (y.rankScore ?? 0) - (x.rankScore ?? 0))
    const a = upper[0]
    const b = lower[0]
    if (a && b && !recent.has(pairKey(a, b))) return { a, b, border: true }
  }

  const candidates = [...buckets.values()].filter((b) => b.length >= 2)
  if (!candidates.length) return null
  // Группа выбирается с вероятностью по размеру
  const total = candidates.reduce((s, b) => s + b.length, 0)
  let r = rnd() * total
  let bucket = candidates[0]!
  for (const b of candidates) {
    r -= b.length
    if (r <= 0) {
      bucket = b
      break
    }
  }
  const byDuels = [...bucket].sort((x, y) => x.duels - y.duels + (rnd() - 0.5) * 3)
  for (const a of byDuels.slice(0, 6)) {
    const others = bucket
      .filter((o) => o !== a && !recent.has(pairKey(a, o)))
      .sort((x, y) => Math.abs((x.rankScore ?? 0) - (a.rankScore ?? 0)) - Math.abs((y.rankScore ?? 0) - (a.rankScore ?? 0)))
    const b = others[Math.min(others.length - 1, Math.floor(rnd() * 3))]
    if (b) return rnd() < 0.5 ? { a, b, border: false } : { a: b, b: a, border: false }
  }
  return null
}

/** Новые уточнения после перетаскивания внутри группы: равномерно от +400 (верх) до −400 (низ) */
export function refinementsForOrder(count: number): number[] {
  if (count <= 1) return [0]
  return Array.from({ length: count }, (_, i) => Math.round(400 - (800 * i) / (count - 1)))
}
