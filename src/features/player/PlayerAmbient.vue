<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { coverAccents, paletteOf, type Glow } from '@/app/cover-colors'
import { motionReduced } from '@/app/motion'

/**
 * Живой фон большого плеера из красок обложки — «жидкое стекло»:
 *  - пять мягких пятен (две основные краски обложки, её акценты) плывут по своим медленным петлям;
 *  - поверх — «сияние»: широкий конический перелив тех же красок, медленно поворачивается;
 *  - мелкое зерно — фон читается как матовое стекло, а не как заливка.
 * Никаких предметов на фоне — только свет и цвет.
 *
 * Рисуется в маленький холст (шестая часть экрана) и растягивается на весь экран: растяжение и даёт мягкость.
 * Раньше пятна были отдельными слоями в полтора экрана — на телефоне с плотным экраном это огромные текстуры,
 * видеокарта не успевала, и первые секунды фон шёл блоками, а кнопки и иконки пропадали. Холст — одна маленькая
 * текстура, рисуется 30 раз в секунду, только пока играет музыка; на паузе фон замирает.
 * При «меньше движения» и выключенном стекле — неподвижный кадр. Новый трек перетекает в свои краски.
 */
const props = defineProps<{ colors: Glow; art?: string | null; playing: boolean }>()

const accents = ref<string[]>([])
let token = 0
watch(
  () => props.art,
  async (art) => {
    const t = ++token
    const a = art ? await coverAccents(art).catch(() => []) : []
    if (t === token) accents.value = a
  },
  { immediate: true },
)
const palette = computed(() => paletteOf(props.colors, accents.value))

/* ---------------- краски и их перетекание ---------------- */
type RGB = [number, number, number]
const rgbOf = (hex: string): RGB => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128]
}
const MIX_MS = 1400
let fromRgb: RGB[] = palette.value.map(rgbOf)
let toRgb: RGB[] = fromRgb
let mixAt = 0
function colorsNow(now: number): RGB[] {
  const k = Math.min(1, (now - mixAt) / MIX_MS)
  const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
  return toRgb.map((c, i) => c.map((v, j) => Math.round(fromRgb[i]![j]! + (v - fromRgb[i]![j]!) * e)) as RGB)
}
watch(palette, (p) => {
  const now = performance.now()
  fromRgb = colorsNow(now)
  toRgb = p.map(rgbOf)
  mixAt = now
  wake()
})

/* ---------------- рисование ---------------- */
/** Пятно: краска, центр (доли ширины и высоты), радиус (доля большей стороны), ход, периоды, прозрачность */
const BLOBS = [
  { c: 0, x: 0.2, y: 0.15, r: 0.62, ax: 0.24, ay: 0.16, tx: 19, ty: 24, a: 0.95, al: 0.6 },
  { c: 1, x: 0.85, y: 0.38, r: 0.52, ax: 0.22, ay: 0.2, tx: 22, ty: 17, a: 0.85, al: 0.5 },
  { c: 2, x: 0.45, y: 0.45, r: 0.42, ax: 0.28, ay: 0.18, tx: 16, ty: 21, a: 0.65, al: 0.38 },
  { c: 3, x: 0.82, y: 0.88, r: 0.45, ax: 0.2, ay: 0.2, tx: 25, ty: 15, a: 0.6, al: 0.38 },
  { c: 4, x: 0.15, y: 0.82, r: 0.38, ax: 0.22, ay: 0.16, tx: 20, ty: 26, a: 0.55, al: 0.38 },
]
/** Холст в шесть раз меньше экрана: на телефоне это около 70×150 точек */
const SCALE = 6
const FRAME_MS = 33

const canvas = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
const off = document.createElement('canvas')
const offCtx = off.getContext('2d')
let raf = 0
let lastFrame = 0
/** Сколько секунд фон «прожил» в движении: на паузе не идёт, поэтому после паузы всё продолжается с того же места */
let t = Math.random() * 600
let bg = '#0e0d0c'
let light = false
let readAt = 0
let still = false

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

function readTheme(now: number) {
  if (now - readAt < 1000) return
  readAt = now
  const root = document.documentElement
  bg = getComputedStyle(root).getPropertyValue('--bg').trim() || bg
  light = root.dataset.theme === 'light'
  still = motionReduced() || root.dataset.glass === 'low'
}

function draw(now: number) {
  const c = canvas.value
  if (!c || !ctx) return
  const w = c.width
  const h = c.height
  const m = Math.max(w, h)
  const pal = colorsNow(now)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // Пятна: плотная середина, мягкий край, как размытый круг. На светлой теме краска «умножается» на фон
  ctx.globalCompositeOperation = light ? 'multiply' : 'source-over'
  for (const b of BLOBS) {
    const col = pal[b.c]!
    // Основная петля плюс второй, медленный изгиб пути: пятна текут, а не качаются туда-обратно
    const k = 2 * Math.PI * t
    const x = (b.x + b.ax * Math.sin(k / b.tx + b.c) + b.ax * 0.35 * Math.sin(k / (b.ty * 2.3) + b.c * 2.1)) * w
    const y = (b.y + b.ay * Math.sin(k / b.ty + b.c * 1.7) + b.ay * 0.35 * Math.cos(k / (b.tx * 2.7) + b.c)) * h
    const r = b.r * m * (1 + 0.15 * Math.sin(k / (b.tx * 1.3) + b.c))
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rgba(col, 1))
    g.addColorStop(0.22, rgba(col, 1))
    g.addColorStop(0.64, rgba(col, 0.48))
    g.addColorStop(1, rgba(col, 0))
    ctx.globalAlpha = light ? b.al : b.a
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Сияние: конический перелив, середина и края растворены, оборот почти за минуту
  if (offCtx && 'createConicGradient' in offCtx) {
    off.width = w
    off.height = h
    const cx = w * 0.5
    const cy = h * 0.38
    const cg = offCtx.createConicGradient((2 * Math.PI * t) / 55, cx, cy)
    ;[0, 2, 1, 3, 4, 0].forEach((i, k) => cg.addColorStop(k / 5, rgba(pal[i]!, 1)))
    offCtx.globalCompositeOperation = 'source-over'
    offCtx.fillStyle = cg
    offCtx.fillRect(0, 0, w, h)
    const R = m * 0.75
    const mask = offCtx.createRadialGradient(cx, cy, 0, cx, cy, R)
    mask.addColorStop(0.08, 'rgba(0,0,0,0)')
    mask.addColorStop(0.34, 'rgba(0,0,0,1)')
    mask.addColorStop(0.58, 'rgba(0,0,0,0.5)')
    mask.addColorStop(0.74, 'rgba(0,0,0,0)')
    offCtx.globalCompositeOperation = 'destination-in'
    offCtx.fillStyle = mask
    offCtx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = light ? 'multiply' : 'soft-light'
    ctx.globalAlpha = light ? 0.2 : 0.5
    ctx.drawImage(off, 0, 0)
  }
}

function frame(now: number) {
  raf = 0
  readTheme(now)
  const mixing = now - mixAt < MIX_MS
  const moving = props.playing && !still && document.visibilityState === 'visible'
  if (now - lastFrame >= FRAME_MS || !lastFrame) {
    if (moving && lastFrame) t += Math.min(0.1, (now - lastFrame) / 1000)
    lastFrame = now
    draw(now)
  }
  // Рисуем дальше, только пока что-то меняется: на паузе и в неподвижном режиме — ни одного лишнего кадра
  if (moving || mixing) raf = requestAnimationFrame(frame)
  else lastFrame = 0
}

function wake() {
  if (!raf) raf = requestAnimationFrame(frame)
}

let ro: ResizeObserver | null = null
function fit() {
  const c = canvas.value
  if (!c) return
  const w = Math.max(24, Math.round(c.clientWidth / SCALE))
  const h = Math.max(24, Math.round(c.clientHeight / SCALE))
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
    readAt = 0
    lastFrame = 0
    wake()
  }
}

onMounted(() => {
  ctx = canvas.value?.getContext('2d', { alpha: false }) ?? null
  ro = new ResizeObserver(fit)
  if (canvas.value) ro.observe(canvas.value)
  fit()
  wake()
  document.addEventListener('visibilitychange', wake)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  document.removeEventListener('visibilitychange', wake)
})
watch(
  () => props.playing,
  () => {
    lastFrame = 0
    wake()
  },
)
</script>

<template>
  <div class="ambient" aria-hidden="true">
    <canvas ref="canvas" class="paint" />
    <i class="grain" />
    <div class="veil" />
  </div>
</template>

<style scoped>
.ambient {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--bg);
}
/* Маленький холст на весь экран: сглаживание при растяжении и есть мягкость пятен */
.paint {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/* ---- зерно: матовое стекло, а не гладкая заливка (и не видно ступенек в переходах цвета) ---- */
.grain {
  position: absolute;
  inset: 0;
  opacity: 0.06;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  pointer-events: none;
}

/* Затемнение к низу: под управлением текст читается на любой обложке */
.veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg) 10%, transparent) 0%,
    color-mix(in srgb, var(--bg) 25%, transparent) 40%,
    color-mix(in srgb, var(--bg) 70%, transparent) 68%,
    var(--bg) 94%
  );
}

[data-theme='light'] .grain {
  filter: invert(1);
  opacity: 0.05;
}
</style>
