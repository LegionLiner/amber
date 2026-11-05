import { normKey } from './names'
import { sortTracks, type TrackSortKey } from './sort'
import type { Track } from './track'
import { $t } from '@/i18n'

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
  get title() {
    return $t('Название')
  },
  get artist() {
    return $t('Исполнитель')
  },
  get album() {
    return $t('Альбом')
  },
  get genre() {
    return $t('Жанр')
  },
  get folder() {
    return $t('Папка')
  },
  get rating() {
    return $t('Оценка')
  },
  get plays() {
    return $t('Прослушивания')
  },
  get skips() {
    return $t('Пропуски')
  },
  get year() {
    return $t('Год')
  },
  get duration() {
    return $t('Длительность, мин')
  },
  get bpm() {
    return $t('Темп, BPM')
  },
  get energy() {
    return $t('Энергия, %')
  },
  get favorite() {
    return $t('Избранное')
  },
  get added() {
    return $t('Добавлен')
  },
  get lastPlayed() {
    return $t('Звучал')
  },
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
      return $t('{0} содержит «{1}»', f, c.value)
    case 'is':
      return c.field === 'favorite' ? $t('В избранном') : `${f}: ${(c as { value: string }).value}`
    case 'not':
      return c.field === 'favorite' ? $t('Не в избранном') : $t('{0} без «{1}»', f, (c as { value: string }).value)
    case 'unrated':
      return $t('Без оценки')
    case 'never':
      return $t('Ни разу не звучал')
    case 'within':
      return $t('{0} за последние {1} дн.', f, c.days)
    case 'notWithin':
      return $t('{0} больше {1} дн. назад или никогда', f, c.days)
    case 'gte':
      return c.field === 'rating' ? $t('Оценка от {0}★', c.value / 2) : $t('{0} от {1}', f, c.value)
    case 'lte':
      return c.field === 'rating' ? $t('Оценка до {0}★', c.value / 2) : $t('{0} до {1}', f, c.value)
    case 'eq':
      return c.field === 'rating' ? $t('Оценка {0}★', c.value / 2) : `${f} = ${c.value}`
  }
}
