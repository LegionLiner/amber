<script setup lang="ts">
import { computed, ref } from 'vue'

/**
 * Тонкий ползунок панели плеера (перемотка и громкость). Тянуть можно за любую точку дорожки,
 * колёсиком мыши — небольшими шагами. Пока тянешь, приходит input, отпустил — change.
 */
const props = withDefaults(defineProps<{ value: number; label: string; wheelStep?: number }>(), { wheelStep: 0.05 })
const emit = defineEmits<{ input: [v: number]; change: [v: number] }>()

const track = ref<HTMLElement | null>(null)
const draft = ref<number | null>(null)
const shown = computed(() => Math.max(0, Math.min(1, draft.value ?? props.value)))

function at(e: PointerEvent): number {
  const r = track.value!.getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
}
function down(e: PointerEvent) {
  if (e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  draft.value = at(e)
  emit('input', draft.value)
}
function move(e: PointerEvent) {
  if (draft.value == null) return
  draft.value = at(e)
  emit('input', draft.value)
}
function up() {
  if (draft.value == null) return
  const v = draft.value
  draft.value = null
  emit('change', v)
}
function wheel(e: WheelEvent) {
  e.preventDefault()
  const v = Math.max(0, Math.min(1, props.value + (e.deltaY < 0 ? props.wheelStep : -props.wheelStep)))
  emit('input', v)
  emit('change', v)
}
function key(e: KeyboardEvent) {
  const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
  if (!d) return
  e.preventDefault()
  e.stopPropagation()
  const v = Math.max(0, Math.min(1, props.value + d * props.wheelStep))
  emit('input', v)
  emit('change', v)
}
</script>

<template>
  <div
    class="slider"
    :class="{ dragging: draft != null }"
    role="slider"
    tabindex="0"
    :aria-label="label"
    :aria-valuenow="Math.round(shown * 100)"
    aria-valuemin="0"
    aria-valuemax="100"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @lostpointercapture.self="up"
    @wheel="wheel"
    @keydown="key"
  >
    <div ref="track" class="track">
      <i class="fill" :style="{ transform: `scaleX(${shown})` }" />
      <i class="knob" :style="{ left: `${shown * 100}%` }" />
    </div>
  </div>
</template>

<style scoped>
.slider {
  display: flex;
  align-items: center;
  height: 22px;
  cursor: pointer;
  touch-action: none;
  outline: none;
}
.track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--line-strong);
}
.fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--ink-2);
  transform-origin: left;
}
.slider:hover .fill,
.slider:focus-visible .fill,
.dragging .fill {
  background: var(--amber);
}
.knob {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  background: var(--ink);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  opacity: 0;
  transition: opacity var(--t-fast) var(--ease);
}
.slider:hover .knob,
.slider:focus-visible .knob,
.dragging .knob {
  opacity: 1;
}
</style>
