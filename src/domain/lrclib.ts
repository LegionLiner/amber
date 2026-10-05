/**
 * Тексты песен из открытой базы LRCLIB (lrclib.net): синхронные (LRC) и обычные.
 * Здесь — выбор подходящего варианта и формат хранения; сами запросы — в data/lrclib.ts.
 *
 * Найденный текст сохраняется как свой (таблица lyrics) с меткой «[re:LRCLIB #id]» в первой строке:
 * плеер и разбор LRC её пропускают, а по ней видно, откуда текст, и его можно заменить другим вариантом.
 */

export interface LrclibRecord {
  id: number
  trackName: string
  artistName: string
  albumName: string | null
  /** секунды */
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

export interface LyricsQuery {
  title: string
  artist: string
  album?: string | null
  durationMs: number
}

const MARK = /^\[re:LRCLIB #(\d+)\]\s*\n?/

/** Сравнение без регистра, ё/е, знаков и пометок в скобках («(Remastered 2011)», «[Live]») */
export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/\b(feat|ft)\.?\s.*$/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const hasText = (r: LrclibRecord) => !!(r.syncedLyrics?.trim() || r.plainLyrics?.trim())

/**
 * Насколько вариант подходит треку: совпадение названия и исполнителя, близость длительности,
 * синхронный текст лучше обычного. Чем меньше, тем лучше; Infinity — не подходит совсем.
 */
export function score(r: LrclibRecord, q: LyricsQuery): number {
  if (!hasText(r) && !r.instrumental) return Infinity
  const dt = Math.abs(r.duration * 1000 - q.durationMs) / 1000
  if (q.durationMs > 0 && dt > 20) return Infinity
  let s = q.durationMs > 0 ? dt : 5
  const t = normTitle(r.trackName)
  const qt = normTitle(q.title)
  if (t !== qt) s += t.includes(qt) || qt.includes(t) ? 4 : 15
  const a = normTitle(r.artistName)
  const qa = normTitle(q.artist)
  if (qa && a !== qa) s += a.includes(qa) || qa.includes(a) ? 3 : 10
  if (!r.syncedLyrics?.trim()) s += 3
  if (r.instrumental) s += 8
  return s
}

/** Подставлять сам можно только похожий вариант: название и исполнитель совпадают, длительность близка */
export const AUTO_MAX = 12

/** Варианты от лучшего к худшему, без неподходящих */
export function rank(list: LrclibRecord[], q: LyricsQuery): LrclibRecord[] {
  return list
    .map((r) => ({ r, s: score(r, q) }))
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => a.s - b.s)
    .map((x) => x.r)
}

/** Текст для сохранения: синхронный, если есть; с меткой источника */
export function toSaved(r: LrclibRecord): string | null {
  const body = r.syncedLyrics?.trim() || r.plainLyrics?.trim()
  if (!body) return null
  return `[re:LRCLIB #${r.id}]\n${body}`
}

/** Номер варианта LRCLIB, если текст оттуда */
export function lrclibId(saved: string | null | undefined): number | null {
  const m = saved ? MARK.exec(saved) : null
  return m ? Number(m[1]) : null
}
