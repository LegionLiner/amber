<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import IconMore from '~icons/solar/menu-dots-bold'
import IconHeart from '~icons/solar/heart-bold'
import IconNext from '~icons/solar/list-arrow-down-linear'
import IconStar from '~icons/solar/star-bold'
import CoverArt from './CoverArt.vue'
import EqBars from './EqBars.vue'
import { useRowGesture } from '@/composables/useRowGesture'
import { PAGE_SWIPES } from '@/app/paging'
import { displayArtist, type Track } from '@/domain/track'

export type RowMeta = { kind: 'stars'; rating: number | null } | { kind: 'text'; text: string } | { kind: 'none' }

/** Подробности строки плейлиста: в широком окне — колонки таблицы, в узком — под названием и справа */
export interface RowDetail {
  album: string
  /** Когда добавлен в плейлист (null — колонки нет, как у умных плейлистов) */
  added: string | null
  duration: string
}

const props = defineProps<{
  track: Track
  active?: boolean
  playing?: boolean
  meta?: RowMeta
  /** Номер вместо обложки (альбомы) */
  number?: number | null
  /** Подпись вместо исполнителя */
  subtitle?: string
  /** Место в плейлисте — слева от обложки */
  position?: number | null
  detail?: RowDetail | null
  /** Широкое окно: подробности колонками (сетка колонок — переменная --cols у списка) */
  wide?: boolean
  /** Удержание берёт строку для перетаскивания, а не открывает меню */
  holdDrag?: boolean
  /** Строку сейчас тянут */
  lifted?: boolean
}>()

const emit = defineEmits<{
  tap: []
  more: []
  swipeLeft: []
  swipeRight: []
  hold: [y: number, el: HTMLElement]
  holdMove: [e: PointerEvent]
  holdEnd: []
}>()

/** В листаемых разделах горизонтальный свайп листает раздел, а не двигает строку */
const pageSwipes = inject(PAGE_SWIPES, ref(false))
const { dx, dragging, onTouchmove, handlers } = useRowGesture({
  onTap: () => emit('tap'),
  onLongPress: () => emit('more'),
  onSwipeLeft: () => emit('swipeLeft'),
  onSwipeRight: () => emit('swipeRight'),
  swipes: () => !pageSwipes.value,
  ...(props.holdDrag
    ? {
        onHold: (y: number, el: HTMLElement) => emit('hold', y, el),
        onHoldMove: (e: PointerEvent) => emit('holdMove', e),
        onHoldEnd: () => emit('holdEnd'),
      }
    : {}),
})
// Не пассивный touchmove только у строк, которые можно взять: остальные списки прокручиваются без ожидания
const touch = props.holdDrag ? { touchmove: onTouchmove } : {}

const table = computed(() => !!props.detail && !!props.wide)
const sub = computed(() => {
  const s = props.subtitle ?? displayArtist(props.track)
  return props.detail && !props.wide && props.detail.album ? `${s} · ${props.detail.album}` : s
})
const starText = computed(() => {
  const r = props.meta?.kind === 'stars' ? props.meta.rating : null
  if (r == null) return ''
  const whole = Math.floor(r / 2)
  return r % 2 ? `${whole}½` : String(whole)
})
</script>

<template>
  <div class="wrap">
    <div class="under right" :class="{ on: dx > 0 }" aria-hidden="true"><IconNext /><span>Следующим</span></div>
    <div class="under left" :class="{ on: dx < 0 }" aria-hidden="true">
      <span>{{ track.favoriteAt ? 'Убрать' : 'В избранное' }}</span>
      <IconHeart />
    </div>
    <div
      class="row"
      :class="{ active, dragging, moved: dx !== 0, lifted, table, placed: position != null }"
      :style="dx ? { transform: `translateX(${dx}px)` } : undefined"
      v-bind="handlers"
      v-on="touch"
    >
      <span v-if="position != null" class="pos num">{{ position }}</span>
      <span v-if="number != null" class="no num">
        <EqBars v-if="active" :playing="playing" />
        <template v-else>{{ number }}</template>
      </span>
      <div v-else class="art">
        <CoverArt :art="track.art" :seed="track.title" :label="track.title" size="s" />
        <span v-if="active" class="art-eq"><EqBars :playing="playing" light /></span>
      </div>
      <div class="text">
        <div class="title ellipsis">{{ track.title }}</div>
        <div class="sub ellipsis">
          <IconHeart v-if="track.favoriteAt" class="fav" />
          {{ sub }}
        </div>
      </div>
      <template v-if="table && detail">
        <span class="col ellipsis">{{ detail.album }}</span>
        <span v-if="detail.added != null" class="col ellipsis">{{ detail.added }}</span>
        <span class="col meta num">
          <span v-if="starText" class="stars"><IconStar />{{ starText }}</span>
        </span>
        <span class="col num dur">{{ detail.duration }}</span>
      </template>
      <div v-else-if="detail" class="meta two num">
        <span class="l1">
          <span v-if="starText" class="stars"><IconStar />{{ starText }}</span>
          {{ detail.duration }}
        </span>
        <span v-if="detail.added" class="l2">{{ detail.added }}</span>
      </div>
      <div v-else-if="meta && meta.kind !== 'none'" class="meta num">
        <template v-if="meta.kind === 'stars'">
          <span v-if="starText" class="stars"><IconStar />{{ starText }}</span>
        </template>
        <template v-else>{{ meta.text }}</template>
      </div>
      <button class="more" type="button" aria-label="Действия" @pointerdown.stop @click.stop="emit('more')">
        <IconMore />
      </button>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  height: 100%;
  overflow: hidden;
}
.under {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 22px;
  font: 600 13px/1 var(--f-body);
  opacity: 0;
}
.under.on {
  opacity: 1;
}
.under svg {
  width: 20px;
  height: 20px;
}
.under.right {
  justify-content: flex-start;
  background: rgba(var(--amber-rgb), 0.16);
  color: var(--amber-ink);
}
.under.left {
  justify-content: flex-end;
  background: color-mix(in srgb, var(--heart) 16%, transparent);
  color: var(--heart);
}
.row {
  position: relative;
  height: 100%;
  display: grid;
  grid-template-columns: 44px 1fr auto auto;
  align-items: center;
  gap: 12px;
  /* Правое поле зеркалит левое: на телефоне это те же 4 px, в широком окне — край колонки содержимого */
  padding: 0 max(4px, calc(var(--gutter) - 12px)) 0 var(--gutter);
  /* Без своей заливки: под строкой виден фон экрана. Заливка нужна, только пока строку сдвигают
     свайпом — чтобы подложка «Следующим» / «В избранное» не просвечивала сквозь неё */
  background: transparent;
  touch-action: pan-y;
  transition: transform 220ms var(--ease-out);
  cursor: pointer;
}
.row.dragging {
  transition: none;
}
.row.moved {
  background: var(--bg);
}
/* Место слева от обложки: ширина колонки — по самому длинному номеру в списке */
.row.placed {
  grid-template-columns: var(--pos-w, 22px) 44px minmax(0, 1fr) auto auto;
  column-gap: 10px;
}
.row.table {
  grid-template-columns: var(--cols);
  column-gap: 16px;
}
/* Взятая строка — карточкой над соседями (сильнее нажатия и наведения мышью) */
.wrap:has(.lifted) {
  overflow: visible;
}
.row.lifted {
  background: var(--surface-2) !important;
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  cursor: grabbing;
}
.pos {
  text-align: right;
  font: 500 13px/1 var(--f-body);
  color: var(--ink-3);
}
.active .pos {
  color: var(--amber-ink);
}
.col {
  min-width: 0;
  font: 400 13px/1.25 var(--f-body);
  color: var(--ink-2);
}
.col.meta {
  text-align: left;
}
.dur {
  text-align: right;
}
.two {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
}
.two .l1 {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.two .l2 {
  font-size: 11.5px;
  color: var(--ink-3);
}
.row:active:not(.dragging) {
  background: var(--surface);
}
.art {
  position: relative;
  width: 44px;
}
.art-eq {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.42);
  border-radius: var(--r-s);
}
.no {
  width: 44px;
  text-align: center;
  color: var(--ink-3);
  font: 500 14px/1 var(--f-body);
  display: grid;
  place-items: center;
}
.text {
  min-width: 0;
}
.title {
  font: 500 15px/1.25 var(--f-body);
}
.active .title {
  color: var(--amber-ink);
}
.sub {
  margin-top: 3px;
  font: 400 12.5px/1.25 var(--f-body);
  color: var(--ink-2);
}
.fav {
  width: 11px;
  height: 11px;
  color: var(--heart);
  vertical-align: -1px;
  margin-right: 2px;
}
.meta {
  font: 500 12.5px/1 var(--f-body);
  color: var(--ink-2);
  text-align: right;
}
.stars {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--amber-ink);
}
.stars svg {
  width: 13px;
  height: 13px;
  color: var(--amber);
}
.more {
  width: 40px;
  height: 44px;
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.more svg {
  width: 20px;
  height: 20px;
}
</style>
