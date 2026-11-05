<script setup lang="ts">
import IconUp from '~icons/solar/arrow-up-linear'
import IconDown from '~icons/solar/arrow-down-linear'
import type { SortPref } from '@/stores/settings'
import { $t } from '@/i18n'

/** Выбор сортировки. Повторный тап по текущему пункту меняет направление. */
const props = defineProps<{
  options: { key: string; label: string; dir: 'asc' | 'desc' }[]
  value: SortPref
  onPick: (pref: SortPref) => void
}>()
const emit = defineEmits<{ close: [] }>()

function pick(o: { key: string; dir: 'asc' | 'desc' }) {
  if (o.key === props.value.key) props.onPick({ key: o.key, dir: props.value.dir === 'asc' ? 'desc' : 'asc' })
  else props.onPick({ key: o.key, dir: o.dir })
  emit('close')
}
</script>

<template>
  <div class="scroll body">
    <h3 class="head">{{ $t('Сортировка') }}</h3>
    <button v-for="o in options" :key="o.key" type="button" class="opt" :class="{ on: o.key === value.key }" @click="pick(o)">
      <span>{{ o.label }}</span>
      <template v-if="o.key === value.key">
        <IconUp v-if="value.dir === 'asc'" />
        <IconDown v-else />
      </template>
    </button>
  </div>
</template>

<style scoped>
.body {
  padding-bottom: 6px;
}
.head {
  padding: 0 var(--gutter) 8px;
  font: 600 17px/1.2 var(--f-body);
}
.opt {
  width: 100%;
  min-height: 50px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--gutter);
  text-align: left;
  font: 500 15px/1.2 var(--f-body);
}
.opt:active {
  background: var(--chip);
}
.opt.on {
  color: var(--amber-ink);
}
.opt svg {
  width: 20px;
  height: 20px;
}
</style>
