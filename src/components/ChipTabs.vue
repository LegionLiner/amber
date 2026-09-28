<script setup lang="ts" generic="T extends string">
import { nextTick, onMounted, ref, watch } from 'vue'
import { onPageShown } from '@/app/paging'

/**
 * Подвкладки чипсами. Прокручиваются вбок, если не влезают.
 * Подсветка активной вкладки переезжает к новой, а не перескакивает.
 */
const props = defineProps<{ items: { id: T; label: string }[]; modelValue: T }>()
const emit = defineEmits<{ 'update:modelValue': [id: T] }>()

const root = ref<HTMLElement | null>(null)
const ind = ref<{ x: number; w: number } | null>(null)
const animate = ref(false)

function measure() {
  const el = root.value?.querySelector<HTMLElement>('.chip.on')
  if (!el) return (ind.value = null)
  ind.value = { x: el.offsetLeft, w: el.offsetWidth }
  // Активная вкладка должна быть видна целиком
  const r = root.value!
  if (el.offsetLeft < r.scrollLeft || el.offsetLeft + el.offsetWidth > r.scrollLeft + r.clientWidth) {
    r.scrollTo({ left: el.offsetLeft - 16, behavior: animate.value ? 'smooth' : 'auto' })
  }
}
onMounted(() => {
  measure()
  requestAnimationFrame(() => (animate.value = true))
})
onPageShown(measure)
watch(
  () => [props.modelValue, props.items.length],
  () => void nextTick(measure),
)
</script>

<template>
  <div ref="root" class="chips" role="tablist">
    <i
      v-if="ind"
      class="ind"
      :class="{ animate }"
      :style="{ transform: `translateX(${ind.x}px)`, width: `${ind.w}px` }"
      aria-hidden="true"
    />
    <button
      v-for="it in items"
      :key="it.id"
      type="button"
      role="tab"
      class="chip"
      :class="{ on: it.id === modelValue }"
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
