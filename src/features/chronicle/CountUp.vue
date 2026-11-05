<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { LOCALE } from '@/i18n'

/**
 * Число в тексте досчитывается с нуля: «412 ч 5 мин», «22:00», «18 новых треков». Анимируется первое число,
 * остальное остаётся как есть; разделители разрядов — как в исходном тексте. Без лишнего движения — сразу итог.
 */
const props = defineProps<{ text: string; ms?: number }>()

const parts = computed(() => {
  const m = /\d[\d\s  ,]*\d|\d/.exec(props.text)
  if (!m) return null
  const raw = m[0]
  const value = Number(raw.replace(/\D/g, ''))
  return { before: props.text.slice(0, m.index), after: props.text.slice(m.index + raw.length), value, grouped: /\D/.test(raw) }
})
const shown = ref(0)
let raf = 0

onMounted(() => {
  const p = parts.value
  if (!p) return
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced'
  if (reduced || p.value < 2) {
    shown.value = p.value
    return
  }
  const dur = props.ms ?? 1200
  const t0 = performance.now() + 150
  const step = (t: number) => {
    const k = Math.min(1, Math.max(0, (t - t0) / dur))
    // Быстро в начале, плавно к итогу
    shown.value = Math.round(p.value * (1 - Math.pow(1 - k, 3)))
    if (k < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

const num = computed(() => (parts.value?.grouped ? shown.value.toLocaleString(LOCALE) : String(shown.value)))
</script>

<template>
  <span v-if="parts" class="count"
    >{{ parts.before }}<span class="v">{{ num }}</span
    >{{ parts.after }}</span
  >
  <span v-else>{{ text }}</span>
</template>

<style scoped>
.v {
  font-variant-numeric: tabular-nums;
}
</style>
