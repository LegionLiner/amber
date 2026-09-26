<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { touchStoppedScroll } from '@/composables/tapGuard'

/**
 * Кусок волны трека между fromMs и toMs с метками. Тап или протяжка ставит метку pick.
 * Используется в редакторе миксов: хвост трека A и начало трека B.
 *
 * Метка едет, только если палец пошёл вбок: вертикальный свайп по волне листает страницу.
 */
const props = defineProps<{
  wave: Uint8Array | null
  durationMs: number
  fromMs: number
  toMs: number
  /** Позиция, которую двигает пользователь */
  pick: number
  /** Закрашенная зона перехода [начало, конец] */
  zone?: [number, number] | null
  bars?: number
}>()
const emit = defineEmits<{ pick: [ms: number] }>()
const el = ref<HTMLElement | null>(null)
const N = computed(() => props.bars ?? 60)

const heights = computed(() => {
  const w = props.wave
  const out: number[] = []
  const span = Math.max(1, props.toMs - props.fromMs)
  for (let i = 0; i < N.value; i++) {
    if (!w || props.durationMs <= 0) {
      out.push(0.15)
      continue
    }
    const a = props.fromMs + (span * i) / N.value
    const b = props.fromMs + (span * (i + 1)) / N.value
    const ia = Math.max(0, Math.floor((a / props.durationMs) * w.length))
    const ib = Math.min(w.length, Math.max(ia + 1, Math.floor((b / props.durationMs) * w.length)))
    let m = 0
    for (let j = ia; j < ib; j++) if (w[j]! > m) m = w[j]!
    out.push(Math.max(0.06, m / 255))
  }
  return out
})

const pct = (ms: number) => `${Math.min(100, Math.max(0, ((ms - props.fromMs) / Math.max(1, props.toMs - props.fromMs)) * 100))}%`

function at(x: number) {
  const r = el.value!.getBoundingClientRect()
  const f = Math.min(1, Math.max(0, (x - r.left) / r.width))
  return Math.round(props.fromMs + f * (props.toMs - props.fromMs))
}
let mode: 'idle' | 'pending' | 'drag' = 'idle'
let sx = 0
let sy = 0
let pid = -1
function down(e: PointerEvent) {
  if (e.button !== 0 || touchStoppedScroll()) return
  mode = 'pending'
  pid = e.pointerId
  sx = e.clientX
  sy = e.clientY
}
function move(e: PointerEvent) {
  if (mode === 'idle' || e.pointerId !== pid) return
  const dx = e.clientX - sx
  const dy = e.clientY - sy
  if (mode === 'pending') {
    if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
      mode = 'idle'
      return
    }
    if (Math.abs(dx) < 5) return
    mode = 'drag'
    el.value!.setPointerCapture(e.pointerId)
  }
  emit('pick', at(e.clientX))
}
function up(e: PointerEvent) {
  if (mode === 'idle' || e.pointerId !== pid) return
  // Тап без движения ставит метку в точку касания
  if (mode === 'pending') emit('pick', at(e.clientX))
  mode = 'idle'
}
function cancel() {
  mode = 'idle'
}
function blockTouchMove(e: TouchEvent) {
  if (mode === 'drag' && e.cancelable) e.preventDefault()
}
onMounted(() => el.value?.addEventListener('touchmove', blockTouchMove, { passive: false }))
onBeforeUnmount(() => el.value?.removeEventListener('touchmove', blockTouchMove))
</script>

<template>
  <div
    ref="el"
    class="strip"
    role="slider"
    :aria-valuenow="pick"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="cancel"
    @lostpointercapture.self="cancel"
  >
    <i v-if="zone" class="zone" :style="{ left: pct(zone[0]), width: `calc(${pct(zone[1])} - ${pct(zone[0])})` }" />
    <div class="bars">
      <i v-for="(h, i) in heights" :key="i" :style="{ height: `${h * 100}%` }" />
    </div>
    <b class="pick" :style="{ left: pct(pick) }" />
  </div>
</template>

<style scoped>
.strip {
  position: relative;
  height: 56px;
  border-radius: 10px;
  background: var(--surface-2);
  touch-action: pan-y;
  cursor: ew-resize;
  overflow: hidden;
}
.bars {
  position: absolute;
  inset: 6px 4px;
  display: flex;
  align-items: center;
  gap: 1px;
}
.bars i {
  flex: 1;
  border-radius: 1px;
  background: var(--ink-3);
}
.zone {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(var(--amber-rgb), 0.22);
}
.pick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--amber);
  box-shadow: 0 0 0 3px rgba(var(--amber-rgb), 0.18);
}
</style>
