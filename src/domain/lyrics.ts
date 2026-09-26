/**
 * Тексты песен. Синхронный текст — формат LRC: «[01:23.45]строка», у строки может быть
 * несколько меток времени, [offset:+200] сдвигает всё. Без меток — обычный текст.
 */

export interface LyricLine {
  t: number
  line: string
}

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

export function parseLrc(text: string): LyricLine[] | null {
  let offset = 0
  const out: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]/i)
    if (off) {
      offset = Number(off[1])
      continue
    }
    const stamps: number[] = []
    let rest = raw
    TIME.lastIndex = 0
    let m: RegExpExecArray | null
    let lastEnd = 0
    while ((m = TIME.exec(raw)) && m.index === lastEnd) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0
      stamps.push(Number(m[1]) * 60_000 + Number(m[2]) * 1000 + frac)
      lastEnd = TIME.lastIndex
    }
    if (!stamps.length) continue
    rest = raw.slice(lastEnd).trim()
    for (const t of stamps) out.push({ t: Math.max(0, t - offset), line: rest })
  }
  if (out.length < 2) return null
  return out.sort((a, b) => a.t - b.t)
}

/** Индекс текущей строки для позиции (двоичный поиск) */
export function lineAt(lines: LyricLine[], pos: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid]!.t <= pos) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** Обычный текст без меток LRC и служебных тегов */
export function plainText(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !/^\[(ar|ti|al|by|offset|length|re|ve):/i.test(l))
    .map((l) => l.replace(TIME, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
