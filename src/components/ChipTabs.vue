<script setup lang="ts" generic="T extends string">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onPageShown } from '@/app/paging'

/**
 * Подвкладки чипсами. Прокручиваются вбок, если не влезают.
 * Подсветка активной вкладки переезжает к новой, а не перескакивает.
 * pos — дробный номер вкладки: подсветку ведёт палец, листающий экраны раздела
 * (ms — время доезда вместе с экранами, 0 — точно за пальцем).
 */
const props = defineProps<{ items: { id: T; label: string }[]; modelValue: T; pos?: number; ms?: number }>()
const emit = defineEmits<{ 'update:modelValue': [id: T] }>()

const root = ref<HTMLElement | null>(null)
const ind = ref<{ x: number; w: number } | null>(null)
const animate = ref(false)

/** Подсветка между двумя соседними чипсами по дробному номеру */
function atPos(pos: number) {
  const chips = root.value?.querySelectorAll<HTMLElement>('.chip')
  if (!chips?.length) return null
  const p = Math.min(chips.length - 1, Math.max(0, pos))
  const a = chips[Math.floor(p)]!
  const b = chips[Math.ceil(p)]!
  const f = p - Math.floor(p)
  return { x: a.offsetLeft + (b.offsetLeft - a.offsetLeft) * f, w: a.offsetWidth + (b.offsetWidth - a.offsetWidth) * f }
}
watch(
  () => props.pos,
  (p) => {
    if (p != null) ind.value = atPos(p)
  },
)
const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)'
const indTransition = computed(() => {
  if (props.pos == null || !animate.value) return undefined
  return props.ms ? `transform ${props.ms}ms ${EASE}, width ${props.ms}ms ${EASE}` : 'none'
})

function measure() {
  const el = root.value?.querySelector<HTMLElement>('.chip.on')
  if (!el) return (ind.value = null)
  ind.value = props.pos != null ? atPos(props.pos) : { x: el.offsetLeft, w: el.offsetWidth }
  // Активная вкладка должна быть видна целиком
  const r = root.value!
  if (el.offsetLeft < r.scrollLeft || el.offsetLeft + el.offsetWidth > r.scrollLeft + r.clientWidth) {
    r.scrollTo({ left: el.offsetLeft - 16, behavior: animate.value ? 'smooth' : 'auto' })
  }
}
/**
 * Окно поменяло размер (на компьютере его разворачивают, колонка встаёт по центру): чипсы сдвинулись,
 * а подсветка оставалась на старом месте и торчала слева от первой вкладки. Перемеряем без анимации
 */
let resizeObs: ResizeObserver | null = null
onMounted(() => {
  measure()
  requestAnimationFrame(() => (animate.value = true))
  let lastW = root.value?.clientWidth ?? 0
  resizeObs = new ResizeObserver(() => {
    const w = root.value?.clientWidth ?? 0
    if (w === lastW || !w) return
    lastW = w
    const was = animate.value
    animate.value = false
    measure()
    requestAnimationFrame(() => (animate.value = was))
  })
  if (root.value) resizeObs.observe(root.value)
})
onBeforeUnmount(() => resizeObs?.disconnect())
onPageShown(measure)
watch(
  () => [props.modelValue, props.items.length],
  () => void nextTick(measure),
)

/**
 * Когда подсветку ведёт палец, она проходит под двумя чипсами сразу: у каждого фон тает, а текст светлеет
 * по тому, насколько подсветка над ним, — иначе светлый текст оставался на светлом фоне.
 */
function chipStyle(i: number) {
  if (props.pos == null) return undefined
  const w = Math.max(0, 1 - Math.abs(props.pos - i))
  const t = props.ms ? `${props.ms}ms` : '0ms'
  return {
    color: `color-mix(in srgb, var(--bg) ${Math.round(w * 100)}%, var(--ink-2))`,
    background: `color-mix(in srgb, var(--chip) ${Math.round((1 - w) * 100)}%, transparent)`,
    transition: `color ${t}, background ${t}, transform var(--t-fast) var(--ease)`,
  }
}
</script>

<template>
  <div ref="root" class="chips" role="tablist">
    <i
      v-if="ind"
      class="ind"
      :class="{ animate }"
      :style="{ transform: `translateX(${ind.x}px)`, width: `${ind.w}px`, transition: indTransition }"
      aria-hidden="true"
    />
    <button
      v-for="(it, i) in items"
      :key="it.id"
      type="button"
      role="tab"
      class="chip"
      :class="{ on: it.id === modelValue }"
      :style="chipStyle(i)"
      :aria-selected="it.id === modelValue"
      @click="emit('update:modelValue', it.id)"
    >
      {{ it.label }}
    </button>
  </div>
</template>

<style scoped>
.chips {
  position: relative;
  display: flex;
  gap: 8px;
  padding: 4px var(--gutter) 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.chips::-webkit-scrollbar {
  display: none;
}
.chip {
  position: relative;
  z-index: 1;
  flex: none;
  padding: 9px 14px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--ink-2);
  font: 500 13.5px/1 var(--f-body);
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-mid) var(--ease),
    transform var(--t-fast) var(--ease);
}
.chip:active {
  transform: scale(0.95);
}
.chip.on {
  background: transparent;
  color: var(--bg);
}
/* Подсветка активной вкладки: одна на всю ленту, переезжает между чипсами */
.ind {
  position: absolute;
  left: 0;
  top: 4px;
  height: calc(100% - 14px);
  border-radius: 999px;
  background: var(--ink);
}
.ind.animate {
  transition:
    transform 340ms var(--ease-out),
    width 340ms var(--ease-out);
}
</style>
