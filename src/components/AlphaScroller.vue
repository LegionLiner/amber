<script setup lang="ts">
import { computed, ref } from 'vue'
import { initialOf } from '@/domain/names'
import { haptic } from '@/native/haptics'

/**
 * Алфавитная полоса справа: ведёшь пальцем — список прыгает к первой записи на эту букву,
 * над пальцем крупно видна текущая буква. Кириллица и латиница вперемешку, как в списке.
 */
const props = defineProps<{ names: string[] }>()
const emit = defineEmits<{ jump: [index: number] }>()

const letters = computed(() => {
  const out: { letter: string; index: number }[] = []
  const seen = new Set<string>()
  props.names.forEach((n, i) => {
    let l = initialOf(n)
    if (/\d/.test(l)) l = '#'
    if (!seen.has(l)) {
      seen.add(l)
      out.push({ letter: l, index: i })
    }
  })
  return out
})

const el = ref<HTMLElement | null>(null)
const active = ref<string | null>(null)
const bubbleY = ref(0)

function pick(e: PointerEvent) {
  const r = el.value!.getBoundingClientRect()
  const f = Math.min(0.999, Math.max(0, (e.clientY - r.top) / r.height))
  const item = letters.value[Math.floor(f * letters.value.length)]
  bubbleY.value = e.clientY - r.top
  if (item && item.letter !== active.value) {
    active.value = item.letter
    haptic.tick()
    emit('jump', item.index)
  }
}
function down(e: PointerEvent) {
  el.value!.setPointerCapture(e.pointerId)
  pick(e)
}
function move(e: PointerEvent) {
  if (active.value != null) pick(e)
}
function up() {
  active.value = null
}
</script>

<template>
  <div
    v-if="letters.length > 4 && names.length > 40"
    ref="el"
    class="alpha"
    aria-hidden="true"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
  >
    <span v-for="l in letters" :key="l.letter" :class="{ on: active === l.letter }">{{ l.letter }}</span>
    <b v-if="active" class="bubble display" :style="{ top: `${bubbleY}px` }">{{ active }}</b>
  </div>
</template>

<style scoped>
.alpha {
  position: fixed;
  right: 2px;
  top: calc(var(--safe-top) + 150px);
  bottom: calc(var(--nav-h) + var(--mini-h) + var(--safe-bottom) + 24px);
  z-index: 6;
  width: 22px;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  align-items: center;
  touch-action: none;
  font: 600 9.5px/1 var(--f-body);
  color: var(--ink-3);
  user-select: none;
}
.alpha span.on {
  color: var(--amber-ink);
}
.bubble {
  position: absolute;
  right: 34px;
  width: 56px;
  height: 56px;
  margin-top: -28px;
  border-radius: 50% 50% 8px 50%;
  display: grid;
  place-items: center;
  background: var(--amber);
  color: var(--on-amber);
  font-size: 26px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
</style>
