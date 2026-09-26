<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import StoryViewer from './StoryViewer.vue'
import { recapPeriods } from '@/data/repos/recap'
import { MONTHS } from '@/domain/format'
import { coverGradient } from '@/domain/palette'

/** Итоги: по месяцам и по годам, открываются историями на весь экран */
const months = ref<string[]>([])
const years = ref<string[]>([])
const open = ref<{ from: string; to: string; title: string } | null>(null)

async function load() {
  const p = await recapPeriods()
  months.value = p.months.slice(0, 24)
  years.value = p.years
}
onMounted(load)
onActivated(load)

function monthTitle(m: string) {
  return `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
}
function openMonth(m: string) {
  const [y, mm] = m.split('-').map(Number)
  const last = new Date(y!, mm!, 0).getDate()
  open.value = { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}`, title: monthTitle(m) }
}
function openYear(y: string) {
  open.value = { from: `${y}-01-01`, to: `${y}-12-31`, title: `${y} год` }
}
</script>

<template>
  <section>
    <template v-if="years.length">
      <div class="section-title"><span>Годы</span></div>
      <div class="grid">
        <button
          v-for="y in years"
          :key="y"
          type="button"
          class="tile year"
          :style="{ background: coverGradient(`year-${y}`) }"
          @click="openYear(y)"
        >
          <b class="display">{{ y }}</b
          ><small>итоги года</small>
        </button>
      </div>
      <div class="section-title"><span>Месяцы</span></div>
      <div class="grid">
        <button
          v-for="m in months"
          :key="m"
          type="button"
          class="tile"
          :style="{ background: coverGradient(`month-${m}`) }"
          @click="openMonth(m)"
        >
          <b>{{ MONTHS[Number(m.slice(5, 7)) - 1] }}</b
          ><small>{{ m.slice(0, 4) }}</small>
        </button>
      </div>
    </template>
    <div v-else class="empty">
      <h3>Итоги появятся с историей</h3>
      <p>Месяц с музыкой — и можно будет посмотреть его историей на весь экран.</p>
    </div>
    <Teleport to="body">
      <Transition name="fade">
        <StoryViewer v-if="open" :from="open.from" :to="open.to" :title="open.title" @close="open = null" />
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding: 0 var(--gutter);
}
.tile {
  aspect-ratio: 3 / 4;
  border-radius: 16px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 2px;
  text-align: left;
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.tile b {
  font: 600 15px/1.15 var(--f-body);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.3);
}
.tile.year b {
  font-size: 22px;
}
.tile small {
  font-size: 11.5px;
  opacity: 0.85;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--t-mid) var(--ease);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
