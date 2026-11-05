<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IconStar from '~icons/solar/star-bold'
import IconStarEmpty from '~icons/solar/star-linear'
import { haptic } from '@/native/haptics'
import { touchStoppedScroll } from '@/composables/tapGuard'
import { $t } from '@/i18n'

/**
 * Звёзды с половинками. Значение 1..10 (7 = 3½★), null = без оценки.
 * Ведение пальцем вбок меняет оценку с шагом ½, тап ставит оценку в точке касания,
 * тап по текущей оценке снимает её.
 *
 * Жест определяется по первым пикселям движения: вбок — оценка, вверх-вниз — это прокрутка страницы,
 * и оценка не меняется. Касание, остановившее прокрутку по инерции, тоже ничего не ставит.
 *
 * Пока ведёшь пальцем, показывается черновик (preview). Он обязан сброситься при любом исходе жеста:
 * если Android не прислал отпускание (потерян захват касания), черновик раньше оставался навсегда
 * и перекрывал настоящую оценку — на всех треках горели 5 звёзд и ничего не менялось.
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
let startY = 0
let lastX = 0
let lastMoveAt = 0
let mode: 'idle' | 'pending' | 'drag' = 'idle'
let pointerId = -1

/**
 * Оценка в точке: по самим звёздам, а не по ширине блока. Блок в колонке flex растягивался на всю строку,
 * и клик по третьей звезде ставил одну. Левая половина звезды — половинка, правая — целая
 */
function valueAt(clientX: number): number {
  const stars = [...el.value!.querySelectorAll<HTMLElement>('.star')].map((s) => s.getBoundingClientRect())
  if (!stars.length) return 1
  for (let i = 0; i < stars.length; i++) {
    const r = stars[i]!
    const next = stars[i + 1]
    // Промежуток между звёздами делится пополам между соседями
    const right = next ? (r.right + next.left) / 2 : Infinity
    if (clientX <= right) return Math.min(10, Math.max(1, i * 2 + (clientX < r.left + r.width / 2 ? 1 : 2)))
  }
  return 10
}

function down(e: PointerEvent) {
  // Новое касание — всегда с чистого листа, даже если прошлое не закончилось как положено
  reset()
  if (props.readonly || e.button !== 0 || touchStoppedScroll()) return
  mode = 'pending'
  pointerId = e.pointerId
  startX = lastX = e.clientX
  startY = e.clientY
}

function move(e: PointerEvent) {
  if (mode === 'idle' || e.pointerId !== pointerId) return
  lastX = e.clientX
  lastMoveAt = performance.now()
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (mode === 'pending') {
    if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
      // Это прокрутка страницы, а не оценка
      mode = 'idle'
      return
    }
    // Порог побольше: палец на тапе чуть сдвигается, а тап по текущей оценке должен её снимать
    if (Math.abs(dx) < 10) return
    try {
      el.value!.setPointerCapture(e.pointerId)
    } catch {
      // Касания уже нет (система его забрала): никакой протяжки
      return reset()
    }
    mode = 'drag'
  }
  const v = valueAt(e.clientX)
  if (v !== preview.value) {
    preview.value = v
    haptic.tick()
  }
}

function commit(v: number) {
  if (v !== props.modelValue) emit('update:modelValue', v)
  if (v === 10) {
    haptic.success()
    celebrate()
  }
}

/**
 * Пять звёзд: короткий «прыжок» по очереди. Через Web Animations, а не пересозданием элементов
 * по ключу: у v-for по числу список «стабильный», смену ключа Vue в нём не поддерживает,
 * и после первого прыжка видимые звёзды переставали обновляться.
 */
function celebrate() {
  if (document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  el.value
    ?.querySelectorAll<HTMLElement>('.star')
    .forEach((star, i) =>
      star.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.28) rotate(-8deg)', offset: 0.4 }, { transform: 'scale(1)' }],
        { duration: 420, delay: i * 45, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      ),
    )
}

function finish(x: number) {
  const was = mode
  mode = 'idle'
  if (was === 'drag') {
    const v = preview.value
    preview.value = null
    if (v != null) commit(v)
  } else if (was === 'pending') {
    // Тап: без движения
    const v = valueAt(x)
    if (v === props.modelValue) emit('update:modelValue', null)
    else {
      haptic.tick()
      commit(v)
    }
  }
}

function up(e: PointerEvent) {
  if (mode === 'idle' || e.pointerId !== pointerId) return
  finish(e.clientX)
}

/** Захват касания пропал без отпускания: доводим протяжку до конца по последней точке */
function lost(e: PointerEvent) {
  if (mode === 'drag' && e.pointerId === pointerId) finish(lastX)
}

function reset() {
  mode = 'idle'
  preview.value = null
}
const cancel = reset

// Сменился трек (или оценку поменяли в другом месте): черновик прошлого жеста не должен остаться
watch(
  () => props.modelValue,
  () => {
    // Живую протяжку не трогаем; зависшую (палец давно не двигался) — сбрасываем
    if (mode !== 'drag' || performance.now() - lastMoveAt > 1500) reset()
  },
)

/** Пока ведём по звёздам, страница не должна ни ехать, ни растягиваться на краю */
function blockTouchMove(e: TouchEvent) {
  if (mode === 'drag' && e.cancelable) e.preventDefault()
}
onMounted(() => el.value?.addEventListener('touchmove', blockTouchMove, { passive: false }))
onBeforeUnmount(() => el.value?.removeEventListener('touchmove', blockTouchMove))

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
    :class="{ readonly, live: preview != null }"
    :style="{ '--s': `${size}px` }"
    role="slider"
    :tabindex="readonly ? -1 : 0"
    :aria-label="$t('Оценка')"
    aria-valuemin="0"
    aria-valuemax="10"
    :aria-valuenow="modelValue ?? 0"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="cancel"
    @lostpointercapture.self="lost"
    @dragstart.prevent
    @contextmenu.prevent
    @keydown="key"
  >
    <span v-for="i in 5" :key="i" class="star">
      <IconStar class="star-base" />
      <IconStarEmpty class="star-empty" />
      <span class="fill" :style="{ width: fill(i) }"><IconStar /></span>
    </span>
  </div>
</template>

<style scoped>
.stars {
  display: inline-flex;
  /* В колонке flex не растягиваться на всю строку: кликают по звёздам, а не по пустому месту справа */
  align-self: flex-start;
  width: max-content;
  gap: calc(var(--s) * 0.12);
  touch-action: pan-y;
  cursor: pointer;
  padding: 6px 0;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
  -webkit-touch-callout: none;
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
  pointer-events: none;
}
.star svg {
  width: var(--s);
  height: var(--s);
  display: block;
}
/*
 * Пустая звезда: контур и лёгкая заливка — от основного цвета текста, а не от самого блёклого (--ink-3).
 * Основной текст контрастен в любой теме и на цветном фоне плеера, поэтому звёзды видны везде
 */
.star-base {
  position: absolute;
  inset: 0;
  color: color-mix(in srgb, var(--ink) 9%, transparent);
}
.star-empty {
  position: relative;
  color: color-mix(in srgb, var(--ink) 58%, transparent);
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
</style>
