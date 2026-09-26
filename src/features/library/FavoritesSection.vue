<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import IconShuffle from '~icons/solar/shuffle-linear'
import IconSort from '~icons/solar/sort-vertical-linear'
import TrackList from '@/components/TrackList.vue'
import SortSheet from '@/components/SortSheet.vue'
import LibraryHeader from './LibraryHeader.vue'
import { metaFor } from './rowMeta'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useSettings, type SortPref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { sortTracks, TRACK_SORTS, type TrackSortKey } from '@/domain/sort'
import { countLabel } from '@/domain/format'
import type { PlaySource } from '@/native/types'

const library = useLibrary()
const player = usePlayer()
const settings = useSettings()
const ui = useUi()

const SCREEN = 'library.favorites'
const OPTIONS = [{ key: 'favorited', label: 'Когда добавлены', dir: 'desc' as const }, ...TRACK_SORTS]
const pref = computed(() => settings.sortFor(SCREEN, { key: 'favorited', dir: 'desc' }))
const sorted = computed(() => {
  const list = library.favorites
  if (pref.value.key === 'favorited') {
    return pref.value.dir === 'desc' ? list : [...list].reverse()
  }
  return sortTracks(list, pref.value.key as TrackSortKey, pref.value.dir)
})
const meta = computed(() => metaFor(pref.value.key === 'favorited' ? 'rating' : pref.value.key))
const source: PlaySource = { type: 'favorites', title: 'Избранное' }

const list = ref<InstanceType<typeof TrackList> | null>(null)
watch(
  () => ui.reselect,
  (r) => r.tab === 'library' && list.value?.scrollToTop(),
)

function openSort() {
  ui.openSheet(SortSheet, { options: OPTIONS, value: pref.value, onPick: (p: SortPref) => settings.setSort(SCREEN, p) })
}
</script>

<template>
  <TrackList ref="list" :tracks="sorted" :source="source" :meta="meta">
    <template #header>
      <LibraryHeader section="favorites" />
      <div class="toolbar">
        <button
          type="button"
          class="btn primary small"
          :disabled="!sorted.length"
          @click="player.playTracks(sorted, -1, source, { shuffle: true })"
        >
          <IconShuffle />Перемешать
        </button>
        <span class="muted count">{{ countLabel(sorted.length, ['трек', 'трека', 'треков']) }}</span>
        <button type="button" class="sort" @click="openSort">
          <IconSort />{{ OPTIONS.find((o) => o.key === pref.key)?.label }}
        </button>
      </div>
    </template>
    <template #footer>
      <div v-if="!sorted.length" class="empty">
        <h3>Здесь будет избранное</h3>
        <p>Свайп влево по треку, ❤ в плеере или двойной тап по обложке.</p>
      </div>
    </template>
  </TrackList>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px var(--gutter) 10px;
}
.btn.small {
  min-height: 38px;
  padding: 0 16px;
  font-size: 14px;
}
.count {
  font-size: 12.5px;
}
.sort {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: 500 13px/1 var(--f-body);
  color: var(--ink-2);
  padding: 8px 4px;
}
.sort svg {
  width: 18px;
  height: 18px;
}
</style>
