import { normKey } from './names'
import { sortTracks, type TrackSortKey } from './sort'
import type { Track } from './track'

/**
 * Умные плейлисты: набор условий, по которым плейлист собирается сам и обновляется
 * при каждом открытии. Условия проверяются на треках в памяти — без запросов к базе.
 */

export type TextField = 'title' | 'artist' | 'album' | 'genre' | 'folder'
export type NumField = 'rating' | 'plays' | 'skips' | 'year' | 'duration' | 'bpm' | 'energy'
export type DateField = 'added' | 'lastPlayed'

export type Condition =
  | { field: TextField; op: 'contains' | 'is' | 'not'; value: string }
  | { field: NumField; op: 'gte' | 'lte' | 'eq'; value: number }
  | { field: 'rating'; op: 'unrated' }
  | { field: 'favorite'; op: 'is' | 'not' }
  | { field: DateField; op: 'within' | 'notWithin'; days: number }
  | { field: 'lastPlayed'; op: 'never' }

export interface SmartRules {
  match: 'all' | 'any'
  conditions: Condition[]
  sort: { key: TrackSortKey; dir: 'asc' | 'desc' }
  limit: number | null
}

export const DEFAULT_RULES: SmartRules = {
  match: 'all',
  conditions: [{ field: 'rating', op: 'gte', value: 8 }],
  sort: { key: 'rating', dir: 'desc' },
  limit: null,
}

export const FIELD_LABEL: Record<Condition['field'], string> = {
  title: 'Название',
  artist: 'Исполнитель',
  album: 'Альбом',
  genre: 'Жанр',
  folder: 'Папка',
  rating: 'Оценка',
  plays: 'Прослушивания',
  skips: 'Пропуски',
  year: 'Год',
  duration: 'Длительность, мин',
  bpm: 'Темп, BPM',
  energy: 'Энергия, %',
  favorite: 'Избранное',
  added: 'Добавлен',
  lastPlayed: 'Звучал',
}

const DAY = 86_400_000

function num(t: Track, f: NumField): number | null {
  switch (f) {
    case 'rating':
      return t.rating
    case 'plays':
      return t.plays
    case 'skips':
      return t.skips
    case 'year':
      return t.year
    case 'duration':
      return t.durationMs / 60_000
    case 'bpm':
      return t.bpm
    case 'energy':
      return t.energy != null ? t.energy * 100 : null
  }
}

export function matches(t: Track, c: Condition, now: number): boolean {
  switch (c.field) {
    case 'title':
    case 'artist':
    case 'album':
    case 'genre':
    case 'folder': {
      const v = normKey(c.field === 'artist' ? t.artists.join(' ') || t.artist : t[c.field])
      const q = normKey(c.value)
      if (c.op === 'contains') return v.includes(q)
      if (c.op === 'is') return v === q || (c.field === 'artist' && t.artists.some((a) => normKey(a) === q))
      return !v.includes(q)
    }
    case 'favorite':
      return c.op === 'is' ? !!t.favoriteAt : !t.favoriteAt
    case 'added':
    case 'lastPlayed': {
      if (c.op === 'never') return t.lastPlayedAt == null
      const ts = c.field === 'added' ? t.addedAt : t.lastPlayedAt
      const within = ts != null && now - ts <= c.days * DAY
      return c.op === 'within' ? within : !within
    }
    default: {
      if (c.op === 'unrated') return t.rating == null
      const v = num(t, c.field)
      if (v == null) return false
      if (c.op === 'gte') return v >= c.value
      if (c.op === 'lte') return v <= c.value
      return Math.abs(v - c.value) < 1e-9
    }
  }
}

export function applyRules(tracks: Track[], rules: SmartRules, now = Date.now()): Track[] {
  const conds = rules.conditions
  const picked = conds.length
    ? tracks.filter((t) =>
        rules.match === 'all' ? conds.every((c) => matches(t, c, now)) : conds.some((c) => matches(t, c, now)),
      )
    : tracks.slice()
  const sorted = sortTracks(picked, rules.sort.key, rules.sort.dir)
  return rules.limit ? sorted.slice(0, rules.limit) : sorted
}

export function parseRules(json: string | null): SmartRules {
  if (!json) return structuredClone(DEFAULT_RULES)
  try {
    const r = JSON.parse(json) as Partial<SmartRules>
    return { ...structuredClone(DEFAULT_RULES), ...r, conditions: r.conditions ?? [] }
  } catch {
    return structuredClone(DEFAULT_RULES)
  }
}

/** Человеческое описание условия для списка */
export function describe(c: Condition): string {
  const f = FIELD_LABEL[c.field]
  switch (c.op) {
    case 'contains':
      return `${f} содержит «${c.value}»`
    case 'is':
      return c.field === 'favorite' ? 'В избранном' : `${f}: ${(c as { value: string }).value}`
    case 'not':
      return c.field === 'favorite' ? 'Не в избранном' : `${f} без «${(c as { value: string }).value}»`
    case 'unrated':
      return 'Без оценки'
    case 'never':
      return 'Ни разу не звучал'
    case 'within':
      return `${f} за последние ${c.days} дн.`
    case 'notWithin':
      return `${f} больше ${c.days} дн. назад или никогда`
    case 'gte':
      return c.field === 'rating' ? `Оценка от ${c.value / 2}★` : `${f} от ${c.value}`
    case 'lte':
      return c.field === 'rating' ? `Оценка до ${c.value / 2}★` : `${f} до ${c.value}`
    case 'eq':
      return c.field === 'rating' ? `Оценка ${c.value / 2}★` : `${f} = ${c.value}`
  }
}
