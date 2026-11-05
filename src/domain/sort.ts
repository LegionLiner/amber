import type { Track } from './track'
import { refinementOf } from './rating'
import { $t } from '@/i18n'

export type TrackSortKey =
  | 'title'
  | 'artist'
  | 'album'
  | 'added'
  | 'duration'
  | 'rating'
  | 'plays'
  | 'lastPlayed'
  | 'listened'
  | 'skips'
  | 'fileName'
  | 'folder'
  | 'year'
  | 'random'

export const TRACK_SORTS: { key: TrackSortKey; label: string; dir: 'asc' | 'desc' }[] = [
  {
    key: 'rating',
    get label() {
      return $t('Оценка и место')
    },
    dir: 'desc',
  },
  {
    key: 'plays',
    get label() {
      return $t('Прослушивания')
    },
    dir: 'desc',
  },
  {
    key: 'title',
    get label() {
      return $t('Название')
    },
    dir: 'asc',
  },
  {
    key: 'artist',
    get label() {
      return $t('Исполнитель')
    },
    dir: 'asc',
  },
  {
    key: 'album',
    get label() {
      return $t('Альбом')
    },
    dir: 'asc',
  },
  {
    key: 'added',
    get label() {
      return $t('Дата добавления')
    },
    dir: 'desc',
  },
  {
    key: 'lastPlayed',
    get label() {
      return $t('Последнее прослушивание')
    },
    dir: 'desc',
  },
  {
    key: 'listened',
    get label() {
      return $t('Время прослушивания')
    },
    dir: 'desc',
  },
  {
    key: 'duration',
    get label() {
      return $t('Длительность')
    },
    dir: 'desc',
  },
  {
    key: 'skips',
    get label() {
      return $t('Пропуски')
    },
    dir: 'desc',
  },
  {
    key: 'year',
    get label() {
      return $t('Год')
    },
    dir: 'desc',
  },
  {
    key: 'fileName',
    get label() {
      return $t('Имя файла')
    },
    dir: 'asc',
  },
  {
    key: 'folder',
    get label() {
      return $t('Папка')
    },
    dir: 'asc',
  },
  {
    key: 'random',
    get label() {
      return $t('Случайно')
    },
    dir: 'asc',
  },
]

const coll = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })

function seeded(key: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0
  return h
}

/** Пустые значения всегда уходят в конец, независимо от направления */
function nullsLast(a: number | null, b: number | null, dir: number): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return (a - b) * dir
}

export function sortTracks(list: Track[], key: TrackSortKey, dir: 'asc' | 'desc', seed = 1): Track[] {
  const d = dir === 'asc' ? 1 : -1
  const out = list.slice()
  const byTitle = (a: Track, b: Track) => coll.compare(a.title, b.title)
  let cmp: (a: Track, b: Track) => number
  switch (key) {
    case 'title':
      cmp = (a, b) => coll.compare(a.title, b.title) * d
      break
    case 'artist':
      cmp = (a, b) => (!a.artist ? 1 : !b.artist ? -1 : coll.compare(a.artist, b.artist) * d) || byTitle(a, b)
      break
    case 'album':
      cmp = (a, b) => (!a.album ? 1 : !b.album ? -1 : coll.compare(a.album, b.album) * d) || (a.trackNo ?? 0) - (b.trackNo ?? 0)
      break
    case 'added':
      cmp = (a, b) => (a.addedAt - b.addedAt) * d || byTitle(a, b)
      break
    case 'duration':
      cmp = (a, b) => (a.durationMs - b.durationMs) * d
      break
    case 'rating':
      // Сначала звёзды, счёт — только внутри одинаковых звёзд: уточнения соседних групп перекрываются
      // (шаг групп 500, уточнение до ±400), и по одному счёту нижние 5★ уходили под верхний 4½★
      cmp = (a, b) =>
        nullsLast(a.rating, b.rating, d) ||
        (refinementOf(a.rating, a.rankScore) - refinementOf(b.rating, b.rankScore)) * d ||
        b.plays - a.plays ||
        byTitle(a, b)
      break
    case 'plays':
      cmp = (a, b) => (a.plays - b.plays) * d || (a.listenedMs - b.listenedMs) * d || byTitle(a, b)
      break
    case 'lastPlayed':
      cmp = (a, b) => nullsLast(a.lastPlayedAt, b.lastPlayedAt, d) || byTitle(a, b)
      break
    case 'listened':
      cmp = (a, b) => (a.listenedMs - b.listenedMs) * d || byTitle(a, b)
      break
    case 'skips':
      cmp = (a, b) => (a.skips - b.skips) * d || byTitle(a, b)
      break
    case 'year':
      cmp = (a, b) => nullsLast(a.year, b.year, d) || byTitle(a, b)
      break
    case 'fileName':
      cmp = (a, b) => coll.compare(a.fileName, b.fileName) * d
      break
    case 'folder':
      cmp = (a, b) => coll.compare(a.folder, b.folder) * d || coll.compare(a.fileName, b.fileName)
      break
    case 'random':
      cmp = (a, b) => seeded(a.key, seed) - seeded(b.key, seed)
      break
  }
  return out.sort(cmp)
}
