<script setup lang="ts">
import { computed, ref } from 'vue'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/vue-virtual'
import { useElementSize } from '@vueuse/core'
import IconClock from '~icons/solar/clock-circle-linear'
import TrackRow, { type RowDetail, type RowMeta } from './TrackRow.vue'
import { useDragList } from '@/composables/useDragList'
import TrackActionsSheet from './TrackActionsSheet.vue'
import type { Track } from '@/domain/track'
import type { PlaySource } from '@/native/types'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { haptic } from '@/native/haptics'
import { $t } from '@/i18n'

/**
 * Длинный список треков с виртуализацией: в DOM только видимые строки,
 * поэтому 5 000 треков листаются так же легко, как 50.
 * Сам список и есть прокручиваемый контейнер, шапка экрана передаётся слотом.
 */
const props = withDefaults(
  defineProps<{
    tracks: Track[]
    source: PlaySource
    meta?: (t: Track) => RowMeta
    numbered?: boolean
    subtitle?: (t: Track) => string
    /** Своя логика запуска (миксы с переходами); по умолчанию — список как очередь */
    play?: (index: number) => void
    /** Места 1, 2, 3… слева от обложки (плейлисты) */
    positions?: boolean
    /** Альбом, дата добавления и длительность: колонками в широком окне, в узком — в строке */
    detail?: (t: Track, index: number) => RowDetail
    /** Подпись третьей колонки таблицы (по умолчанию — дата добавления) */
    extraLabel?: string
    /** Порядок можно менять: удержание берёт строку, мышью — просто потянуть */
    reorder?: (from: number, to: number) => void | Promise<void>
  }>(),
  { numbered: false, positions: false, extraLabel: $t('Добавлен') },
)

const ROW_H = 64

const player = usePlayer()
const library = useLibrary()
const ui = useUi()

const scrollEl = ref<HTMLElement | null>(null)
const headerEl = ref<HTMLElement | null>(null)
const { height: headerH } = useElementSize(headerEl, undefined, { box: 'border-box' })
const { width } = useElementSize(scrollEl)

/** Таблица с колонками — когда подробности есть и места хватает (компьютер, планшет) */
const wide = computed(() => !!props.detail && width.value >= 700)
const first = computed(() => (props.detail && props.tracks[0] ? props.detail(props.tracks[0], 0) : null))
const hasAlbum = computed(() => first.value?.album != null)
const hasAdded = computed(() => first.value?.added != null)
const listStyle = computed(() => ({
  '--pos-w': `${String(props.tracks.length).length * 8 + 6}px`,
  // Колонки таблицы: [место] обложка, название, [альбом], [третья колонка], оценка, длительность, «⋯»
  '--cols': `${props.positions ? 'var(--pos-w) ' : ''}44px minmax(0, 3fr)${hasAlbum.value ? ' minmax(0, 2fr)' : ''}${hasAdded.value ? ' 128px' : ''} 52px 48px 40px`,
}))

/* Перетаскивание: взятая строка едет за пальцем, соседи расступаются, отпустил — новый порядок */
const settling = ref(false)
const drag = useDragList({
  rowH: ROW_H,
  count: () => props.tracks.length,
  scrollEl,
  onMove: (from, to) => props.reorder?.(from, to),
})
function hold(i: number, y: number) {
  settling.value = true
  drag.start({ clientY: y }, i)
}
function release() {
  void drag.end()
  setTimeout(() => (settling.value = drag.from.value != null), 220)
}
const shift = (i: number) => (drag.from.value === i ? drag.dy.value : drag.offsetFor(i))

const virt = useVirtualizer(
  computed(() => ({
    count: props.tracks.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => ROW_H,
    overscan: 10,
    scrollMargin: headerH.value,
    getItemKey: (i: number) => props.tracks[i]?.key ?? i,
    // Взятая строка остаётся в DOM, даже если её увезли далеко от того места, где взяли
    rangeExtractor: (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const base = defaultRangeExtractor(range)
      const f = drag.from.value
      return f == null || base.includes(f) ? base : [...base, f].sort((a, b) => a - b)
    },
  })),
)

const rows = computed(() => virt.value.getVirtualItems())
const total = computed(() => virt.value.getTotalSize())
const currentKey = computed(() => player.current?.key)

function playAt(i: number) {
  if (props.play) return props.play(i)
  void player.playTracks(props.tracks, i, props.source)
}

function more(t: Track) {
  ui.openSheet(TrackActionsSheet, { trackKey: t.key, source: props.source })
}

async function swipeRight(t: Track) {
  await player.playNext([t], props.source)
  haptic.success()
  ui.toast($t('«{0}» сыграет следующим', t.title))
}

async function swipeLeft(t: Track) {
  const on = await library.toggleFavorite(t.key)
  haptic.success()
  ui.toast(on ? $t('Добавлено в избранное') : $t('Убрано из избранного'))
}

function scrollToTop() {
  scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function scrollToIndex(i: number) {
  virt.value.scrollToIndex(i, { align: 'start' })
}

defineExpose({ scrollToTop, scrollToIndex, scrollEl })
</script>

<template>
  <div ref="scrollEl" class="scroll list" :style="listStyle">
    <div ref="headerEl">
      <slot name="header" />
      <div v-if="wide && tracks.length" class="thead">
        <span v-if="positions" class="num">#</span>
        <span />
        <span>{{ $t('Название') }}</span>
        <span v-if="hasAlbum">{{ $t('Альбом') }}</span>
        <span v-if="hasAdded">{{ extraLabel }}</span>
        <span>{{ $t('Оценка') }}</span>
        <span class="dur" :aria-label="$t('Длительность')"><IconClock /></span>
        <span />
      </div>
    </div>
    <div class="rows" :class="{ sorting: settling }" :style="{ height: `${total}px` }">
      <div
        v-for="r in rows"
        :key="String(r.key)"
        class="vrow"
        :class="{ up: drag.from.value === r.index }"
        :style="{ transform: `translateY(${r.start - headerH + shift(r.index)}px)`, height: `${ROW_H}px` }"
      >
        <TrackRow
          v-if="tracks[r.index]"
          :track="tracks[r.index]!"
          :active="tracks[r.index]!.key === currentKey"
          :playing="player.playing"
          :meta="meta?.(tracks[r.index]!)"
          :number="numbered ? (tracks[r.index]!.trackNo ?? r.index + 1) : null"
          :subtitle="subtitle?.(tracks[r.index]!)"
          :position="positions ? r.index + 1 : null"
          :detail="detail?.(tracks[r.index]!, r.index)"
          :wide="wide"
          :hold-drag="!!reorder"
          :lifted="drag.from.value === r.index"
          @tap="playAt(r.index)"
          @more="more(tracks[r.index]!)"
          @swipe-right="swipeRight(tracks[r.index]!)"
          @swipe-left="swipeLeft(tracks[r.index]!)"
          @hold="(y: number) => hold(r.index, y)"
          @hold-move="drag.move"
          @hold-end="release"
        />
      </div>
    </div>
    <slot name="footer" />
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.list {
  height: 100%;
}
.rows {
  position: relative;
  width: 100%;
}
.vrow {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}
/* Пока строки переставляют, соседи расступаются плавно; взятая едет за пальцем без задержки */
.sorting .vrow {
  transition: transform 180ms var(--ease-out);
}
.sorting .vrow.up {
  z-index: 2;
  transition: none;
}
.thead {
  display: grid;
  grid-template-columns: var(--cols);
  column-gap: 16px;
  align-items: center;
  height: 36px;
  margin-top: 6px;
  padding: 0 max(4px, calc(var(--gutter) - 12px)) 0 var(--gutter);
  border-bottom: 1px solid var(--line);
  font: 500 12px/1 var(--f-body);
  color: var(--ink-3);
}
.thead .num {
  text-align: right;
}
.thead .dur {
  display: flex;
  justify-content: flex-end;
}
.thead svg {
  width: 15px;
  height: 15px;
}
.bottom-space {
  height: calc(var(--nav-h) + var(--mini-h) + var(--safe-bottom) + 28px);
}
</style>
