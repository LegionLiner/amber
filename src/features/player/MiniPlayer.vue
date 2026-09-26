<script setup lang="ts">
import { computed, ref } from 'vue'
import IconPlay from '~icons/solar/play-bold'
import IconPause from '~icons/solar/pause-bold'
import CoverArt from '@/components/CoverArt.vue'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { formatDuration } from '@/domain/format'
import { haptic } from '@/native/haptics'

/**
 * Мини-плеер над навигацией. Две зоны жестов:
 *  - верхняя строка: свайп влево/вправо листает треки, свайп вверх или тап открывает плеер;
 *  - нижняя полоса: ведение пальцем перематывает (видна тонкой, ловит палец по высоте 20 px).
 */
const player = usePlayer()
const ui = useUi()

const item = computed(() => player.current)
const track = computed(() => player.currentTrack)
const frac = computed(() => (player.durationMs > 0 ? Math.min(1, player.position / player.durationMs) : 0))

/* ---- свайпы по верхней строке ---- */
const dx = ref(0)
const leaving = ref(false)
let sx = 0
let sy = 0
let active = false
let lock: 'x' | 'y' | null = null

function down(e: PointerEvent) {
  active = true
  lock = null
  sx = e.clientX
  sy = e.clientY
}
function move(e: PointerEvent) {
  if (!active) return
  const mx = e.clientX - sx
  const my = e.clientY - sy
  if (!lock && Math.hypot(mx, my) > 8) {
    lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  if (lock === 'x') dx.value = mx
}
async function up(e: PointerEvent) {
  if (!active) return
  active = false
  if (lock === 'x') {
    if (Math.abs(dx.value) > 70) {
      const dir = dx.value < 0 ? 1 : -1
      leaving.value = true
      dx.value = dir > 0 ? -window.innerWidth : window.innerWidth
      haptic.tick()
      await (dir > 0 ? player.next() : player.prev())
      setTimeout(() => {
        leaving.value = false
        dx.value = 0
      }, 180)
      return
    }
    dx.value = 0
  } else if (lock === 'y') {
    if (e.clientY - sy < -30) ui.fullPlayer = true
  } else {
    ui.fullPlayer = true
  }
}
function cancel() {
  active = false
  dx.value = 0
}

/* ---- перемотка по нижней полосе ---- */
const bar = ref<HTMLElement | null>(null)
const scrub = ref<number | null>(null)
function fracAt(x: number) {
  const r = bar.value!.getBoundingClientRect()
  return Math.min(1, Math.max(0, (x - r.left) / r.width))
}
function sdown(e: PointerEvent) {
  bar.value!.setPointerCapture(e.pointerId)
  scrub.value = fracAt(e.clientX)
  haptic.tick()
}
function smove(e: PointerEvent) {
  if (scrub.value != null) scrub.value = fracAt(e.clientX)
}
function sup() {
  if (scrub.value == null) return
  void player.seek(scrub.value * player.durationMs)
  scrub.value = null
}

function toggle() {
  haptic.tick()
  void player.toggle()
}
</script>

<template>
  <div v-if="item" class="mini glass" :class="{ scrubbing: scrub != null }">
    <div
      class="main"
      :class="{ leaving }"
      :style="dx ? { transform: `translateX(${dx}px)`, opacity: 1 - Math.min(0.6, Math.abs(dx) / 400) } : undefined"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="cancel"
    >
      <CoverArt :art="track?.art" :seed="item.title" :label="item.title" size="s" class="cv" />
      <div class="text">
        <div class="t ellipsis">{{ item.title }}</div>
        <div class="s ellipsis">{{ item.artist }}</div>
      </div>
    </div>
    <button type="button" class="pp" :aria-label="player.playing ? 'Пауза' : 'Играть'" @pointerdown.stop @click.stop="toggle">
      <IconPause v-if="player.playing" />
      <IconPlay v-else />
    </button>
    <div ref="bar" class="timeline" @pointerdown="sdown" @pointermove="smove" @pointerup="sup" @pointercancel="scrub = null">
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
}
.main {
  min-width: 0;
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 12px;
  align-items: center;
  touch-action: none;
  transition:
    transform 240ms var(--ease-out),
    opacity 240ms var(--ease-out);
  cursor: pointer;
}
.main.leaving {
  transition-duration: 160ms;
}
.cv {
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
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink);
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
