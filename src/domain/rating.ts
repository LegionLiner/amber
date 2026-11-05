import { $t } from '@/i18n'
/**
 * Оценки: звёзды с половинками хранятся числом 1..10 (7 = 3½★).
 * Счёт = база от звёзд (500 за каждые ползвезды) + уточнение в пределах ±400. Уточнения соседних групп
 * перекрываются, поэтому места считают так: сначала звёзды, потом уточнение (domain/sort.ts) — трек
 * с 4½★ никогда не окажется выше трека с 5★, а внутри группы порядок решают дуэли и перетаскивание.
 */

export const REFINE_LIMIT = 400

export function bucketBase(rating: number): number {
  return rating * 500
}

export function refinementOf(rating: number | null, rankScore: number | null): number {
  if (rating == null || rankScore == null) return 0
  return clampRefine(rankScore - bucketBase(rating))
}

export function clampRefine(v: number): number {
  return Math.max(-REFINE_LIMIT, Math.min(REFINE_LIMIT, v))
}

/** Новый счёт при смене звёзд: уточнение внутри группы сохраняется */
export function scoreForRating(newRating: number | null, oldRating: number | null, oldScore: number | null): number | null {
  if (newRating == null) return null
  return bucketBase(newRating) + refinementOf(oldRating, oldScore)
}

export function starsLabel(rating: number | null): string {
  if (rating == null) return $t('без оценки')
  const whole = Math.floor(rating / 2)
  return rating % 2 ? `${whole}½★` : `${whole}★`
}

export interface RatingSuggestion {
  key: string
  from: number
  to: number
  reason: string
}

interface SuggestInput {
  key: string
  rating: number | null
  plays: number
  skips: number
  lastPlayedAt: number | null
}

/**
 * Подсказки «оценка не совпадает с тем, как ты слушаешь»:
 *  - поднять: трек слушаешь не реже, чем типичный трек на ползвезды выше, почти не пропускаешь;
 *  - опустить: высокая оценка, но пропускаешь больше половины запусков.
 */
export function ratingSuggestions(tracks: SuggestInput[], now = Date.now()): RatingSuggestion[] {
  const byRating = new Map<number, number[]>()
  for (const t of tracks) if (t.rating != null) byRating.set(t.rating, [...(byRating.get(t.rating) ?? []), t.plays])
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)]! : Infinity
  }
  const med = new Map([...byRating.entries()].map(([r, xs]) => [r, median(xs)]))
  const out: RatingSuggestion[] = []
  for (const t of tracks) {
    if (t.rating == null) continue
    const starts = t.plays + t.skips
    const skipRate = starts ? t.skips / starts : 0
    const recent = t.lastPlayedAt != null && now - t.lastPlayedAt < 60 * 86_400_000
    const upper = med.get(t.rating + 1) ?? med.get(t.rating + 2)
    if (t.rating < 10 && recent && upper != null && upper !== Infinity && t.plays >= Math.max(6, upper) && skipRate < 0.15) {
      out.push({ key: t.key, from: t.rating, to: t.rating + 1, reason: $t('слушаешь как трек на {0}', starsLabel(t.rating + 1)) })
    } else if (t.rating >= 7 && starts >= 6 && skipRate > 0.5) {
      out.push({
        key: t.key,
        from: t.rating,
        to: t.rating - 1,
        reason: $t('пропускаешь {0}% запусков', Math.round(skipRate * 100)),
      })
    }
  }
  return out.sort((a, b) => (b.to > b.from ? 1 : 0) - (a.to > a.from ? 1 : 0))
}
