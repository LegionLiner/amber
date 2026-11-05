<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import IconShuffle from '~icons/solar/shuffle-linear'
import IconSort from '~icons/solar/sort-vertical-linear'
import TrackList from '@/components/TrackList.vue'
import SortSheet from '@/components/SortSheet.vue'
import HeadSpace from '@/components/HeadSpace.vue'
import { detailFor, metaFor } from './rowMeta'
import { isDesktop } from '@/native/desktop/bridge'
import { relativeDay } from '@/domain/format'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useSettings, type SortPref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { sortTracks, TRACK_SORTS, type TrackSortKey } from '@/domain/sort'
import { countLabel } from '@/domain/format'
import type { PlaySource } from '@/native/types'
import { $t, $tp } from '@/i18n'

const library = useLibrary()
const player = usePlayer()
const settings = useSettings()
const ui = useUi()

const SCREEN = 'library.favorites'
const OPTIONS = [{ key: 'favorited', label: $t('Когда добавлены'), dir: 'desc' as const }, ...TRACK_SORTS]
const pref = computed(() => settings.sortFor(SCREEN, { key: 'favorited', dir: 'desc' }))
const sorted = computed(() => {
  const list = library.favorites
  if (pref.value.key === 'favorited') {
    return pref.value.dir === 'desc' ? list : [...list].reverse()
  }
  return sortTracks(list, pref.value.key as TrackSortKey, pref.value.dir)
})
const meta = computed(() => metaFor(pref.value.key === 'favorited' ? 'rating' : pref.value.key))
/** Окно компьютера: список — таблицей; третья колонка — по сортировке (по умолчанию — когда добавлен в избранное) */
const detail = computed(() => {
  if (!isDesktop) return null
  if (pref.value.key !== 'favorited') return detailFor(pref.value.key)
  const base = detailFor('added')
  return {
    label: $t('В избранном'),
    of: (t: Parameters<typeof base.of>[0]) => ({ ...base.of(t), added: t.favoriteAt ? relativeDay(t.favoriteAt) : '—' }),
  }
})
const source: PlaySource = { type: 'favorites', title: $t('Избранное') }

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
  <TrackList ref="list" :tracks="sorted" :source="source" :meta="meta" :detail="detail?.of" :extra-label="detail?.label">
    <template #header>
      <HeadSpace />
      <div class="toolbar">
        <button
          type="button"
          class="btn primary small"
          :disabled="!sorted.length"
          @click="player.playTracks(sorted, -1, source, { shuffle: true })"
        >
          <IconShuffle />{{ $t('Перемешать') }}
        </button>
        <span class="muted count">{{ countLabel(sorted.length, $tp('трек|трека|треков')) }}</span>
        <button type="button" class="sort" @click="openSort">
          <IconSort />{{ OPTIONS.find((o) => o.key === pref.key)?.label }}
        </button>
      </div>
    </template>
    <template #footer>
      <div v-if="!sorted.length" class="empty">
        <h3>{{ $t('Здесь будет избранное') }}</h3>
        <p>{{ $t('Свайп влево по треку, ❤ в плеере или двойной тап по обложке.') }}</p>
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
