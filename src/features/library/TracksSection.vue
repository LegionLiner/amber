<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import IconShuffle from '~icons/solar/shuffle-linear'
import IconSort from '~icons/solar/sort-vertical-linear'
import TrackList from '@/components/TrackList.vue'
import AlphaScroller from '@/components/AlphaScroller.vue'
import SortSheet from '@/components/SortSheet.vue'
import HeadSpace from '@/components/HeadSpace.vue'
import { detailFor, metaFor } from './rowMeta'
import { isDesktop } from '@/native/desktop/bridge'
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

const SCREEN = 'library.tracks'
const pref = computed(() => settings.sortFor(SCREEN, { key: 'title', dir: 'asc' }))
const seed = ref(Date.now() % 100000)
const sorted = computed(() => sortTracks(library.tracks, pref.value.key as TrackSortKey, pref.value.dir, seed.value))
const meta = computed(() => metaFor(pref.value.key))
/** Окно компьютера: список — таблицей с альбомом и колонкой по текущей сортировке */
const detail = computed(() => (isDesktop ? detailFor(pref.value.key) : null))
const sortLabel = computed(() => TRACK_SORTS.find((s) => s.key === pref.value.key)?.label ?? '')
const source: PlaySource = { type: 'library', title: 'Все треки' }

const list = ref<InstanceType<typeof TrackList> | null>(null)
/** Алфавит работает, когда список отсортирован по имени, исполнителю или альбому */
const alphaNames = computed(() => {
  const k = pref.value.key
  if (pref.value.dir !== 'asc') return null
  if (k === 'title') return sorted.value.map((t) => t.title)
  if (k === 'artist') return sorted.value.map((t) => t.artist)
  if (k === 'album') return sorted.value.map((t) => t.album)
  return null
})
watch(
  () => ui.reselect,
  (r) => r.tab === 'library' && list.value?.scrollToTop(),
)

function openSort() {
  ui.openSheet(SortSheet, {
    options: TRACK_SORTS,
    value: pref.value,
    onPick: (p: SortPref) => {
      if (p.key === 'random') seed.value = Date.now() % 100000
      settings.setSort(SCREEN, p)
    },
  })
}

function shuffleAll() {
  void player.playTracks(library.tracks, -1, { type: 'library', title: 'Все треки' }, { shuffle: true })
}
</script>

<template>
  <TrackList
    ref="list"
    :tracks="sorted"
    :source="source"
    :meta="meta"
    :detail="detail?.of"
    :extra-label="detail?.label"
    :class="{ 'with-alpha': alphaNames }"
  >
    <template #header>
      <HeadSpace />
      <div class="toolbar">
        <button type="button" class="btn primary small" :disabled="!library.tracks.length" @click="shuffleAll">
          <IconShuffle />Перемешать
        </button>
        <span class="count muted">{{ countLabel(library.tracks.length, ['трек', 'трека', 'треков']) }}</span>
        <button type="button" class="sort" @click="openSort"><IconSort />{{ sortLabel }}</button>
      </div>
    </template>
    <template #footer>
      <div v-if="library.loaded && !library.tracks.length" class="empty">
        <h3>Треков не найдено</h3>
        <p>Проверь разрешение на доступ к музыке и папки-исключения в настройках.</p>
      </div>
    </template>
  </TrackList>
  <AlphaScroller v-if="alphaNames" :names="alphaNames" @jump="(i) => list?.scrollToIndex(i)" />
</template>

<style scoped>
/* Справа буквенная полоса: кнопка «⋯» строки не должна оказываться под ней */
.with-alpha :deep(.row),
.with-alpha :deep(.thead) {
  padding-right: calc(var(--gutter) + 14px);
}
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
