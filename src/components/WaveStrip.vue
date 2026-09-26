<script setup lang="ts">
import { computed, ref } from 'vue'

/**
 * Кусок волны трека между fromMs и toMs с метками. Тап или протяжка ставит метку pick.
 * Используется в редакторе миксов: хвост трека A и начало трека B.
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

function at(e: PointerEvent) {
  const r = el.value!.getBoundingClientRect()
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  return Math.round(props.fromMs + f * (props.toMs - props.fromMs))
}
let dragging = false
function down(e: PointerEvent) {
  el.value!.setPointerCapture(e.pointerId)
  dragging = true
  emit('pick', at(e))
}
function move(e: PointerEvent) {
  if (dragging) emit('pick', at(e))
}
function up() {
  dragging = false
}
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
    @pointercancel="up"
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
  touch-action: none;
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
