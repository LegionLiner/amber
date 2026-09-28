import { ref, watch, type Ref } from 'vue'
import { coverSrc } from '@/native/paths'
import { coverTones, glow, hexToLch } from '@/domain/cover-colors'
import { coverPair } from '@/domain/palette'

/**
 * Цвета фона по обложке: маленькая версия обложки (160 px) рисуется в холст 40×40 и разбирается
 * в domain/cover-colors. Итог запоминается по хешу обложки — в памяти и в localStorage, так что
 * у знакомых альбомов фон готов сразу. Версия в ключе: сменится алгоритм — пересчитается всё.
 */
export type Glow = readonly [string, string]

const KEY = 'amber.coverGlow.v1'
const mem = new Map<string, Glow>()
let disk: Record<string, Glow> = {}
try {
  disk = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Glow>
} catch {
  disk = {}
}
let saveTimer = 0
function persist() {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      const entries = Object.entries(disk)
      if (entries.length > 800) disk = Object.fromEntries(entries.slice(-500))
      localStorage.setItem(KEY, JSON.stringify(disk))
    } catch {
      /* без localStorage посчитаем заново в следующий раз */
    }
  }, 500)
}

export function cachedGlow(art: string): Glow | null {
  return mem.get(art) ?? disk[art] ?? null
}

const pending = new Map<string, Promise<Glow | null>>()

/** Цвета фона для обложки; null — картинку не удалось прочитать */
export function coverGlow(art: string): Promise<Glow | null> {
  const hit = cachedGlow(art)
  if (hit) return Promise.resolve(hit)
  let p = pending.get(art)
  if (!p) {
    p = compute(art).finally(() => pending.delete(art))
    pending.set(art, p)
  }
  return p
}

async function compute(art: string): Promise<Glow | null> {
  const src = coverSrc(art, 's')
  if (!src) return null
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  try {
    await img.decode()
  } catch {
    return null
  }
  const S = 40
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, S, S)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, S, S).data
  } catch {
    return null
  }
  const t = coverTones(data)
  if (!t) return null
  const res: Glow = [glow(t.c1), glow(t.c2, 0.6, 0.78)]
  mem.set(art, res)
  disk[art] = res
  persist()
  return res
}

/** Цвета без обложки или если она не читается: сохранённые движком или генеративная пара */
function fallback(c1: string | null | undefined, c2: string | null | undefined, seed: string): Glow {
  const [a, b] = c1 ? [c1, c2 ?? c1] : coverPair(seed)
  const t = (hex: string) => hexToLch(hex) ?? { L: 0.6, C: 0.1, h: 1 }
  return [glow(t(a)), glow(t(b), 0.6, 0.78)]
}

/**
 * Живые цвета фона для экрана. Пока новая обложка разбирается (десятки миллисекунд), остаются прежние
 * цвета — фон не мигает промежуточным вариантом.
 */
export function useCoverGlow(
  source: () => { art?: string | null; seed: string; color1?: string | null; color2?: string | null },
): Ref<Glow> {
  const first = source()
  const colors = ref<Glow>((first.art && cachedGlow(first.art)) || fallback(first.color1, first.color2, first.seed)) as Ref<Glow>
  let token = 0
  watch(
    () => {
      const s = source()
      return [s.art ?? '', s.seed, s.color1 ?? '', s.color2 ?? ''] as const
    },
    async ([art, seed, c1, c2]) => {
      const t = ++token
      if (!art) {
        colors.value = fallback(c1, c2, seed)
        return
      }
      const hit = cachedGlow(art)
      if (hit) {
        colors.value = hit
        return
      }
      const g = await coverGlow(art)
      if (t === token) colors.value = g ?? fallback(c1, c2, seed)
    },
    { immediate: true },
  )
  return colors
}
