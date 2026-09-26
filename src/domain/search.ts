import MiniSearch from 'minisearch'
import type { Track } from './track'

/**
 * Поиск по библиотеке. Каждая строка индексируется в трёх видах:
 * как есть, транслитом (кино → kino, kino → кино) и с исправленной раскладкой.
 * Запрос тоже пробуется в обеих раскладках: «rbyj» находит «Кино».
 */

const RU_LAT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

const LAT_RU: [string, string][] = [
  ['sch', 'щ'],
  ['zh', 'ж'],
  ['ts', 'ц'],
  ['ch', 'ч'],
  ['sh', 'ш'],
  ['yu', 'ю'],
  ['ya', 'я'],
  ['yo', 'ё'],
  ['a', 'а'],
  ['b', 'б'],
  ['v', 'в'],
  ['g', 'г'],
  ['d', 'д'],
  ['e', 'е'],
  ['z', 'з'],
  ['i', 'и'],
  ['y', 'ы'],
  ['k', 'к'],
  ['l', 'л'],
  ['m', 'м'],
  ['n', 'н'],
  ['o', 'о'],
  ['p', 'п'],
  ['r', 'р'],
  ['s', 'с'],
  ['t', 'т'],
  ['u', 'у'],
  ['f', 'ф'],
  ['h', 'х'],
  ['c', 'к'],
  ['w', 'в'],
  ['x', 'кс'],
  ['q', 'к'],
  ['j', 'дж'],
]

const QWERTY = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`"
const JCUKEN = 'йцукенгшщзхъфывапролджэячсмитьбюё'

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function ruToLat(s: string): string {
  let out = ''
  for (const ch of s) out += RU_LAT[ch] ?? ch
  return out
}

export function latToRu(s: string): string {
  let out = ''
  let i = 0
  outer: while (i < s.length) {
    for (const [lat, ru] of LAT_RU) {
      if (s.startsWith(lat, i)) {
        out += ru
        i += lat.length
        continue outer
      }
    }
    out += s[i]
    i++
  }
  return out
}

/** Текст, набранный не в той раскладке: «rbyj» ↔ «кино» */
export function swapLayout(s: string): string {
  let out = ''
  for (const ch of s.toLowerCase()) {
    const a = QWERTY.indexOf(ch)
    if (a >= 0) {
      out += JCUKEN[a]
      continue
    }
    const b = JCUKEN.indexOf(ch)
    out += b >= 0 ? QWERTY[b] : ch
  }
  return out
}

const hasCyr = (s: string) => /[а-я]/.test(s)
const hasLat = (s: string) => /[a-z]/.test(s)

function variants(s: string): string {
  const n = normalize(s)
  const parts = [n]
  if (hasCyr(n)) parts.push(ruToLat(n))
  if (hasLat(n)) parts.push(latToRu(n))
  return parts.join(' ')
}

interface Doc {
  key: string
  title: string
  artist: string
  album: string
  extra: string
}

export class LibrarySearch {
  private ms = new MiniSearch<Doc>({
    idField: 'key',
    fields: ['title', 'artist', 'album', 'extra'],
    processTerm: (term) => normalize(term) || null,
    searchOptions: {
      prefix: true,
      fuzzy: (term) => (term.length > 3 ? 0.2 : false),
      boost: { title: 3, artist: 2, album: 1.2 },
      combineWith: 'AND',
    },
  })

  constructor(tracks: Track[]) {
    this.ms.addAll(
      tracks.map((t) => ({
        key: t.key,
        title: variants(t.title),
        artist: variants(t.artist),
        album: variants(t.album),
        extra: [
          normalize(t.fileName),
          normalize(t.folder),
          t.note ? normalize(t.note) : '',
          t.genre ? normalize(t.genre) : '',
        ].join(' '),
      })),
    )
  }

  /** Ключи треков по убыванию релевантности */
  search(query: string, limit = 200): string[] {
    const q = normalize(query)
    if (!q) return []
    const scores = new Map<string, number>()
    const add = (qq: string, factor: number) => {
      for (const r of this.ms.search(qq)) scores.set(r.id as string, Math.max(scores.get(r.id as string) ?? 0, r.score * factor))
    }
    add(q, 1)
    const swapped = normalize(swapLayout(q))
    if (swapped && swapped !== q) add(swapped, 0.9)
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k]) => k)
  }
}
