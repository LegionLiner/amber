/** Пары цветов для генеративных обложек и фона плеера, если у трека нет своей картинки */
export const COVER_PAIRS: [string, string][] = [
  ['#1d4b4f', '#d9b26a'],
  ['#5b1320', '#f08a3c'],
  ['#101b3a', '#8fb4d9'],
  ['#3a3f1c', '#d8d2a4'],
  ['#2b1b2e', '#c9786e'],
  ['#191919', '#e3a13c'],
  ['#0f2e24', '#62b38e'],
  ['#3b2412', '#e8c39a'],
]

export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h
}

export function coverPair(seed: string): [string, string] {
  return COVER_PAIRS[hashString(seed) % COVER_PAIRS.length]!
}

export function coverGradient(seed: string): string {
  const h = hashString(seed)
  const [a, b] = COVER_PAIRS[h % COVER_PAIRS.length]!
  return `linear-gradient(${110 + (h % 70)}deg, ${a}, ${b})`
}

/** Цвета для живого фона: из обложки, если движок их вынул, иначе из генеративной пары */
export function ambientColors(color1: string | null, color2: string | null, seed: string): [string, string] {
  if (color1) return [color1, color2 ?? color1]
  return coverPair(seed)
}

/**
 * Цвета эпох и контекстов: 18 оттенков (подобраны так, чтобы читались на тёмной и светлой теме)
 * и «свой» — системный выбор любого цвета.
 */
export const TINTS = [
  '#ff9a3e',
  '#ff7a2f',
  '#ffc23d',
  '#e8d44d',
  '#c9b458',
  '#9bd65a',
  '#4cc38a',
  '#2fbf8f',
  '#1fb6b0',
  '#3ec7f0',
  '#3e9bff',
  '#5b6cff',
  '#8e6cf0',
  '#b46cf0',
  '#e56cc9',
  '#ff6b9a',
  '#e5484d',
  '#a1887f',
]

/**
 * Цвет для фоновых пятен плеера: из обложки берутся тёмный и светлый насыщенные оттенки,
 * и тёмный на тёмном фоне почти не виден. Здесь яркость подтягивается к середине, насыщенность —
 * не ниже заданной, тон остаётся тем же. Серые обложки остаются спокойными (s = 0 не раскрашиваем).
 */
export function vivid(hex: string, minL = 0.5, maxL = 0.64, minS = 0.62): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  let l = (max + min) / 2
  const d = max - min
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  l = Math.min(maxL, Math.max(minL, l))
  if (s > 0.08) s = Math.max(minS, s)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const mm = l - c / 2
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const hx = (v: number) =>
    Math.round((v + mm) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hx(r1)}${hx(g1)}${hx(b1)}`
}
