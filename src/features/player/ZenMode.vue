<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CoverArt from '@/components/CoverArt.vue'
import { coverAccents, paletteOf, useCoverGlow } from '@/app/cover-colors'
import { BeatFollower, type Beat } from '@/app/beat'
import { audioLevels } from '@/native/web/audio-graph'
import { motionReduced } from '@/app/motion'
import { isDesktop } from '@/native/desktop/bridge'
import { isNative } from '@/native/paths'
import { MusicCore } from '@/native/music-core'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { $t } from '@/i18n'

/**
 * «Сцена»: на весь экран — только обложка, вокруг неё свет и цвет из её же красок.
 * Каждая сторона дышит своим звуком:
 *  - низ — бас и барабаны: широкое свечение, на ударе поднимается и разгорается;
 *  - слева — середина (голос, гитары, клавишные);
 *  - справа — верха (тарелки, хэты, «воздух»);
 *  - сверху и вокруг обложки — спокойный свет и медленный перелив красок по общей громкости.
 * Краски — оттенки обложки и соседние с ними, яркость держится в спокойных пределах: свет цветной, а не белый.
 * Ни предметов, ни линий — только свет. Выход — щелчок мимо обложки или Esc.
 *
 * Звук разбирает анализатор звукового графа (только компьютер, app/beat.ts). На телефоне звук играет
 * нативный движок и до страницы не доходит — там стороны медленно дышат вразнобой.
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
type HSL = [number, number, number]
function hslOf([r, g, b]: RGB): HSL {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h * 60, s, l]
}
function rgbOfHsl([h, s, l]: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}
/**
 * Краска обложки для света: тот же оттенок (dh — сдвиг к соседнему цвету), яркость в пределах lo…hi.
 * Тёмная обложка всё равно светится, светлая не уходит в белое
 */
function tone(c: RGB, dh = 0, lo = 0.3, hi = 0.55): RGB {
  const [h, s, l] = hslOf(c)
  return rgbOfHsl([(h + dh + 360) % 360, Math.min(1, s * 1.1), Math.min(hi, Math.max(lo, l))])
}

/* ---------------- рисование ---------------- */
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
const QUIET: Beat = { hit: 0, kick: 0, loud: 0, low: 0, mid: 0, high: 0 }
let level: Beat = QUIET

/** Телефон: звука странице не видно — стороны дышат сами, медленно и вразнобой */
function idleBreath(): Beat {
  const k = 2 * Math.PI * t
  const w = (p: number, ph: number) => 0.35 + 0.3 * Math.sin(k / p + ph)
  return { hit: 0, kick: 0, loud: w(11, 0), low: w(7, 1), mid: w(9, 2.5), high: w(13, 4) }
}

/** Мягкое пятно света: плотная середина, растворённый край */
function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: RGB, alpha: number) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r)
  gr.addColorStop(0, rgba(col, 1))
  gr.addColorStop(0.4, rgba(col, 0.55))
  gr.addColorStop(1, rgba(col, 0))
  g.globalAlpha = Math.max(0, Math.min(1, alpha))
  g.fillStyle = gr
  g.fillRect(x - r, y - r, r * 2, r * 2)
}

/** Пятна по бокам: [краска палитры, высота центра, сдвиг оттенка, период движения, с] */
const LEFT = [
  [0, 0.3, -14, 23],
  [2, 0.72, 12, 29],
] as const
const RIGHT = [
  [1, 0.28, 14, 21],
  [3, 0.7, -12, 27],
] as const

function draw(now: number, b: Beat) {
  const c = canvas.value
  if (!c || !ctx) return
  const w = c.width
  const h = c.height
  const m = Math.max(w, h)
  const pal = colorsNow(now)
  const k = 2 * Math.PI * t
  const cx = w / 2
  const cy = h / 2
  const R = coverR || m * 0.3
  /** Низ: бас держит ровный уровень, бочка добавляет толчок */
  const bottom = Math.min(1, 0.55 * b.low + 0.7 * b.kick)
  const drift = (p: number, ph: number) => Math.sin(k / p + ph)

  // Основа: почти чёрный с оттенком главной краски
  const base = pal[0]!
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = `rgb(${Math.round(base[0] * 0.08 + 3)},${Math.round(base[1] * 0.08 + 3)},${Math.round(base[2] * 0.08 + 5)})`
  ctx.fillRect(0, 0, w, h)

  // Сверху — спокойный свет по общей громкости
  glow(ctx, w * (0.5 + 0.18 * drift(37, 0)), -h * 0.06, m * 0.42, tone(pal[4]!, 0, 0.25, 0.48), 0.3 + 0.15 * b.loud)

  // Слева дышит середина, справа — верха. Краски — оттенки обложки и их соседи по кругу цветов
  for (const [side, v] of [
    [LEFT, b.mid],
    [RIGHT, b.high],
  ] as const) {
    const right = side === RIGHT
    for (const [i, y, dh, p] of side) {
      const r = m * 0.34 * (1 + 0.3 * v + 0.06 * drift(p * 1.3, i))
      const dx = 0.04 * drift(p, i)
      const x = w * (right ? 0.98 - dx : 0.02 + dx)
      const yy = h * (y + 0.06 * drift(p * 1.7, i + 1))
      glow(ctx, x, yy, r, tone(pal[i]!, dh), 0.4 + 0.45 * v)
    }
  }

  // Перелив красок вокруг обложки: медленный, по общей громкости
  if (offCtx && 'createConicGradient' in offCtx) {
    off.width = w
    off.height = h
    const cg = offCtx.createConicGradient(k / 45, cx, cy)
    ;[0, 2, 1, 3, 4, 0].forEach((i, n) => cg.addColorStop(n / 5, rgba(tone(pal[i]!), 1)))
    offCtx.globalCompositeOperation = 'source-over'
    offCtx.fillStyle = cg
    offCtx.fillRect(0, 0, w, h)
    const mask = offCtx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 2.6)
    mask.addColorStop(0, 'rgba(0,0,0,1)')
    mask.addColorStop(0.4, 'rgba(0,0,0,0.5)')
    mask.addColorStop(1, 'rgba(0,0,0,0)')
    offCtx.globalCompositeOperation = 'destination-in'
    offCtx.fillStyle = mask
    offCtx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 0.22 + 0.13 * b.loud
    ctx.drawImage(off, 0, 0)
  }

  // Ореол: два огня обходят обложку по кругу, дышат общей громкостью
  ctx.globalCompositeOperation = 'screen'
  for (let i = 0; i < 2; i++) {
    const a = k / 26 + i * Math.PI
    const x = cx + Math.cos(a) * R * 0.35
    const y = cy + Math.sin(a) * R * 0.3
    glow(ctx, x, y, R * (1.5 + 0.15 * b.loud), tone(pal[i]!, 0, 0.3, 0.5), 0.16 + 0.14 * b.loud)
  }

  // Низ — бас и барабаны: свечение поднимается и разгорается на ударах
  {
    const bx = cx + drift(33, 0) * w * 0.1
    const rx = w * (0.55 + 0.2 * bottom)
    ctx.save()
    ctx.translate(bx, h * 1.04)
    ctx.scale(1, (h * (0.18 + 0.3 * bottom)) / rx)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
    g.addColorStop(0, rgba(tone(pal[0]!, 0, 0.35, 0.58), 1))
    g.addColorStop(0.45, rgba(tone(pal[2]!, 10, 0.3, 0.5), 0.55))
    g.addColorStop(1, rgba(tone(pal[2]!, 10), 0))
    ctx.globalAlpha = 0.2 + 0.65 * bottom
    ctx.fillStyle = g
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2)
    ctx.restore()
  }

  // Края в тень: свет собирается к середине
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  const v = ctx.createRadialGradient(cx, cy, m * 0.3, cx, cy, m * 0.8)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, w, h)

  // Уровни зон — в стиле корня: по ним обложка подаётся на басах (и их видно при проверке)
  const st = root.value?.style
  st?.setProperty('--zp', bottom.toFixed(3))
  st?.setProperty('--zm', b.mid.toFixed(3))
  st?.setProperty('--zh', b.high.toFixed(3))
}

function frame(now: number) {
  raf = requestAnimationFrame(frame)
  if (lastFrame && now - lastFrame < FRAME_MS) return
  const dt = lastFrame ? Math.min(100, now - lastFrame) : 16
  lastFrame = now
  if (document.visibilityState !== 'visible') return
  const playing = player.playing
  speed += ((playing ? 1 : 0.2) - speed) * (1 - Math.exp(-dt / 800))
  const l = audioLevels()
  level = still ? QUIET : l || isDesktop ? beat.update(dt, l) : idleBreath()
  if (!still) t += (dt / 1000) * speed * (1 + 0.3 * level.mid)
  draw(now, level)
}

/* ---------------- размеры ---------------- */
let ro: ResizeObserver | null = null
function fit() {
  const c = canvas.value
  if (!c) return
  const w = Math.max(24, Math.round(c.clientWidth / SCALE))
  const h = Math.max(24, Math.round(c.clientHeight / SCALE))
  const resized = c.width !== w || c.height !== h
  if (resized) {
    c.width = w
    c.height = h
  }
  coverR = (coverEl.value?.getBoundingClientRect().width ?? 0) / 2 / SCALE
  // Смена размера стирает холст (при повороте телефона экран на миг становился чёрным с обрезом):
  // рисуем сразу, в том же кадре, не дожидаясь следующего
  if (resized && ctx) draw(performance.now(), level)
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
  // Телефон: экран поворачивается за телефоном (лёжа обложка разворачивается), без системных полос и не гаснет
  if (isNative) void MusicCore.setStage({ on: true }).catch(() => {})
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  clearTimeout(idleTimer)
  if (isDesktop) {
    document.removeEventListener('fullscreenchange', onFullscreen)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }
  if (isNative) void MusicCore.setStage({ on: false }).catch(() => {})
})
</script>

<template>
  <div
    ref="root"
    class="zen"
    :class="{ idle }"
    role="dialog"
    :aria-label="$t('Сцена: обложка на весь экран. Щелчок мимо обложки — выход')"
    @click="close"
    @pointermove="stir"
  >
    <canvas ref="canvas" class="paint" aria-hidden="true" />
    <i class="grain" aria-hidden="true" />
    <i class="edge" aria-hidden="true" />
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
/*
 * Края сцены мягко уходят в цвет фона. При повороте телефона Android на миг показывает старую картинку
 * в уже повёрнутом окне — без светлых краёв граница между ней и пустым местом не видна
 */
.edge {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 9vmin 3vmin #050506;
  pointer-events: none;
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

/* Телефон лёжа: экран низкий — обложка почти во всю высоту */
@media (orientation: landscape) and (max-height: 520px) {
  .art {
    width: 84vmin;
  }
}
@media (orientation: portrait) {
  .art {
    width: min(86vw, 780px);
  }
}
</style>
