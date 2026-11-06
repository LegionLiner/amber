<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IconBack from '~icons/solar/alt-arrow-left-linear'
import { countLabel } from '@/domain/format'
import { dayBars, monthBars, type HistoryBar } from '@/domain/track-history'
import { $t, $tp } from '@/i18n'

/**
 * Сколько раз слушал трек: вся история по месяцам — от первого прослушивания до текущего месяца.
 * Лента прокручивается вбок и открывается на текущем месяце. Нажатие на месяц — он же по дням,
 * «Все месяцы» — обратно к ленте на то же место.
 * Мышью: наведение показывает число, ленту можно тянуть или крутить колесом; пальцем — обычная прокрутка.
 */
const props = defineProps<{ times: readonly number[] }>()

const PLAYS: [string, string, string] = $tp('прослушивание|прослушивания|прослушиваний')

const month = ref<HistoryBar | null>(null)
const months = computed(() => monthBars(props.times))
const bars = computed(() => (month.value ? dayBars(props.times, month.value.start) : months.value))
const max = computed(() => Math.max(1, ...bars.value.map((b) => b.n)))
const total = computed(() => months.value.reduce((s, b) => s + b.n, 0))
const span = computed(() => {
  const a = months.value[0]!.tip.toLowerCase()
  const b = months.value.at(-1)!.tip.toLowerCase()
  return a === b ? b : `${a} — ${b}`
})

const sel = ref<number | null>(null)
const selBar = computed(() => (sel.value === null ? null : (bars.value[sel.value] ?? null)))
watch(month, () => (sel.value = null))

/* ---------------- прокрутка ленты ---------------- */
const scroller = ref<HTMLElement | null>(null)
/** Где была лента месяцев, когда открыли месяц: «Все месяцы» возвращает туда же */
let monthsScroll: number | null = null
/** Лента стоит на текущем месяце — и остаётся на нём, когда меняется ширина окна или добавилось прослушивание */
let stick = true
/** Края ленты затухают, если в ту сторону есть что прокрутить */
const fade = ref({ l: false, r: false })
function toEnd() {
  const s = scroller.value
  if (s) s.scrollLeft = s.scrollWidth
}
function onScroll() {
  const s = scroller.value
  if (!s) return
  const atEnd = s.scrollLeft + s.clientWidth >= s.scrollWidth - 4
  if (!month.value) stick = atEnd
  fade.value = { l: s.scrollLeft > 2, r: !atEnd }
}
let ro: ResizeObserver | null = null
onMounted(() => {
  toEnd()
  onScroll()
  ro = new ResizeObserver(() => {
    if (!month.value && stick) toEnd()
    onScroll()
  })
  if (scroller.value) ro.observe(scroller.value)
})
onBeforeUnmount(() => ro?.disconnect())
watch(
  () => props.times.length,
  () =>
    void nextTick(() => {
      if (!month.value && stick) toEnd()
      onScroll()
    }),
)

function pick(b: HistoryBar, i: number) {
  if (month.value) {
    sel.value = sel.value === i ? null : i
    return
  }
  monthsScroll = scroller.value?.scrollLeft ?? null
  month.value = b
}
function back() {
  month.value = null
  void nextTick(() => {
    const s = scroller.value
    if (s) s.scrollLeft = monthsScroll ?? s.scrollWidth
    onScroll()
  })
}

function hover(i: number, e: PointerEvent) {
  if (e.pointerType === 'mouse' && !drag) sel.value = i
}
function unhover(e: PointerEvent) {
  if (e.pointerType === 'mouse') sel.value = null
}

/** Мышью ленту можно тянуть. Потянули — щелчок после этого не открывает месяц (он уходит на саму ленту) */
let drag: { x: number; left: number; moved: boolean; id: number } | null = null
function down(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || e.button !== 0 || month.value) return
  drag = { x: e.clientX, left: scroller.value?.scrollLeft ?? 0, moved: false, id: e.pointerId }
}
function move(e: PointerEvent) {
  const s = scroller.value
  if (!drag || !s) return
  const dx = e.clientX - drag.x
  if (!drag.moved && Math.abs(dx) > 5) {
    drag.moved = true
    sel.value = null
    s.setPointerCapture(drag.id)
  }
  if (drag.moved) s.scrollLeft = drag.left - dx
}
function up() {
  drag = null
}
/** Колесо мыши крутит ленту вбок, пока есть куда; дальше — как обычно, страницу */
function wheel(e: WheelEvent) {
  const s = scroller.value
  if (!s || month.value || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  const room = e.deltaY > 0 ? s.scrollWidth - s.clientWidth - s.scrollLeft : s.scrollLeft
  if (room <= 1) return
  e.preventDefault()
  s.scrollLeft += e.deltaY
}
</script>

<template>
  <div class="plays">
    <div class="head" aria-live="polite">
      <button v-if="month" type="button" class="back" @click="back"><IconBack />{{ $t('Все месяцы') }}</button>
      <template v-if="selBar">
        <b>{{ countLabel(selBar.n, PLAYS) }}</b
        ><span>{{ selBar.tip }}</span>
      </template>
      <template v-else-if="month">
        <b>{{ month.tip }}</b
        ><span>{{ countLabel(month.n, PLAYS) }}</span>
      </template>
      <template v-else>
        <b>{{ countLabel(total, PLAYS) }}</b
        ><span>{{ span }}</span>
      </template>
    </div>

    <div class="plot">
      <span class="max num" aria-hidden="true">{{ max }}</span>
      <div
        ref="scroller"
        class="scroller"
        :class="{ days: month, 'fade-l': fade.l && !month, 'fade-r': fade.r && !month }"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointercancel="up"
        @pointerleave="unhover"
        @wheel="wheel"
        @scroll.passive="onScroll"
      >
        <Transition name="strip" mode="out-in">
          <div :key="month?.start ?? 'months'" class="strip">
            <button
              v-for="(b, i) in bars"
              :key="b.start"
              type="button"
              class="col"
              :class="{ dim: sel !== null && sel !== i, future: b.future }"
              :aria-label="`${b.tip}: ${countLabel(b.n, PLAYS)}${month ? '' : $t('. Открыть по дням')}`"
              @pointerenter="hover(i, $event)"
              @click="pick(b, i)"
            >
              <span class="box">
                <i v-if="b.n" :style="{ height: `${(b.n / max) * 100}%` }" />
                <i v-else-if="!b.future" class="zero" />
              </span>
              <small class="tk">{{ b.tick }}</small>
              <small class="yr">{{ b.sub }}</small>
            </button>
          </div>
        </Transition>
      </div>
    </div>
    <p v-if="!month" class="hint">{{ $t('Нажми на месяц — покажется по дням') }}</p>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-height: 24px;
  margin-bottom: 12px;
}
.head b {
  font: 600 17px/1.2 var(--f-body);
  white-space: nowrap;
}
.head span {
  font-size: 12.5px;
  color: var(--ink-2);
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  align-self: center;
  margin-right: 4px;
  padding: 5px 10px 5px 6px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--ink);
  font: 500 12.5px/1 var(--f-body);
}
.back svg {
  width: 15px;
  height: 15px;
}

/* Шкала: линия на высоте самого большого столбика с его числом и линия основания */
.plot {
  --h: 104px;
  position: relative;
}
.plot::before,
.plot::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--line);
  pointer-events: none;
}
.plot::before {
  top: 0;
  right: 24px;
}
.plot::after {
  top: var(--h);
}
.max {
  position: absolute;
  top: -7px;
  right: 0;
  font-size: 11px;
  color: var(--ink-3);
}
.scroller {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--line) transparent;
  overscroll-behavior-x: contain;
}
.scroller.days {
  overflow-x: hidden;
}
.scroller.fade-l {
  mask-image: linear-gradient(90deg, transparent, #000 28px);
}
.scroller.fade-r {
  mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent);
}
.scroller.fade-l.fade-r {
  mask-image: linear-gradient(90deg, transparent, #000 28px, #000 calc(100% - 28px), transparent);
}
.strip {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  min-width: 100%;
  width: max-content;
  padding-bottom: 4px;
}
.days .strip {
  width: 100%;
  gap: 3px;
}
.col {
  flex: 1 0 30px;
  max-width: 64px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0;
  cursor: pointer;
}
.days .col {
  flex: 1 1 0;
  max-width: none;
}
.box {
  height: var(--h);
  display: flex;
  align-items: flex-end;
}
.box i {
  display: block;
  width: 100%;
  min-height: 3px;
  background: var(--amber);
  border-radius: 4px 4px 0 0;
  transition: opacity 0.2s;
}
.box i.zero {
  height: 2px;
  min-height: 2px;
  background: var(--surface-2);
}
.col:hover .box i:not(.zero) {
  filter: brightness(1.08);
}
.col.dim .box i:not(.zero) {
  opacity: 0.45;
}
.col.future {
  cursor: default;
}
.tk,
.yr {
  display: block;
  text-align: center;
  white-space: nowrap;
  font-size: 11px;
  line-height: 14px;
  color: var(--ink-2);
}
.tk {
  margin-top: 6px;
}
.yr {
  color: var(--ink-3);
  font-size: 10px;
  min-height: 14px;
}
.days .yr {
  display: none;
}
.hint {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--ink-3);
}

.strip-enter-active,
.strip-leave-active {
  transition:
    opacity 0.18s var(--ease),
    transform 0.22s var(--ease-out);
}
.strip-enter-from {
  opacity: 0;
  transform: scale(0.98);
}
.strip-leave-to {
  opacity: 0;
}
</style>
