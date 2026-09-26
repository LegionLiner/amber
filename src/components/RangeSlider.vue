<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { touchStoppedScroll } from '@/composables/tapGuard'
import { haptic } from '@/native/haptics'

/**
 * Ползунок вместо <input type="range">: встроенный в WebView меняет значение от первого касания,
 * поэтому при прокрутке настроек значения случайно сбивались. Здесь значение меняется, только если
 * палец пошёл вбок; движение вверх-вниз отдаётся прокрутке страницы. Тап без движения ставит значение.
 * change приходит, когда палец отпущен (для дорогих действий, например смены скорости).
 */
const props = withDefaults(defineProps<{ modelValue: number; min: number; max: number; step?: number; label?: string }>(), {
  step: 1,
  label: '',
})
const emit = defineEmits<{ 'update:modelValue': [value: number]; change: [value: number] }>()

const el = ref<HTMLElement | null>(null)
const dragging = ref(false)
const pct = computed(
  () => ((Math.min(props.max, Math.max(props.min, props.modelValue)) - props.min) / (props.max - props.min)) * 100,
)

let mode: 'idle' | 'pending' | 'drag' = 'idle'
let sx = 0
let sy = 0
let pid = -1

function valueAt(x: number): number {
  const r = el.value!.getBoundingClientRect()
  const f = Math.min(1, Math.max(0, (x - r.left) / r.width))
  const raw = props.min + f * (props.max - props.min)
  const stepped = Math.round((raw - props.min) / props.step) * props.step + props.min
  // Убираем хвосты плавающей точки (0.30000000004)
  return Number(Math.min(props.max, Math.max(props.min, stepped)).toFixed(6))
}

function set(v: number) {
  if (v !== props.modelValue) {
    emit('update:modelValue', v)
    haptic.tick()
  }
}

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
    dragging.value = true
    el.value!.setPointerCapture(e.pointerId)
  }
  set(valueAt(e.clientX))
}
function up(e: PointerEvent) {
  if (mode === 'idle' || e.pointerId !== pid) return
  if (mode === 'pending') set(valueAt(e.clientX))
  mode = 'idle'
  dragging.value = false
  emit('change', valueAt(e.clientX))
}
function cancel() {
  // Система забрала касание посреди перетаскивания: последнее значение уже показано, его и применяем
  if (mode === 'drag') emit('change', props.modelValue)
  mode = 'idle'
  dragging.value = false
}

function blockTouchMove(e: TouchEvent) {
  if (mode === 'drag' && e.cancelable) e.preventDefault()
}
onMounted(() => el.value?.addEventListener('touchmove', blockTouchMove, { passive: false }))
onBeforeUnmount(() => el.value?.removeEventListener('touchmove', blockTouchMove))

function key(e: KeyboardEvent) {
  const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
  if (!d) return
  e.preventDefault()
  const v = Number(Math.min(props.max, Math.max(props.min, props.modelValue + d * props.step)).toFixed(6))
  emit('update:modelValue', v)
  emit('change', v)
}
</script>

<template>
  <div
    ref="el"
    class="rs"
    :class="{ dragging }"
    role="slider"
    tabindex="0"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    :style="{ '--p': `${pct}%` }"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="cancel"
    @lostpointercapture="cancel"
    @keydown="key"
  >
    <i class="track"><b class="fill" /></i>
    <b class="thumb" />
  </div>
</template>

<style scoped>
.rs {
  position: relative;
  height: 32px;
  touch-action: pan-y;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.track {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 4px;
  margin-top: -2px;
  border-radius: 2px;
  background: var(--line-strong);
  overflow: hidden;
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--p);
  background: linear-gradient(90deg, var(--amber), var(--ember));
}
.thumb {
  position: absolute;
  top: 50%;
  left: var(--p);
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  border-radius: 50%;
  background: var(--ink);
  box-shadow: 0 0 0 4px rgba(var(--amber-rgb), 0.22);
  transition:
    transform var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}
.dragging .thumb {
  transform: scale(1.18);
  box-shadow: 0 0 0 7px rgba(var(--amber-rgb), 0.25);
}
.dragging .fill,
.dragging .thumb {
  transition: none;
}
</style>
