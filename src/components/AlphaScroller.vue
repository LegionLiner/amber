<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { initialOf } from '@/domain/names'
import { haptic } from '@/native/haptics'

/**
 * Алфавитная полоса справа: ведёшь пальцем — список прыгает к первой записи на эту букву,
 * над пальцем крупно видна текущая буква. Кириллица и латиница вперемешку, как в списке.
 *
 * Полоса узкая и стоит у края, куда часто попадает большой палец при прокрутке. Поэтому она
 * «спит», пока список не листают: касание уходит в прокрутку, а схватить полосу можно долгим
 * касанием. Пока список едет (и полторы секунды после), полоса яркая и берётся сразу.
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
const dragging = ref(false)
const awake = ref(false)
const bubbleY = ref(0)

let sleepTimer = 0
let holdTimer = 0
let pid = -1

function wake() {
  awake.value = true
  clearTimeout(sleepTimer)
  sleepTimer = window.setTimeout(() => {
    if (!dragging.value) awake.value = false
  }, 1500)
}
function onScroll(e: Event) {
  // Горизонтальные ленты (чипы, полки) полосу не будят
  const t = e.target
  if (t instanceof HTMLElement && t.scrollHeight <= t.clientHeight) return
  wake()
}
onMounted(() => {
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  el.value?.addEventListener('touchmove', blockTouchMove, { passive: false })
})
onBeforeUnmount(() => {
  document.removeEventListener('scroll', onScroll, { capture: true })
  el.value?.removeEventListener('touchmove', blockTouchMove)
  clearTimeout(sleepTimer)
  clearTimeout(holdTimer)
})

function pick(y: number) {
  const r = el.value!.getBoundingClientRect()
  const f = Math.min(0.999, Math.max(0, (y - r.top) / r.height))
  const item = letters.value[Math.floor(f * letters.value.length)]
  bubbleY.value = y - r.top
  if (item && item.letter !== active.value) {
    active.value = item.letter
    haptic.tick()
    emit('jump', item.index)
  }
}
function grab(y: number) {
  dragging.value = true
  awake.value = true
  el.value!.setPointerCapture(pid)
  pick(y)
}
function down(e: PointerEvent) {
  if (e.button !== 0) return
  pid = e.pointerId
  if (awake.value) return grab(e.clientY)
  // Спит: ждём, не окажется ли это прокруткой. Палец постоял на месте — значит, хотят полосу
  const y = e.clientY
  clearTimeout(holdTimer)
  holdTimer = window.setTimeout(() => grab(y), 320)
}
function move(e: PointerEvent) {
  if (dragging.value && e.pointerId === pid) pick(e.clientY)
}
function up() {
  clearTimeout(holdTimer)
  if (!dragging.value) return
  dragging.value = false
  active.value = null
  wake()
}
function blockTouchMove(e: TouchEvent) {
  if (dragging.value && e.cancelable) e.preventDefault()
}
</script>

<template>
  <div
    v-if="letters.length > 4 && names.length > 40"
    ref="el"
    class="alpha"
    :class="{ awake, dragging }"
    aria-hidden="true"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @lostpointercapture.self="up"
  >
    <span v-for="l in letters" :key="l.letter" :class="{ on: active === l.letter }">{{ l.letter }}</span>
    <Transition name="bubble">
      <b v-if="active" class="bubble display" :style="{ top: `${bubbleY}px` }">{{ active }}</b>
    </Transition>
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
  border-radius: 11px;
  /* Пока полоса спит, вертикальный свайп по ней — это прокрутка списка */
  touch-action: pan-y;
  font: 600 9.5px/1 var(--f-body);
  color: var(--ink-3);
  user-select: none;
  -webkit-user-select: none;
  opacity: 0.35;
  transition:
    opacity var(--t-mid) var(--ease),
    background-color var(--t-mid) var(--ease);
}
.alpha.awake {
  opacity: 1;
  background: var(--chip);
}
.alpha.dragging {
  touch-action: none;
  background: rgba(var(--amber-rgb), 0.12);
}
.alpha span {
  transition:
    transform var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.alpha span.on {
  color: var(--amber-ink);
  transform: scale(1.35);
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
  transform-origin: 100% 100%;
}
.bubble-enter-active,
.bubble-leave-active {
  transition:
    transform var(--t-fast) var(--ease-out),
    opacity var(--t-fast) var(--ease-out);
}
.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: scale(0.6) rotate(-12deg);
}
</style>
