<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import IconPrev from '~icons/solar/alt-arrow-left-linear'
import IconNext from '~icons/solar/alt-arrow-right-linear'
import CoverArt from './CoverArt.vue'
import type { Track } from '@/domain/track'
import { displayArtist } from '@/domain/track'
import { isDesktop } from '@/native/desktop/bridge'

/**
 * Горизонтальная полка обложек. Тап играет всю полку с этого трека.
 *
 * На телефоне полка листается пальцем от края до края экрана. На компьютере она стоит в колонке
 * содержимого: в ряд помещается целое число карточек ровно по её ширине (ничего не обрезано и не уезжает
 * под правый край окна), а дальше листают стрелки по бокам — мышью вбок прокручивать неудобно.
 */
const props = defineProps<{ title: string; hint?: string; tracks: Track[] }>()
const emit = defineEmits<{ play: [index: number]; more: [] }>()

const row = ref<HTMLElement | null>(null)
const canPrev = ref(false)
const canNext = ref(false)

function update() {
  const el = row.value
  if (!el || !isDesktop) return
  canPrev.value = el.scrollLeft > 2
  canNext.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
}

/** Стрелка листает на ширину полки — ровно на следующий ряд карточек */
function page(dir: -1 | 1) {
  const el = row.value
  if (el) el.scrollBy({ left: dir * (el.clientWidth + 16), behavior: 'smooth' })
}

onMounted(update)
useResizeObserver(row, update)
watch(
  () => props.tracks,
  () => void nextTick(update),
)
</script>

<template>
  <section v-if="tracks.length" class="shelf">
    <div class="section-title">
      <span>{{ title }}</span>
      <button v-if="hint" type="button" class="more-link" @click="emit('more')">{{ hint }}</button>
    </div>
    <div class="rail" :class="{ fit: isDesktop }">
      <div ref="row" class="row" @scroll.passive="update">
        <button v-for="(t, i) in tracks" :key="t.key" type="button" class="card" @click="emit('play', i)">
          <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="m" radius="var(--r-m)" />
          <span class="t ellipsis">{{ t.title }}</span>
          <span class="s ellipsis">{{ displayArtist(t) }}</span>
        </button>
      </div>
      <button v-if="canPrev" type="button" class="nav prev" aria-label="Назад" @click="page(-1)"><IconPrev /></button>
      <button v-if="canNext" type="button" class="nav next" aria-label="Дальше" @click="page(1)"><IconNext /></button>
    </div>
  </section>
</template>

<style scoped>
.rail {
  position: relative;
}
/* Сверху запас под приподнятую при наведении обложку: лента с прокруткой обрезает всё, что выходит за неё */
.row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  margin-top: -10px;
  padding: 10px var(--gutter) 4px;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
  scroll-padding-inline: var(--gutter);
}
.row::-webkit-scrollbar {
  display: none;
}
.card {
  flex: none;
  width: 128px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  scroll-snap-align: start;
}
.card :deep(.cover) {
  width: 128px;
  margin-bottom: 4px;
}
.t {
  font: 500 13.5px/1.25 var(--f-body);
}
.s {
  font: 400 12px/1.25 var(--f-body);
  color: var(--ink-2);
}

/*
 * Компьютер: полка — в колонке содержимого. Ширина карточки считается от ширины полки (cqw — от .rail),
 * число карточек в ряду --n растёт с шириной: ряд всегда заполнен ровно, без обрезанной карточки справа.
 */
.rail.fit {
  margin: 0 var(--gutter);
  container-type: inline-size;
}
.fit > * {
  --n: 4;
}
.fit .row {
  gap: 16px;
  padding: 10px 0 4px;
  scroll-padding-inline: 0;
  scroll-snap-type: x mandatory;
}
@container (min-width: 620px) {
  .fit > * {
    --n: 5;
  }
}
@container (min-width: 760px) {
  .fit > * {
    --n: 6;
  }
}
@container (min-width: 900px) {
  .fit > * {
    --n: 7;
  }
}
@container (min-width: 1040px) {
  .fit > * {
    --n: 8;
  }
}
.fit .card {
  width: calc((100cqw - 16px * (var(--n) - 1)) / var(--n));
}
.fit .card :deep(.cover) {
  width: 100%;
}
.nav {
  position: absolute;
  top: 0;
  /* По высоте обложки: карточка квадратная, её сторона — ширина карточки */
  height: calc((100cqw - 16px * (var(--n) - 1)) / var(--n));
  width: 36px;
  display: grid;
  place-items: center;
  color: #fff;
  opacity: 0;
  transition: opacity var(--t-fast) var(--ease);
}
.nav svg {
  width: 30px;
  height: 30px;
  padding: 5px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.62);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
.nav.prev {
  left: -18px;
}
.nav.next {
  right: -18px;
}
.rail:hover .nav,
.nav:focus-visible {
  opacity: 1;
}
.nav:hover svg {
  background: rgba(0, 0, 0, 0.82);
}
</style>
