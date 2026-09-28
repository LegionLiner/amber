/**
 * Цвета фона плеера из обложки.
 *
 * Раньше их выбирал Palette на телефоне: «самый сочный» оттенок, даже если это прядь волос на краю кадра,
 * а потом фон ещё и досыщался — серая обложка получала цветные пятна, лавандовая — рыжие.
 * Здесь считается то, что видит глаз: какой цвет занимает больше площади. Расчёт в OKLab
 * (перцептивное пространство: одинаковые числа — одинаково заметная разница).
 *
 * — Почти бесцветная обложка (чёрно-белое фото) даёт серые тона со слабым собственным оттенком.
 * — Иначе цвета группируются по тону; основной — тон с наибольшим весом (площадь × насыщенность),
 *   второй — другой заметный тон, а если его нет — светлый или тёмный вариант основного.
 * — Белые и чёрные поля (рамка, фон вокруг фото) цвета не задают, но и не перекрашиваются.
 */

export interface Lab {
  L: number
  a: number
  b: number
}

const lin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
const unlin = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, c)) * 255)
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

function labToRgb({ L, a, b }: Lab): [number, number, number] | null {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const e = 0.0005
  if (R < -e || R > 1 + e || G < -e || G > 1 + e || B < -e || B > 1 + e) return null
  return [unlin(R), unlin(G), unlin(B)]
}

/** OKLCH → hex; если цвет не помещается в sRGB, насыщенность уменьшается до границы */
export function lchHex(L: number, C: number, h: number): string {
  let c = C
  for (let i = 0; i < 24; i++) {
    const rgb = labToRgb({ L, a: c * Math.cos(h), b: c * Math.sin(h) })
    if (rgb) return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
    c *= 0.85
  }
  const g = labToRgb({ L, a: 0, b: 0 }) ?? [128, 128, 128]
  return '#' + g.map((v) => v.toString(16).padStart(2, '0')).join('')
}

export function hexToLch(hex: string): { L: number; C: number; h: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  const { L, a, b } = rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255)
  return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) }
}

export interface CoverTones {
  /** Основной тон (OKLCH) */
  c1: { L: number; C: number; h: number }
  c2: { L: number; C: number; h: number }
  /** Обложка почти бесцветная */
  neutral: boolean
}

/** Порог «цветной» точки: у серых фото с оттенком плёнки C ≈ 0.01–0.025 */
const CHROMA = 0.04
const BINS = 24

/** pixels — RGBA, как из getImageData */
export function coverTones(pixels: Uint8ClampedArray | number[]): CoverTones | null {
  const n = Math.floor(pixels.length / 4)
  let total = 0
  let colored = 0
  let sumA = 0
  let sumB = 0
  const Ls: number[] = []
  const wBin = new Float64Array(BINS)
  const lBin = new Float64Array(BINS)
  const aBin = new Float64Array(BINS)
  const bBin = new Float64Array(BINS)
  const px: { L: number; a: number; b: number; C: number; bin: number }[] = []
  for (let i = 0; i < n; i++) {
    if ((pixels[i * 4 + 3] ?? 255) < 128) continue
    const lab = rgbToLab(pixels[i * 4]!, pixels[i * 4 + 1]!, pixels[i * 4 + 2]!)
    const C = Math.hypot(lab.a, lab.b)
    total++
    Ls.push(lab.L)
    sumA += lab.a
    sumB += lab.b
    if (C < CHROMA) continue
    colored++
    const h = Math.atan2(lab.b, lab.a)
    const bin = Math.floor(((((h / (2 * Math.PI)) % 1) + 1) % 1) * BINS) % BINS
    // Вес — площадь, чуть усиленная насыщенностью: крупное блёклое пятно важнее мелкой яркой детали,
    // но из двух одинаковых по площади цвет заметнее
    const w = 0.6 + C * 4
    wBin[bin] += w
    lBin[bin] += lab.L * w
    aBin[bin] += lab.a * w
    bBin[bin] += lab.b * w
    px.push({ ...lab, C, bin })
  }
  if (!total) return null
  Ls.sort((x, y) => x - y)
  const q = (p: number) => Ls[Math.min(Ls.length - 1, Math.floor(p * Ls.length))]!

  // Цветного меньше 6 % площади — обложка по сути чёрно-белая
  if (colored / total < 0.06) {
    const tint = Math.min(0.012, Math.hypot(sumA / total, sumB / total))
    const h = Math.atan2(sumB, sumA)
    return {
      c1: { L: q(0.3), C: tint, h },
      c2: { L: q(0.75), C: tint, h },
      neutral: true,
    }
  }

  // Тоновые группы: сглаженная по кругу гистограмма, пик — основной тон
  const smooth = (i: number) => wBin[(i + BINS - 1) % BINS]! + 2 * wBin[i]! + wBin[(i + 1) % BINS]!
  const peaks = [...Array(BINS).keys()].sort((x, y) => smooth(y) - smooth(x))
  const p1 = peaks[0]!
  const group = (p: number) => {
    let w = 0
    let L = 0
    let a = 0
    let b = 0
    for (const d of [-1, 0, 1]) {
      const i = (p + d + BINS) % BINS
      w += wBin[i]!
      L += lBin[i]!
      a += aBin[i]!
      b += bBin[i]!
    }
    return { w, L: L / w, C: Math.hypot(a / w, b / w), h: Math.atan2(b, a) }
  }
  const g1 = group(p1)
  const dist = (x: number, y: number) => Math.min(Math.abs(x - y), BINS - Math.abs(x - y))
  const p2 = peaks.find((p) => dist(p, p1) >= 3 && smooth(p) > 0)
  const g2 = p2 != null ? group(p2) : null
  if (g2 && g2.w >= g1.w * 0.3) return { c1: g1, c2: g2, neutral: false }

  // Второго заметного тона нет: светлая или тёмная сторона того же тона
  let lw = 0
  let lL = 0
  let dw = 0
  let dL = 0
  for (const p of px) {
    if (dist(p.bin, p1) > 1) continue
    if (p.L >= g1.L) {
      lw++
      lL += p.L
    } else {
      dw++
      dL += p.L
    }
  }
  const light = lw ? lL / lw : g1.L
  const dark = dw ? dL / dw : g1.L
  const L2 = Math.abs(light - g1.L) >= Math.abs(g1.L - dark) ? light : dark
  const far = Math.abs(L2 - g1.L) < 0.1 ? (g1.L > 0.6 ? g1.L - 0.16 : g1.L + 0.16) : L2
  return { c1: g1, c2: { L: far, C: g1.C * 0.85, h: g1.h }, neutral: false }
}

/**
 * Тон для пятна фона: яркость подтянута к середине, чтобы пятно было видно на тёмной и на светлой теме;
 * насыщенность — своя, с небольшим запасом, но не выдуманная: серое остаётся серым.
 */
export function glow(t: { L: number; C: number; h: number }, minL = 0.56, maxL = 0.74): string {
  const L = Math.min(maxL, Math.max(minL, t.L))
  const C = t.C < CHROMA ? t.C : Math.min(0.22, t.C * 1.2 + 0.02)
  return lchHex(L, C, t.h)
}
