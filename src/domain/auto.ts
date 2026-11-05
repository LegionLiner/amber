import type { Track } from './track'
import { refinementOf } from './rating'
import { $t } from '@/i18n'

/**
 * Автоплейлисты: чистые функции отбора. Данные о прослушиваниях приходят готовыми
 * (см. data/repos/auto.ts), здесь только правила из плана.
 */

export type AutoId =
  | 'eternal'
  | 'onRepeat'
  | 'forgotten'
  | 'neverPlayed'
  | 'recentlyAdded'
  | 'bestRated'
  | 'morning'
  | 'day'
  | 'evening'
  | 'night'
  | 'now'
  | 'yearAgo'
  | 'discoveries'
  | 'skipped'

export interface AutoDef {
  id: AutoId
  title: string
  hint: string
}

export const AUTO_PLAYLISTS: AutoDef[] = [
  {
    id: 'now',
    get title() {
      return $t('Подходит сейчас')
    },
    get hint() {
      return $t('любимое в это время суток')
    },
  },
  {
    id: 'eternal',
    get title() {
      return $t('Вечный чарт')
    },
    get hint() {
      return $t('все треки по числу прослушиваний')
    },
  },
  {
    id: 'onRepeat',
    get title() {
      return $t('На повторе')
    },
    get hint() {
      return $t('14 дней чаще обычного')
    },
  },
  {
    id: 'bestRated',
    get title() {
      return $t('Лучшее по оценке')
    },
    get hint() {
      return $t('4½★ и выше, по месту')
    },
  },
  {
    id: 'forgotten',
    get title() {
      return $t('Давно не слушал')
    },
    get hint() {
      return $t('любимое, но больше 60 дней назад')
    },
  },
  {
    id: 'discoveries',
    get title() {
      return $t('Открытия месяца')
    },
    get hint() {
      return $t('впервые засчитаны за 30 дней')
    },
  },
  {
    id: 'recentlyAdded',
    get title() {
      return $t('Недавно добавленные')
    },
    get hint() {
      return $t('новое на телефоне')
    },
  },
  {
    id: 'neverPlayed',
    get title() {
      return $t('Ни разу не слушал')
    },
    get hint() {
      return $t('ноль засчитанных')
    },
  },
  {
    id: 'morning',
    get title() {
      return $t('Утро')
    },
    hint: '5:00–11:00',
  },
  {
    id: 'day',
    get title() {
      return $t('День')
    },
    hint: '11:00–17:00',
  },
  {
    id: 'evening',
    get title() {
      return $t('Вечер')
    },
    hint: '17:00–23:00',
  },
  {
    id: 'night',
    get title() {
      return $t('Ночь')
    },
    hint: '23:00–5:00',
  },
  {
    id: 'yearAgo',
    get title() {
      return $t('Год назад')
    },
    get hint() {
      return $t('что звучало в эту неделю год назад')
    },
  },
  {
    id: 'skipped',
    get title() {
      return $t('Часто пропускаю')
    },
    get hint() {
      return $t('кандидаты пересмотреть оценку')
    },
  },
]

export type DayPart = 'morning' | 'day' | 'evening' | 'night'

export function partOfDay(hour: number): DayPart {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'day'
  if (hour >= 17 && hour < 23) return 'evening'
  return 'night'
}

/** Засчитанные прослушивания трека по часам: hours[key][h] */
export type HourStats = Map<string, number[]>

const DAY = 86_400_000

export interface AutoContext {
  now: number
  hours: HourStats
  /** Засчитанные за последние 14 дней */
  recent14: Map<string, number>
  /** Засчитанные в ту же неделю год назад */
  yearAgo: Set<string>
}

function ratingFactor(t: Track): number {
  return 0.5 + (t.rating ?? 6) / 10
}

/** Любимое в части суток: доля · ln(1 + прослушиваний в части) · поправка на оценку, от 3 прослушиваний */
export function byDayPart(tracks: Track[], hours: HourStats, part: DayPart, extraHours: number[] = []): Track[] {
  const scored: [Track, number][] = []
  for (const t of tracks) {
    const h = hours.get(t.key)
    if (!h) continue
    let inPart = 0
    let total = 0
    for (let i = 0; i < 24; i++) {
      total += h[i] ?? 0
      if (partOfDay(i) === part || extraHours.includes(i)) inPart += h[i] ?? 0
    }
    if (inPart < 3 || total === 0) continue
    scored.push([t, (inPart / total) * Math.log1p(inPart) * ratingFactor(t)])
  }
  return scored.sort((a, b) => b[1] - a[1]).map((x) => x[0])
}

export function onRepeat(tracks: Track[], recent14: Map<string, number>, now: number): Track[] {
  const scored: [Track, number][] = []
  for (const t of tracks) {
    const r = recent14.get(t.key) ?? 0
    if (r < 4) continue
    const olderPlays = t.plays - r
    const days = t.firstPlayedAt ? Math.max(1, (now - t.firstPlayedAt) / DAY - 14) : 1
    const baseline14 = olderPlays > 0 ? (olderPlays / days) * 14 : 0
    const lift = r / (baseline14 + 1)
    if (lift >= 3) scored.push([t, lift * Math.log1p(r)])
  }
  return scored.sort((a, b) => b[1] - a[1]).map((x) => x[0])
}

export function forgotten(tracks: Track[], now: number): Track[] {
  const cutoff = now - 60 * DAY
  return tracks
    .filter((t) => t.plays > 0 && ((t.rating ?? 0) >= 8 || t.plays >= 10) && (t.lastPlayedAt ?? 0) < cutoff)
    .map((t) => [t, ((t.rating ?? 6) / 2 + Math.log1p(t.plays)) * Math.log((now - (t.lastPlayedAt ?? 0)) / DAY)] as const)
    .sort((a, b) => b[1] - a[1])
    .map((x) => x[0])
}

export function buildAuto(id: AutoId, tracks: Track[], ctx: AutoContext): Track[] {
  const { now } = ctx
  switch (id) {
    case 'eternal':
      return tracks.filter((t) => t.plays > 0).sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs)
    case 'onRepeat':
      return onRepeat(tracks, ctx.recent14, now)
    case 'forgotten':
      return forgotten(tracks, now)
    case 'neverPlayed':
      return tracks.filter((t) => t.plays === 0).sort((a, b) => b.addedAt - a.addedAt)
    case 'recentlyAdded':
      return [...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 100)
    case 'bestRated':
      return tracks
        .filter((t) => (t.rating ?? 0) >= 9)
        .sort(
          (a, b) =>
            (b.rating ?? 0) - (a.rating ?? 0) ||
            refinementOf(b.rating, b.rankScore) - refinementOf(a.rating, a.rankScore) ||
            b.plays - a.plays,
        )
    case 'morning':
    case 'day':
    case 'evening':
    case 'night':
      return byDayPart(tracks, ctx.hours, id)
    case 'now': {
      const h = new Date(now).getHours()
      return byDayPart(tracks, ctx.hours, partOfDay(h), [(h + 23) % 24, (h + 1) % 24])
    }
    case 'yearAgo':
      return tracks.filter((t) => ctx.yearAgo.has(t.key)).sort((a, b) => b.plays - a.plays)
    case 'discoveries':
      return tracks
        .filter((t) => t.firstPlayedAt != null && t.firstPlayedAt >= now - 30 * DAY)
        .sort((a, b) => (b.firstPlayedAt ?? 0) - (a.firstPlayedAt ?? 0))
    case 'skipped':
      return tracks
        .filter((t) => t.plays + t.skips >= 5 && t.skips / (t.plays + t.skips) > 0.6)
        .sort((a, b) => b.skips / (b.plays + b.skips) - a.skips / (a.plays + a.skips))
  }
}
