import { nativeImage, type NativeImage } from 'electron'

/**
 * Значки для кнопок в миниатюре окна на панели задач. Рисуются здесь же из простых многоугольников,
 * без файлов-картинок: белые фигуры со сглаживанием, 16 px и вдвое крупнее для экранов с масштабом.
 */
type Poly = [number, number][]

const SHAPES: Record<'play' | 'pause' | 'next' | 'prev', Poly[]> = {
  play: [
    [
      [4.5, 2.5],
      [13.5, 8],
      [4.5, 13.5],
    ],
  ],
  pause: [
    [
      [4, 2.5],
      [6.8, 2.5],
      [6.8, 13.5],
      [4, 13.5],
    ],
    [
      [9.2, 2.5],
      [12, 2.5],
      [12, 13.5],
      [9.2, 13.5],
    ],
  ],
  next: [
    [
      [3, 3],
      [10.5, 8],
      [3, 13],
    ],
    [
      [11, 3],
      [13, 3],
      [13, 13],
      [11, 13],
    ],
  ],
  prev: [
    [
      [13, 3],
      [5.5, 8],
      [13, 13],
    ],
    [
      [3, 3],
      [5, 3],
      [5, 13],
      [3, 13],
    ],
  ],
}

function inside(poly: Poly, x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!
    const [xj, yj] = poly[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

function raster(polys: Poly[], px: number): Buffer {
  const buf = Buffer.alloc(px * px * 4)
  const k = px / 16
  const ss = 4
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      let n = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = (x + (sx + 0.5) / ss) / k
          const fy = (y + (sy + 0.5) / ss) / k
          if (polys.some((p) => inside(p, fx, fy))) n++
        }
      }
      const a = Math.round((n / (ss * ss)) * 255)
      const o = (y * px + x) * 4
      // BGRA, цвет с предумножением на прозрачность
      buf[o] = a
      buf[o + 1] = a
      buf[o + 2] = a
      buf[o + 3] = a
    }
  }
  return buf
}

let cache: Record<keyof typeof SHAPES, NativeImage> | null = null

export function thumbIcons(): Record<keyof typeof SHAPES, NativeImage> {
  if (cache) return cache
  const make = (name: keyof typeof SHAPES) => {
    const img = nativeImage.createFromBitmap(raster(SHAPES[name], 16), { width: 16, height: 16, scaleFactor: 1 })
    img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: raster(SHAPES[name], 32) })
    return img
  }
  cache = { play: make('play'), pause: make('pause'), next: make('next'), prev: make('prev') }
  return cache
}
