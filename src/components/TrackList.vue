<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useElementSize } from '@vueuse/core'
import TrackRow, { type RowMeta } from './TrackRow.vue'
import TrackActionsSheet from './TrackActionsSheet.vue'
import type { Track } from '@/domain/track'
import type { PlaySource } from '@/native/types'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { haptic } from '@/native/haptics'

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
  }>(),
  { numbered: false },
)

const ROW_H = 64

const player = usePlayer()
const library = useLibrary()
const settings = useSettings()
const ui = useUi()

const scrollEl = ref<HTMLElement | null>(null)
const headerEl = ref<HTMLElement | null>(null)
const { height: headerH } = useElementSize(headerEl, undefined, { box: 'border-box' })

const virt = useVirtualizer(
  computed(() => ({
    count: props.tracks.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => ROW_H,
    overscan: 10,
    scrollMargin: headerH.value,
    getItemKey: (i: number) => props.tracks[i]?.key ?? i,
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
  ui.toast(`«${t.title}» сыграет следующим`)
}

async function swipeLeft(t: Track) {
  if (settings.s.swipeLeft === 'queue') {
    await player.addToQueue([t], props.source)
    ui.toast(`«${t.title}» в очереди`)
    return
  }
  const on = await library.toggleFavorite(t.key)
  haptic.success()
  ui.toast(on ? 'Добавлено в избранное' : 'Убрано из избранного')
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
  <div ref="scrollEl" class="scroll list">
    <div ref="headerEl"><slot name="header" /></div>
    <div class="rows" :style="{ height: `${total}px` }">
      <div
        v-for="r in rows"
        :key="String(r.key)"
        class="vrow"
        :style="{ transform: `translateY(${r.start - headerH}px)`, height: `${ROW_H}px` }"
      >
        <TrackRow
          v-if="tracks[r.index]"
          :track="tracks[r.index]!"
          :active="tracks[r.index]!.key === currentKey"
          :playing="player.playing"
          :meta="meta?.(tracks[r.index]!)"
          :number="numbered ? (tracks[r.index]!.trackNo ?? r.index + 1) : null"
          :subtitle="subtitle?.(tracks[r.index]!)"
          :left-action="settings.s.swipeLeft"
          @tap="playAt(r.index)"
          @more="more(tracks[r.index]!)"
          @swipe-right="swipeRight(tracks[r.index]!)"
          @swipe-left="swipeLeft(tracks[r.index]!)"
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
.bottom-space {
  height: calc(var(--nav-h) + var(--mini-h) + var(--safe-bottom) + 28px);
}
</style>
