/**
 * Работа с названиями: мусор сайтов, разбор имени файла, соавторы.
 * Чистые функции без побочных эффектов, покрыты тестами (tests/names.test.ts).
 */

/** Водяные знаки сайтов, которые часто остаются в названиях скачанных mp3 */
const JUNK_PATTERNS: RegExp[] = [
  /\s*[([{]\s*(?:www\.)?[a-z0-9-]+\.(?:net|ru|com|org|fm|me|club|su|info|pro|cc|to|io|online|site|biz|tv|xyz)\s*[)\]}]/gi,
  /\s*[-–—|]\s*(?:www\.)?[a-z0-9-]+\.(?:net|ru|com|org|fm|me|club|su|info|pro|cc|to|io|online|site|biz|tv|xyz)\s*$/gi,
  /\s*(?:www\.)[a-z0-9-]+\.[a-z]{2,6}/gi,
  /\s*[([]?\s*скачать(?:\s+бесплатно)?(?:\s+mp3)?\s*[)\]]?/gi,
  /\s*[([]\s*(?:mp3|320\s*kbps|128\s*kbps|official\s+audio)\s*[)\]]/gi,
]

export function stripJunk(s: string): string {
  let out = s
  for (const re of JUNK_PATTERNS) out = out.replace(re, '')
  return out.replace(/\s{2,}/g, ' ').trim()
}

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|alac)$/i, '')
}

export interface ParsedName {
  artist: string | null
  title: string
  trackNo: number | null
}

/**
 * «01. Кино - Группа крови.mp3» → { trackNo: 1, artist: 'Кино', title: 'Группа крови' }
 * «Группа крови.mp3» → { artist: null, title: 'Группа крови' }
 */
export function parseFileName(fileName: string): ParsedName {
  let base = stripJunk(stripExtension(fileName)).replace(/_/g, ' ').trim()
  let trackNo: number | null = null
  const num = base.match(/^(\d{1,3})(?:\s*[.)\-–—]\s*|\s+)(?=\S)/)
  if (num && !/^\d{4}\b/.test(base)) {
    trackNo = Number(num[1])
    base = base.slice(num[0].length)
  }
  const parts = base.split(/\s+[-–—]\s+/)
  if (parts.length >= 2) {
    const artist = parts[0]!.trim()
    const title = parts.slice(1).join(' - ').trim()
    if (artist && title) return { artist, title, trackNo }
  }
  return { artist: null, title: base.trim() || fileName, trackNo }
}

const SPLIT_ARTISTS = /\s*(?:,|;|\s&\s|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+при\s+уч(?:\.|астии)\s+)\s*/i

/** «Скриптонит feat. 104» → ['Скриптонит', '104'] */
export function splitArtists(artist: string | null | undefined): string[] {
  if (!artist) return []
  return artist
    .split(SPLIT_ARTISTS)
    .map((s) => s.trim())
    .filter((s, i, arr) => s.length > 0 && arr.indexOf(s) === i)
}

/** Ключ для сравнения строк: регистр, ё, пунктуация */
export function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Первая буква для алфавитного скроллера и генеративной обложки */
export function initialOf(s: string): string {
  const m = s.match(/[\p{L}\p{N}]/u)
  return m ? m[0].toUpperCase() : '#'
}
