<script setup lang="ts">
import { computed, ref } from 'vue'
import IconStar from '~icons/solar/star-bold'
import IconStarEmpty from '~icons/solar/star-linear'
import { haptic } from '@/native/haptics'

/**
 * Звёзды с половинками. Значение 1..10 (7 = 3½★), null = без оценки.
 * Ведение пальцем меняет оценку с шагом ½ и вибрирует на каждом шаге.
 * Тап по текущей оценке снимает её.
 */
const props = withDefaults(defineProps<{ modelValue: number | null; size?: number; readonly?: boolean }>(), {
  size: 22,
  readonly: false,
})
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const el = ref<HTMLElement | null>(null)
const preview = ref<number | null>(null)
const shown = computed(() => preview.value ?? props.modelValue ?? 0)
let startX = 0
let moved = false

function valueAt(clientX: number): number {
  const r = el.value!.getBoundingClientRect()
  const f = (clientX - r.left) / r.width
  return Math.min(10, Math.max(1, Math.ceil(f * 10)))
}

function down(e: PointerEvent) {
  if (props.readonly) return
  el.value!.setPointerCapture(e.pointerId)
  startX = e.clientX
  moved = false
  preview.value = valueAt(e.clientX)
  haptic.tick()
}

function move(e: PointerEvent) {
  if (preview.value == null) return
  if (Math.abs(e.clientX - startX) > 4) moved = true
  const v = valueAt(e.clientX)
  if (v !== preview.value) {
    preview.value = v
    haptic.tick()
  }
}

function up() {
  const v = preview.value
  preview.value = null
  if (v == null) return
  if (!moved && v === props.modelValue) emit('update:modelValue', null)
  else if (v !== props.modelValue) emit('update:modelValue', v)
  if (v === 10) haptic.success()
}

function cancel() {
  preview.value = null
}

function fill(i: number): string {
  const v = shown.value
  if (v >= i * 2) return '100%'
  if (v === i * 2 - 1) return '50%'
  return '0%'
}

function key(e: KeyboardEvent) {
  if (props.readonly) return
  const v = props.modelValue ?? 0
  if (e.key === 'ArrowRight') emit('update:modelValue', Math.min(10, v + 1))
  else if (e.key === 'ArrowLeft') emit('update:modelValue', v <= 1 ? null : v - 1)
  else return
  e.preventDefault()
}
</script>

<template>
  <div
    ref="el"
    class="stars"
    :class="{ readonly, live: preview != null, full: shown === 10 }"
    :style="{ '--s': `${size}px` }"
    role="slider"
    :tabindex="readonly ? -1 : 0"
    aria-label="Оценка"
    aria-valuemin="0"
    aria-valuemax="10"
    :aria-valuenow="modelValue ?? 0"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="cancel"
    @keydown="key"
  >
    <span v-for="i in 5" :key="i" class="star">
      <IconStarEmpty class="star-empty" />
      <span class="fill" :style="{ width: fill(i) }"><IconStar /></span>
    </span>
  </div>
</template>

<style scoped>
.stars {
  display: inline-flex;
  gap: calc(var(--s) * 0.12);
  touch-action: pan-y;
  cursor: pointer;
  padding: 6px 0;
}
.stars.readonly {
  cursor: default;
  padding: 0;
}
.star {
  position: relative;
  width: var(--s);
  height: var(--s);
  display: block;
}
.star svg {
  width: var(--s);
  height: var(--s);
  display: block;
}
.star-empty {
  color: var(--ink-3);
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  overflow: hidden;
  color: var(--amber);
  transition: width var(--t-fast) var(--ease);
}
.live .fill {
  transition: none;
}
.full .fill svg {
  filter: drop-shadow(0 0 6px rgba(var(--amber-rgb), 0.55));
}
</style>
