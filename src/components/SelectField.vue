<script setup lang="ts" generic="T extends string | number | null">
import { computed, ref } from 'vue'
import IconChevron from '~icons/solar/alt-arrow-down-linear'
import IconCheck from '~icons/solar/check-linear'
import PickPanel from './PickPanel.vue'

/**
 * Выпадающий список вместо системного <select>: одинаковый на телефоне и компьютере, в цветах темы.
 * Поле — кнопка с выбранным значением; список — в PickPanel (на компьютере под полем, на телефоне снизу).
 * Клавиатура как у обычного списка: стрелки, Home/End, Enter/пробел, Esc; стрелки на закрытом поле
 * сразу листают значения.
 */
export interface SelectOption<V> {
  value: V
  label: string
  hint?: string
}
const props = defineProps<{
  modelValue: T
  options: readonly SelectOption<T>[]
  /** Заголовок списка на телефоне и подпись для экранного диктора */
  title?: string
  id?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: T]; open: [] }>()

const btn = ref<HTMLButtonElement | null>(null)
const list = ref<HTMLElement | null>(null)
const open = ref(false)
const active = ref(0)
const index = computed(() => props.options.findIndex((o) => o.value === props.modelValue))
const current = computed(() => props.options[index.value] ?? null)

function show() {
  emit('open')
  active.value = Math.max(0, index.value)
  open.value = true
}
/** Панель появилась: выбранный пункт — в поле зрения, фокус — на списке (для стрелок) */
function onShown() {
  list.value?.querySelector<HTMLElement>(`[data-i="${active.value}"]`)?.scrollIntoView({ block: 'nearest' })
  list.value?.focus({ preventScroll: true })
}
function choose(i: number) {
  const o = props.options[i]
  if (o && o.value !== props.modelValue) emit('update:modelValue', o.value)
  open.value = false
}
function step(d: number) {
  const n = props.options.length
  if (!n) return
  active.value = Math.max(0, Math.min(n - 1, active.value + d))
  list.value?.querySelector<HTMLElement>(`[data-i="${active.value}"]`)?.scrollIntoView({ block: 'nearest' })
}
function onListKey(e: KeyboardEvent) {
  const keys: Record<string, () => void> = {
    ArrowDown: () => step(1),
    ArrowUp: () => step(-1),
    PageDown: () => step(8),
    PageUp: () => step(-8),
    Home: () => step(-1e9),
    End: () => step(1e9),
    Enter: () => choose(active.value),
    ' ': () => choose(active.value),
    Tab: () => (open.value = false),
  }
  const run = keys[e.key]
  if (!run) return
  if (e.key !== 'Tab') e.preventDefault()
  run()
}
/** Закрытое поле: стрелки меняют значение сразу, как у системного списка */
function onButtonKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  if (e.altKey) return void show()
  const i = Math.max(0, Math.min(props.options.length - 1, index.value + (e.key === 'ArrowDown' ? 1 : -1)))
  if (props.options[i]) emit('update:modelValue', props.options[i].value)
}
</script>

<template>
  <button
    :id="id"
    ref="btn"
    type="button"
    class="pick-field"
    :class="{ on: open }"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-label="title ? `${title}: ${current?.label ?? ''}` : undefined"
    @click="open ? (open = false) : show()"
    @keydown="onButtonKey"
  >
    <span class="val ellipsis">{{ current?.label ?? '—' }}</span>
    <IconChevron class="chev" aria-hidden="true" />
    <PickPanel :open="open" :anchor="btn" :title="title" :min-width="180" @close="open = false" @shown="onShown">
      <div ref="list" class="opts" role="listbox" tabindex="-1" :aria-label="title" @keydown="onListKey">
        <button
          v-for="(o, i) in options"
          :key="String(o.value)"
          type="button"
          role="option"
          class="opt"
          :class="{ act: i === active }"
          :aria-selected="i === index"
          :data-i="i"
          tabindex="-1"
          @click="choose(i)"
          @pointermove="active = i"
        >
          <span class="txt"
            ><span class="lbl">{{ o.label }}</span
            ><small v-if="o.hint">{{ o.hint }}</small></span
          >
          <IconCheck v-if="i === index" class="tick" aria-hidden="true" />
        </button>
      </div>
    </PickPanel>
  </button>
</template>

<style scoped>
.pick-field {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  text-align: left;
  color: var(--ink);
  font: 500 14px/1.2 var(--f-body);
  cursor: pointer;
  transition:
    border-color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}
.pick-field:focus-visible,
.pick-field.on {
  outline: none;
  border-color: rgba(var(--amber-rgb), 0.6);
}
.val {
  min-width: 0;
}
.chev {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--ink-3);
  transition: transform var(--t-fast) var(--ease);
}
.on .chev {
  transform: rotate(180deg);
}
.opts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  outline: none;
}
.opt {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 8px 12px;
  border-radius: 10px;
  text-align: left;
  color: var(--ink);
  font: 500 15px/1.25 var(--f-body);
}
.opt[aria-selected='true'] {
  color: var(--amber-ink);
  font-weight: 600;
}
.txt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.txt small {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-3);
}
.tick {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--amber-ink);
}
/* Мышь: подсветка под курсором и у пункта, выбранного стрелками; список плотнее */
@media (pointer: fine) {
  .opt {
    min-height: 36px;
    padding: 7px 10px;
    font-size: 13.5px;
  }
  .opt.act {
    background: var(--chip);
  }
}
@media (pointer: coarse) {
  .opt:active {
    background: var(--chip);
  }
}
</style>
