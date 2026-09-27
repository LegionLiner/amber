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
