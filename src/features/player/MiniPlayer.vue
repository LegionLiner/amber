<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import IconPlay from '~icons/solar/play-bold'
import IconPause from '~icons/solar/pause-bold'
import CoverArt from '@/components/CoverArt.vue'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { formatDuration } from '@/domain/format'
import { haptic } from '@/native/haptics'
import { afterSlide, motionReduced } from '@/app/motion'
import type { QueueItem } from '@/native/types'
import { $t } from '@/i18n'

/**
 * Мини-плеер над навигацией. Жесты:
 *  - тап открывает плеер;
 *  - вверх — плеер вытягивается за пальцем, отпустил выше трети — открылся;
 *  - влево/вправо — соседний трек въезжает сбоку, дотянул — переключился;
 *  - по нижней полосе вбок — перемотка (тап по ней просто открывает плеер).
 */
const player = usePlayer()
const library = useLibrary()
const ui = useUi()

const item = computed(() => player.current)
const frac = computed(() => (player.durationMs > 0 ? Math.min(1, player.position / player.durationMs) : 0))

/* ---- лента: предыдущий, текущий, следующий ---- */
const GAP = 24
type Slots = [QueueItem | null, QueueItem | null, QueueItem | null]
const liveSlots = computed<Slots>(() => {
  const at = (j: number) => (j >= 0 && j !== player.index ? (player.queue[j] ?? null) : null)
  return [at(player.neighborIndex(-1)), item.value, at(player.neighborIndex(1))]
})
const frozen = shallowRef<Slots | null>(null)
const slots = computed(() => frozen.value ?? liveSlots.value)
const slotKeys = computed(() =>
  slots.value.map((s, i) => (s ? (i === 0 && s.qid === slots.value[2]?.qid ? `${s.qid}#p` : s.qid) : `empty${i}`)),
)
function artOf(q: QueueItem) {
  return library.byKey.get(q.key)?.art ?? null
}

const mainEl = ref<HTMLElement | null>(null)
const dx = ref(0)
const anim = ref<string | null>(null)
let w = 0
let animEnd = 0
let expect: string | null = null
let freezeTimer = 0
const stripStyle = computed(() => ({ transform: `translateX(${dx.value}px)`, transition: anim.value ?? 'none' }))

function animateTo(x: number, ms: number, ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)') {
  anim.value = `transform ${ms}ms ${ease}`
  dx.value = x
  animEnd = performance.now() + ms
}
function release() {
  clearTimeout(freezeTimer)
  const wait = animEnd - performance.now()
  if (wait > 0) {
    freezeTimer = window.setTimeout(release, wait + 16)
    return
  }
  expect = null
  anim.value = null
  frozen.value = null
  dx.value = 0
}
onBeforeUnmount(() => clearTimeout(freezeTimer))

/* ---- жесты по строке с треком ---- */
const lift = ref(0)
let sx = 0
let sy = 0
let lastX = 0
let lastY = 0
let lastT = 0
let vx = 0
let vy = 0
let active = false
let lock: 'x' | 'y' | null = null
let dragDist = 1

function down(e: PointerEvent) {
  active = true
  lock = null
  sx = lastX = e.clientX
  sy = lastY = e.clientY
  lastT = e.timeStamp
  vx = vy = 0
  w = mainEl.value?.offsetWidth ?? 0
}
function move(e: PointerEvent) {
  if (!active) return
  const mx = e.clientX - sx
  const my = e.clientY - sy
  if (!lock && Math.hypot(mx, my) > 8) {
    lock = Math.abs(mx) > Math.abs(my) ? (frozen.value ? null : 'x') : 'y'
    if (!lock) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (lock === 'y') dragDist = Math.max(200, (e.currentTarget as HTMLElement).closest('.mini')!.getBoundingClientRect().top)
  }
  const dt = Math.max(1, e.timeStamp - lastT)
  vx = (e.clientX - lastX) / dt
  vy = (e.clientY - lastY) / dt
  lastX = e.clientX
  lastY = e.clientY
  lastT = e.timeStamp
  if (lock === 'x') {
    const has = mx < 0 ? slots.value[2] : slots.value[0]
    anim.value = null
    dx.value = has ? mx : mx * 0.25
  } else if (lock === 'y') {
    // Вверх — полный плеер едет за пальцем; вниз мини-плеер не уходит
    lift.value = Math.min(0, my)
    ui.playerDrag = Math.min(1, Math.max(0, -my / dragDist))
  }
}
function up() {
  if (!active) return
  active = false
  if (lock === 'x') {
    const d = dx.value
    const flick = Math.abs(vx) > 0.45 && Math.sign(vx) === Math.sign(d)
    if (Math.abs(d) > w * 0.3 || flick) commit(d < 0 ? 1 : -1)
    else animateTo(0, 220)
  } else if (lock === 'y') {
    const p = ui.playerDrag ?? 0
    const open = p > 0.3 || (vy < -0.5 && p > 0.04)
    if (open) haptic.tick()
    ui.fullPlayer = open
    ui.playerDrag = null
    lift.value = 0
  }
  // Тап открывает плеер в обработчике click (open): если открыть уже на pointerup, браузерный click
  // от того же касания прилетал в кнопку полного плеера и ставил трек на паузу
}
function cancel() {
  active = false
  if (lock === 'x') animateTo(0, 220)
  if (ui.playerDrag != null) {
    ui.playerDrag = null
    lift.value = 0
  }
}

function commit(dir: 1 | -1) {
  const target = slots.value[dir > 0 ? 2 : 0]
  if (!target) return animateTo(0, 220)
  haptic.tick()
  frozen.value = slots.value
  expect = target.qid
  animateTo(-dir * (w + GAP), 200)
  clearTimeout(freezeTimer)
  freezeTimer = window.setTimeout(release, 2000)
  // Как в полном плеере: сначала лента доезжает, потом переключается трек
  afterSlide(mainEl.value?.querySelector<HTMLElement>('.strip'), () => void player.step(dir))
}

/** Трек сменился кнопками или сам: новый въезжает с той стороны, откуда он в очереди */
watch(
  () => item.value?.qid,
  (q, old) => {
    if (!q || !old) return
    if (frozen.value) {
      if (q === expect) release()
      return
    }
    if (!mainEl.value || motionReduced()) return
    const n = player.queue.length
    const i = player.index
    const was = player.queue.findIndex((x) => x.qid === old)
    const dir = was < 0 ? 0 : (was + 1) % n === i ? 1 : (i + 1) % n === was ? -1 : 0
    if (!dir) return
    w = mainEl.value.offsetWidth
    anim.value = null
    dx.value = dir * (w + GAP)
    void nextTick(() => {
      void mainEl.value?.offsetWidth
      if (player.transitionMs > 0)
        animateTo(0, Math.min(1200, Math.max(600, player.transitionMs * 0.3)), 'cubic-bezier(0.45, 0, 0.2, 1)')
      else animateTo(0, 300)
    })
  },
)

const miniStyle = computed(() => {
  const p = ui.playerDrag
  if (p == null) return undefined
  return { transform: `translateY(${lift.value * 0.25}px)`, opacity: Math.max(0, 1 - p * 2.5), transition: 'none' }
})

function open() {
  if (lock) return
  ui.fullPlayer = true
}

/* ---- перемотка по нижней полосе: только движением вбок ---- */
const bar = ref<HTMLElement | null>(null)
const scrub = ref<number | null>(null)
let tmode: 'idle' | 'pending' | 'drag' = 'idle'
let tsx = 0
let tsy = 0
let scrubbed = false
function fracAt(x: number) {
  const r = bar.value!.getBoundingClientRect()
  return Math.min(1, Math.max(0, (x - r.left) / r.width))
}
function sdown(e: PointerEvent) {
  tmode = 'pending'
  scrubbed = false
  tsx = e.clientX
  tsy = e.clientY
}
function smove(e: PointerEvent) {
  if (tmode === 'idle') return
  if (tmode === 'pending') {
    const mx = e.clientX - tsx
    const my = e.clientY - tsy
    if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
      tmode = 'idle'
      return
    }
    if (Math.abs(mx) < 6) return
    tmode = 'drag'
    scrubbed = true
    bar.value!.setPointerCapture(e.pointerId)
    haptic.tick()
  }
  scrub.value = fracAt(e.clientX)
}
function sup() {
  const was = tmode
  tmode = 'idle'
  if (was === 'drag' && scrub.value != null) void player.seek(scrub.value * player.durationMs)
  scrub.value = null
}
function scancel() {
  tmode = 'idle'
  scrub.value = null
}
function tapBar() {
  // Тап по полосе без протяжки — это тап по мини-плееру
  if (!scrubbed) ui.fullPlayer = true
}

function toggle() {
  haptic.tick()
  void player.toggle()
}
</script>

<template>
  <div v-if="item" class="mini glass" :class="{ scrubbing: scrub != null }" :style="miniStyle">
    <div
      ref="mainEl"
      class="main"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="cancel"
      @lostpointercapture.self="up"
      @click="open"
    >
      <div class="strip" :style="stripStyle">
        <template v-for="(s, i) in slots" :key="slotKeys[i]">
          <div v-if="s" class="slot" :style="{ transform: `translateX(calc(${i - 1} * (100% + ${GAP}px)))` }">
            <CoverArt :art="artOf(s)" :seed="s.title" :label="s.title" size="s" class="sc" :class="{ cv: i === 1 }" />
            <div class="text">
              <div class="t ellipsis">{{ s.title }}</div>
              <div class="s ellipsis">{{ s.artist }}</div>
            </div>
          </div>
        </template>
      </div>
    </div>
    <button
      type="button"
      class="pp"
      :aria-label="player.playing ? $t('Пауза') : $t('Играть')"
      @pointerdown.stop
      @click.stop="toggle"
    >
      <Transition name="icon-swap">
        <IconPause v-if="player.playing" key="pause" />
        <IconPlay v-else key="play" />
      </Transition>
    </button>
    <div
      ref="bar"
      class="timeline"
      @pointerdown.stop="sdown"
      @pointermove="smove"
      @pointerup="sup"
      @pointercancel="scancel"
      @lostpointercapture.self="sup"
      @click.stop="tapBar"
    >
      <div class="line"><i :style="{ transform: `scaleX(${scrub ?? frac})` }" /></div>
    </div>
    <div v-if="scrub != null" class="bubble num" :style="{ left: `${scrub * 100}%` }">
      {{ formatDuration(scrub * player.durationMs) }}
    </div>
  </div>
</template>

<style scoped>
.mini {
  position: fixed;
  left: 8px;
  right: 8px;
  bottom: calc(var(--nav-h) + var(--safe-bottom) + 6px);
  height: var(--mini-h);
  z-index: 21;
  border-radius: 18px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  padding: 0 8px 6px 8px;
  box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.5);
  transition:
    opacity var(--t-mid) var(--ease-out),
    transform var(--t-mid) var(--ease-out);
}
.main {
  position: relative;
  align-self: stretch;
  min-width: 0;
  overflow: hidden;
  touch-action: none;
  cursor: pointer;
}
.strip {
  position: absolute;
  inset: 0;
}
.slot {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 12px;
  align-items: center;
}
.sc {
  width: 42px;
}
.text {
  min-width: 0;
}
.t {
  font: 600 14.5px/1.25 var(--f-body);
}
.s {
  margin-top: 2px;
  font: 400 12.5px/1.25 var(--f-body);
  color: var(--ink-2);
}
.pp {
  position: relative;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink);
  transition: transform var(--t-fast) var(--ease);
}
.pp:active {
  transform: scale(0.88);
}
.pp svg {
  width: 26px;
  height: 26px;
}
.timeline {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -4px;
  height: 20px;
  display: flex;
  align-items: center;
  touch-action: none;
  cursor: pointer;
}
.line {
  position: relative;
  width: 100%;
  height: 2px;
  border-radius: 2px;
  background: var(--line-strong);
  overflow: hidden;
  transition: height var(--t-fast) var(--ease);
}
.scrubbing .line {
  height: 6px;
}
.line i {
  position: absolute;
  inset: 0;
  transform-origin: left;
  background: linear-gradient(90deg, var(--amber), var(--ember));
}
.bubble {
  position: absolute;
  bottom: 30px;
  transform: translateX(-50%);
  padding: 6px 9px;
  border-radius: 8px;
  background: var(--ink);
  color: var(--bg);
  font: 600 12px/1 var(--f-body);
  pointer-events: none;
}
</style>
