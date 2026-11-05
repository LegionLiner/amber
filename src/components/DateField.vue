<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import IconCal from '~icons/solar/calendar-linear'
import IconLeft from '~icons/solar/alt-arrow-left-linear'
import IconRight from '~icons/solar/alt-arrow-right-linear'
import PickPanel from './PickPanel.vue'
import { dayMonth, dayMonthShort, MONTHS, MONTHS_SHORT } from '@/domain/format'
import { dayKey, parseDay } from '@/domain/weeks'
import { clampDay, monthDays, monthOutside, shiftDay, shiftMonth } from '@/domain/date-picker'
import { isEn, LOCALE, $t } from '@/i18n'

/**
 * Поле даты вместо системного <input type="date">: календарь в цветах темы, одинаковый на телефоне и компьютере.
 * Нажатие на «месяц год» в шапке — выбор месяца и года сеткой (быстро уйти на годы назад).
 * Клавиатура: стрелки — день и неделя, PageUp/PageDown — месяц, Home/End — начало и конец недели, Enter — выбрать.
 * Значение — ключ дня «ГГГГ-ММ-ДД».
 */
const props = defineProps<{
  modelValue: string
  min?: string
  max?: string
  /** Заголовок календаря на телефоне и подпись для экранного диктора */
  title?: string
  /** Коротко: «12 окт 2026» — для узких полей */
  short?: boolean
  id?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const btn = ref<HTMLButtonElement | null>(null)
const grid = ref<HTMLElement | null>(null)
const open = ref(false)
const mode = ref<'days' | 'months'>('days')
/** Что показано: месяц (days) или год (months) */
const view = ref({ y: 2000, m: 0 })
/** День под клавиатурным курсором */
const cursor = ref('')
const today = dayKey(new Date())

const label = computed(() => {
  if (!props.modelValue) return '—'
  const d = parseDay(props.modelValue)
  if (!props.short) return dayMonth(d, true)
  return isEn ? `${dayMonthShort(d)}, ${d.getFullYear()}` : `${dayMonthShort(d)} ${d.getFullYear()}`
})

/** Пн…Вс на языке интерфейса (1 января 2024 — понедельник) */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat(LOCALE, { weekday: 'short' }).format(new Date(2024, 0, 1 + i)).replace('.', ''),
)

const days = computed(() => monthDays(view.value.y, view.value.m, props.min, props.max))
const canPrev = computed(() =>
  mode.value === 'days'
    ? !monthOutside(view.value.y, view.value.m - 1, props.min, props.max)
    : !props.min || Number(props.min.slice(0, 4)) < view.value.y,
)
const canNext = computed(() =>
  mode.value === 'days'
    ? !monthOutside(view.value.y, view.value.m + 1, props.min, props.max)
    : !props.max || Number(props.max.slice(0, 4)) > view.value.y,
)

function show() {
  const start = clampDay(props.modelValue || today, props.min, props.max)
  const d = parseDay(start)
  view.value = { y: d.getFullYear(), m: d.getMonth() }
  cursor.value = start
  mode.value = 'days'
  open.value = true
}
function focusCursor() {
  grid.value?.querySelector<HTMLElement>(`[data-k="${cursor.value}"]`)?.focus({ preventScroll: true })
}
function pick(key: string) {
  if (key !== props.modelValue) emit('update:modelValue', key)
  open.value = false
}
function flip(d: -1 | 1) {
  if (mode.value === 'months') view.value = { ...view.value, y: view.value.y + d }
  else {
    const x = new Date(view.value.y, view.value.m + d, 1)
    view.value = { y: x.getFullYear(), m: x.getMonth() }
    cursor.value = clampDay(shiftMonth(cursor.value, d), props.min, props.max)
  }
}
function pickMonth(m: number) {
  view.value = { ...view.value, m }
  mode.value = 'days'
  cursor.value = clampDay(dayKey(new Date(view.value.y, m, Math.min(parseDay(cursor.value).getDate(), 28))), props.min, props.max)
  void nextTick(focusCursor)
}
function moveTo(key: string) {
  cursor.value = key
  const d = parseDay(key)
  if (d.getFullYear() !== view.value.y || d.getMonth() !== view.value.m) view.value = { y: d.getFullYear(), m: d.getMonth() }
  void nextTick(focusCursor)
}
function onGridKey(e: KeyboardEvent) {
  const c = cursor.value
  const dow = (parseDay(c).getDay() + 6) % 7
  const to: Record<string, () => string> = {
    ArrowLeft: () => shiftDay(c, -1, props.min, props.max),
    ArrowRight: () => shiftDay(c, 1, props.min, props.max),
    ArrowUp: () => shiftDay(c, -7, props.min, props.max),
    ArrowDown: () => shiftDay(c, 7, props.min, props.max),
    PageUp: () => shiftMonth(c, e.shiftKey ? -12 : -1, props.min, props.max),
    PageDown: () => shiftMonth(c, e.shiftKey ? 12 : 1, props.min, props.max),
    Home: () => shiftDay(c, -dow, props.min, props.max),
    End: () => shiftDay(c, 6 - dow, props.min, props.max),
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    return pick(c)
  }
  const f = to[e.key]
  if (!f) return
  e.preventDefault()
  moveTo(f())
}
</script>

<template>
  <button
    :id="id"
    ref="btn"
    type="button"
    class="pick-field date"
    :class="{ on: open }"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-label="title ? `${title}: ${label}` : undefined"
    @click="open ? (open = false) : show()"
  >
    <span class="val ellipsis">{{ label }}</span>
    <IconCal class="ic" aria-hidden="true" />
    <PickPanel :open="open" :anchor="btn" :title="title" :min-width="288" @close="open = false" @shown="focusCursor">
      <div class="cal">
        <div class="head">
          <button type="button" class="nav" :disabled="!canPrev" :aria-label="$t('Раньше')" @click="flip(-1)">
            <IconLeft />
          </button>
          <button
            type="button"
            class="ttl"
            :aria-label="mode === 'days' ? $t('Выбрать месяц и год') : undefined"
            @click="mode = mode === 'days' ? 'months' : 'days'"
          >
            <template v-if="mode === 'days'">{{ MONTHS[view.m] }} {{ view.y }}</template>
            <template v-else>{{ view.y }}</template>
          </button>
          <button type="button" class="nav" :disabled="!canNext" :aria-label="$t('Позже')" @click="flip(1)"><IconRight /></button>
        </div>

        <div v-if="mode === 'days'" ref="grid" class="days" role="grid" @keydown="onGridKey">
          <span v-for="w in WEEKDAYS" :key="w" class="wd" aria-hidden="true">{{ w }}</span>
          <button
            v-for="d in days"
            :key="d.key"
            type="button"
            class="d"
            :class="{ out: d.outside, today: d.key === today, sel: d.key === modelValue }"
            :disabled="d.disabled"
            :data-k="d.key"
            :tabindex="d.key === cursor ? 0 : -1"
            :aria-label="dayMonth(parseDay(d.key), true)"
            :aria-selected="d.key === modelValue"
            @click="pick(d.key)"
          >
            {{ d.day }}
          </button>
        </div>
        <div v-else class="months">
          <button
            v-for="(m, i) in MONTHS_SHORT"
            :key="m"
            type="button"
            class="mo"
            :class="{ sel: modelValue.startsWith(`${view.y}-${String(i + 1).padStart(2, '0')}`) }"
            :disabled="monthOutside(view.y, i, min, max)"
            @click="pickMonth(i)"
          >
            {{ m }}
          </button>
        </div>

        <div class="foot">
          <button v-if="(!min || today >= min) && (!max || today <= max)" type="button" class="today-btn" @click="pick(today)">
            {{ $t('Сегодня') }}
          </button>
        </div>
      </div>
    </PickPanel>
  </button>
</template>

<style scoped>
.pick-field {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  text-align: left;
  color: var(--ink);
  font: 500 14px/1.2 var(--f-body);
  cursor: pointer;
}
.pick-field:focus-visible,
.pick-field.on {
  outline: none;
  border-color: rgba(var(--amber-rgb), 0.6);
}
.val {
  min-width: 0;
}
.ic {
  flex: none;
  width: 17px;
  height: 17px;
  color: var(--ink-3);
}
.cal {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px;
}
.head {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ttl {
  flex: 1;
  height: 36px;
  border-radius: 10px;
  font: 600 15px/1 var(--f-body);
  color: var(--ink);
}
.nav {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--ink-2);
}
.nav svg {
  width: 20px;
  height: 20px;
}
.nav:disabled {
  opacity: 0.25;
}
.days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.wd {
  padding: 4px 0 6px;
  text-align: center;
  font: 500 11px/1 var(--f-body);
  color: var(--ink-3);
  text-transform: lowercase;
}
.d {
  aspect-ratio: 1;
  max-height: 46px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font: 500 14px/1 var(--f-body);
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.d.out {
  color: var(--ink-3);
}
.d.today {
  box-shadow: inset 0 0 0 1.5px var(--line-strong);
  font-weight: 700;
}
.d.sel {
  background: var(--amber);
  color: var(--on-amber, #1a1208);
  font-weight: 700;
  box-shadow: none;
}
.d:disabled {
  opacity: 0.22;
  cursor: default;
}
.d:focus-visible,
.mo:focus-visible,
.ttl:focus-visible {
  outline: 2px solid rgba(var(--amber-rgb), 0.7);
  outline-offset: -2px;
}
.months {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 4px 0;
}
.mo {
  height: 46px;
  border-radius: 12px;
  font: 500 14px/1 var(--f-body);
  color: var(--ink);
  background: var(--chip);
}
.mo.sel {
  background: var(--amber);
  color: var(--on-amber, #1a1208);
  font-weight: 700;
}
.mo:disabled {
  opacity: 0.25;
}
.foot {
  display: flex;
  justify-content: flex-end;
  min-height: 4px;
}
.today-btn {
  padding: 8px 12px;
  border-radius: 999px;
  font: 600 13px/1 var(--f-body);
  color: var(--amber-ink);
}
@media (pointer: fine) {
  .d:not(:disabled):not(.sel):hover,
  .mo:not(:disabled):not(.sel):hover,
  .ttl:hover,
  .nav:not(:disabled):hover,
  .today-btn:hover {
    background: var(--chip);
  }
  .d {
    max-height: 38px;
    font-size: 13px;
  }
}
</style>
