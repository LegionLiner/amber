<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CoverArt from '@/components/CoverArt.vue'
import { coverAccents, paletteOf, useCoverGlow } from '@/app/cover-colors'
import { BeatFollower, type Beat } from '@/app/beat'
import { motionReduced } from '@/app/motion'
import { isDesktop } from '@/native/desktop/bridge'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'

/**
 * «Сцена»: на весь экран — только обложка, вокруг неё свет и цвет из её же красок.
 *  - большие мягкие пятна плывут по краям экрана и дышат громкостью;
 *  - вокруг обложки — ореол из двух огней разного цвета, они медленно обходят её по кругу и вспыхивают на басах;
 *  - снизу — свечение баса, как в свёрнутом плеере на компьютере, только шире и ярче;
 *  - сияние: конический перелив красок, крутится быстрее, когда в музыке много середины;
 *  - сверху — мягкий «прожектор», мерцает от верхов (тарелки, хэты).
 * Ни предметов, ни линий — только свет. Выход — щелчок мимо обложки или Esc.
 *
 * Звук разбирает анализатор звукового графа (только компьютер, app/beat.ts). На телефоне звук играет
 * нативный движок и до страницы не доходит — там свет просто медленно дышит.
 * Рисуется в маленький холст и растягивается на весь экран, как фон большого плеера (PlayerAmbient).
 */
const player = usePlayer()
const ui = useUi()

const item = computed(() => player.current)
const track = computed(() => player.currentTrack)
const colors = useCoverGlow(() => ({
  art: track.value?.art,
  seed: item.value?.title ?? '',
  color1: track.value?.color1,
  color2: track.value?.color2,
}))
const accents = ref<string[]>([])
let token = 0
watch(
  () => track.value?.art,
  async (art) => {
    const t = ++token
    const a = art ? await coverAccents(art).catch(() => []) : []
    if (t === token) accents.value = a
  },
  { immediate: true },
)
const palette = computed(() => paletteOf(colors.value, accents.value))

/* ---------------- краски и их перетекание ---------------- */
type RGB = [number, number, number]
const rgbOf = (hex: string): RGB => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128]
}
const MIX_MS = 1800
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
})
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`
/** Краска посветлее — для огней: тёмная обложка всё равно должна светиться */
const lift = (c: RGB, k: number): RGB => [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k]

/* ---------------- рисование ---------------- */
/** Пятна держатся ближе к краям — середину занимает обложка со своим ореолом */
const BLOBS = [
  { c: 0, x: 0.08, y: 0.14, r: 0.46, ax: 0.14, ay: 0.18, tx: 23, ty: 29, a: 0.62 },
  { c: 1, x: 0.92, y: 0.2, r: 0.42, ax: 0.12, ay: 0.2, tx: 27, ty: 21, a: 0.58 },
  { c: 2, x: 0.88, y: 0.86, r: 0.42, ax: 0.16, ay: 0.14, tx: 19, ty: 25, a: 0.5 },
  { c: 3, x: 0.1, y: 0.88, r: 0.4, ax: 0.14, ay: 0.16, tx: 31, ty: 23, a: 0.5 },
  { c: 4, x: 0.5, y: 0.02, r: 0.34, ax: 0.3, ay: 0.06, tx: 35, ty: 17, a: 0.4 },
]
const SCALE = isDesktop ? 5 : 6
const FRAME_MS = isDesktop ? 15 : 33

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const coverEl = ref<HTMLElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
const off = document.createElement('canvas')
const offCtx = off.getContext('2d')
let raf = 0
let lastFrame = 0
let t = Math.random() * 600
/** Скорость жизни фона: на паузе всё замедляется, но не замирает — это всё-таки сцена */
let speed = 1
let coverR = 0
const still = motionReduced()
const beat = new BeatFollower()
let level: Beat = { hit: 0, loud: 0, mid: 0, high: 0 }

function draw(now: number, b: Beat) {
  const c = canvas.value
  if (!c || !ctx) return
  const w = c.width
  const h = c.height
  const m = Math.max(w, h)
  const pal = colorsNow(now)
  const k = 2 * Math.PI * t
  const breath = 0.5 + 0.5 * Math.sin(k / 7)
  const pulse = Math.min(1, 0.12 * breath + 0.3 * b.loud + 0.85 * b.hit)
  const cx = w / 2
  const cy = h / 2
  const R = coverR || m * 0.3

  // Основа: почти чёрный с оттенком главной краски
  const base = pal[0]!
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = `rgb(${Math.round(base[0] * 0.08 + 3)},${Math.round(base[1] * 0.08 + 3)},${Math.round(base[2] * 0.08 + 5)})`
  ctx.fillRect(0, 0, w, h)

  // Пятна: широкие петли, дышат громкостью
  for (const p of BLOBS) {
    const col = pal[p.c]!
    const x = (p.x + p.ax * Math.sin(k / p.tx + p.c) + p.ax * 0.4 * Math.sin(k / (p.ty * 2.3) + p.c * 2.1)) * w
    const y = (p.y + p.ay * Math.sin(k / p.ty + p.c * 1.7) + p.ay * 0.4 * Math.cos(k / (p.tx * 2.7) + p.c)) * h
    const r = p.r * m * (1 + 0.18 * Math.sin(k / (p.tx * 1.3) + p.c) + 0.12 * pulse)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rgba(col, 1))
    g.addColorStop(0.35, rgba(col, 0.6))
    g.addColorStop(1, rgba(col, 0))
    ctx.globalAlpha = p.a * (0.6 + 0.4 * b.loud)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Сияние вокруг обложки: конический перелив, крутится быстрее от середины
  if (offCtx && 'createConicGradient' in offCtx) {
    off.width = w
    off.height = h
    const cg = offCtx.createConicGradient(k / 40 + b.mid * 0.6, cx, cy)
    ;[0, 2, 1, 3, 4, 0].forEach((i, n) => cg.addColorStop(n / 5, rgba(lift(pal[i]!, 0.15), 1)))
    offCtx.globalCompositeOperation = 'source-over'
    offCtx.fillStyle = cg
    offCtx.fillRect(0, 0, w, h)
    const mask = offCtx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * (3 + 0.6 * pulse))
    mask.addColorStop(0, 'rgba(0,0,0,1)')
    mask.addColorStop(0.35, 'rgba(0,0,0,0.6)')
    mask.addColorStop(1, 'rgba(0,0,0,0)')
    offCtx.globalCompositeOperation = 'destination-in'
    offCtx.fillStyle = mask
    offCtx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = 0.16 + 0.24 * b.loud
    ctx.drawImage(off, 0, 0)
  }

  // Ореол: два огня разного цвета медленно обходят обложку, на басах вспыхивают и расходятся шире
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 2; i++) {
    const a = k / 26 + i * Math.PI
    const col = lift(pal[i === 0 ? 0 : 1]!, 0.25)
    const x = cx + Math.cos(a) * R * 0.35
    const y = cy + Math.sin(a) * R * 0.3
    const r = R * (1.5 + 0.6 * pulse)
    const g = ctx.createRadialGradient(x, y, R * 0.6, x, y, r)
    g.addColorStop(0, rgba(col, 0.9))
    g.addColorStop(0.4, rgba(col, 0.35))
    g.addColorStop(1, rgba(col, 0))
    ctx.globalAlpha = 0.2 + 0.5 * pulse
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Бас снизу: широкое свечение, удар — вверх и ярче
  {
    const col = lift(pal[0]!, 0.2)
    const col2 = lift(pal[2]!, 0.1)
    const bx = cx + Math.sin(k / 33) * w * 0.12
    const rx = w * (0.55 + 0.25 * pulse)
    ctx.save()
    ctx.translate(bx, h * 1.04)
    ctx.scale(1, (h * (0.22 + 0.26 * pulse)) / rx)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
    g.addColorStop(0, rgba(col, 0.95))
    g.addColorStop(0.4, rgba(col2, 0.5))
    g.addColorStop(1, rgba(col2, 0))
    ctx.globalAlpha = 0.1 + 0.9 * pulse
    ctx.fillStyle = g
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2)
    ctx.restore()
  }

  // Прожектор сверху: мерцает от верхов
  {
    const col = lift(pal[3]!, 0.5)
    const x = cx + Math.sin(k / 21) * w * 0.25
    const g = ctx.createRadialGradient(x, -h * 0.15, 0, x, -h * 0.15, m * 0.6)
    g.addColorStop(0, rgba(col, 0.8))
    g.addColorStop(1, rgba(col, 0))
    ctx.globalAlpha = 0.05 + 0.22 * b.high
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Края в тень: свет собирается к середине
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  const v = ctx.createRadialGradient(cx, cy, m * 0.28, cx, cy, m * 0.78)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.7)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)

  root.value?.style.setProperty('--zp', pulse.toFixed(3))
}

function frame(now: number) {
  raf = requestAnimationFrame(frame)
  if (lastFrame && now - lastFrame < FRAME_MS) return
  const dt = lastFrame ? Math.min(100, now - lastFrame) : 16
  lastFrame = now
  if (document.visibilityState !== 'visible') return
  const playing = player.playing
  speed += ((playing ? 1 : 0.2) - speed) * (1 - Math.exp(-dt / 800))
  level = still ? { hit: 0, loud: 0, mid: 0, high: 0 } : beat.update(dt)
  if (!still) t += (dt / 1000) * speed * (1 + 0.5 * level.mid)
  draw(now, level)
}

/* ---------------- размеры ---------------- */
let ro: ResizeObserver | null = null
function fit() {
  const c = canvas.value
  if (!c) return
  const w = Math.max(24, Math.round(c.clientWidth / SCALE))
  const h = Math.max(24, Math.round(c.clientHeight / SCALE))
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  coverR = (coverEl.value?.getBoundingClientRect().width ?? 0) / 2 / SCALE
}

/* ---------------- выход и курсор ---------------- */
function close() {
  ui.zen = false
}
const idle = ref(false)
let idleTimer = 0
function stir() {
  idle.value = false
  clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => (idle.value = true), 2500)
}
// Компьютер: окно на весь экран. Вышли из полноэкранного (F11, системные клавиши) — выходим и из «Сцены»
let wentFull = false
function onFullscreen() {
  if (document.fullscreenElement) wentFull = true
  else if (wentFull) close()
}
// Трек закончился, а очередь пуста — сцене нечего показывать
watch(item, (v) => {
  if (!v) close()
})

onMounted(() => {
  ctx = canvas.value?.getContext('2d', { alpha: false }) ?? null
  ro = new ResizeObserver(fit)
  if (canvas.value) ro.observe(canvas.value)
  if (coverEl.value) ro.observe(coverEl.value)
  fit()
  raf = requestAnimationFrame(frame)
  stir()
  if (isDesktop) {
    document.addEventListener('fullscreenchange', onFullscreen)
    document.documentElement.requestFullscreen?.().catch(() => {})
  }
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  clearTimeout(idleTimer)
  if (isDesktop) {
    document.removeEventListener('fullscreenchange', onFullscreen)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }
})
</script>

<template>
  <div
    ref="root"
    class="zen"
    :class="{ idle }"
    role="dialog"
    aria-label="Сцена: обложка на весь экран. Щелчок мимо обложки — выход"
    @click="close"
    @pointermove="stir"
  >
    <canvas ref="canvas" class="paint" aria-hidden="true" />
    <i class="grain" aria-hidden="true" />
    <div ref="coverEl" class="art" @click.stop>
      <Transition name="zc">
        <div v-if="item" :key="item.qid" class="slot">
          <CoverArt :art="track?.art" :seed="item.title" :label="item.title" size="l" radius="var(--zr)" />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.zen {
  --zr: clamp(14px, 1.6vmin, 22px);
  --zp: 0;
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: #050506;
  cursor: default;
  /* Строка заголовка окна на компьютере таскает окно — здесь щелчок должен доходить до сцены */
  -webkit-app-region: no-drag;
}
.zen.idle {
  cursor: none;
}
.paint {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.grain {
  position: absolute;
  inset: 0;
  opacity: 0.07;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  pointer-events: none;
}
.art {
  position: relative;
  width: min(74vmin, 780px);
  aspect-ratio: 1;
  border-radius: var(--zr);
  /* Чуть подаётся вперёд на ударах баса */
  transform: scale(calc(1 + var(--zp) * 0.018));
  box-shadow:
    0 40px 120px rgba(0, 0, 0, 0.55),
    0 10px 30px rgba(0, 0, 0, 0.35);
  cursor: default;
}
.zen.idle .art {
  cursor: none;
}
.slot {
  position: absolute;
  inset: 0;
}
.slot > :deep(*) {
  width: 100%;
  height: 100%;
}

/* Новый трек — обложки перетекают одна в другую */
.zc-enter-active,
.zc-leave-active {
  transition:
    opacity 0.9s ease,
    transform 0.9s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.zc-enter-from {
  opacity: 0;
  transform: scale(0.97);
}
.zc-leave-to {
  opacity: 0;
  transform: scale(1.02);
}

@media (orientation: portrait) {
  .art {
    width: min(86vw, 780px);
  }
}
</style>
