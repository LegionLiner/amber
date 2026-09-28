<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import IconSort from '~icons/solar/sort-vertical-linear'
import CoverArt from '@/components/CoverArt.vue'
import SortSheet from '@/components/SortSheet.vue'
import HeadSpace from '@/components/HeadSpace.vue'
import { useLibrary } from '@/stores/library'
import { useSettings, type SortPref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import type { AlbumGroup } from '@/domain/groups'

const library = useLibrary()
const settings = useSettings()
const ui = useUi()
const router = useRouter()
const scrollEl = ref<HTMLElement | null>(null)

const SCREEN = 'library.albums'
const OPTIONS = [
  { key: 'title', label: 'Название', dir: 'asc' as const },
  { key: 'artist', label: 'Исполнитель', dir: 'asc' as const },
  { key: 'year', label: 'Год', dir: 'desc' as const },
  { key: 'plays', label: 'Прослушивания', dir: 'desc' as const },
  { key: 'tracks', label: 'Число треков', dir: 'desc' as const },
]
const pref = computed(() => settings.sortFor(SCREEN, { key: 'title', dir: 'asc' }))
const coll = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })

const albums = computed(() => {
  const d = pref.value.dir === 'asc' ? 1 : -1
  const cmp: Record<string, (a: AlbumGroup, b: AlbumGroup) => number> = {
    title: (a, b) => coll.compare(a.title, b.title) * d,
    artist: (a, b) => coll.compare(a.artist, b.artist) * d || coll.compare(a.title, b.title),
    year: (a, b) => ((a.year ?? 0) - (b.year ?? 0)) * d,
    plays: (a, b) => (a.plays - b.plays) * d,
    tracks: (a, b) => (a.tracks.length - b.tracks.length) * d,
  }
  return [...library.albums].sort(cmp[pref.value.key] ?? cmp.title)
})

watch(
  () => ui.reselect,
  (r) => r.tab === 'library' && scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' }),
)

function openSort() {
  ui.openSheet(SortSheet, { options: OPTIONS, value: pref.value, onPick: (p: SortPref) => settings.setSort(SCREEN, p) })
}
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <HeadSpace />
    <div class="toolbar">
      <span class="muted">{{ albums.length }} альб.</span>
      <button type="button" class="sort" @click="openSort">
        <IconSort />{{ OPTIONS.find((o) => o.key === pref.key)?.label }}
      </button>
    </div>
    <div class="grid">
      <button
        v-for="a in albums"
        :key="a.id"
        type="button"
        class="album"
        data-morph-card
        @click="router.push(`/album/${encodeURIComponent(a.id)}`)"
      >
        <CoverArt :art="a.art" :seed="a.seed" :label="a.title" size="m" radius="var(--r-m)" />
        <span class="t ellipsis">{{ a.title }}</span>
        <span class="s ellipsis"
          >{{ a.artist || 'Разные исполнители' }}<template v-if="a.year"> · {{ a.year }}</template></span
        >
      </button>
    </div>
    <div v-if="library.loaded && !albums.length" class="empty">
      <h3>Альбомов нет</h3>
      <p>У треков пустой тег альбома. Включи в настройках «Считать папку альбомом».</p>
    </div>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--gutter) 8px;
  font-size: 12.5px;
}
.sort {
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
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 18px 14px;
  padding: 4px var(--gutter);
}
.album {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  min-width: 0;
  content-visibility: auto;
  contain-intrinsic-size: auto 220px;
}
.album :deep(.cover) {
  width: 100%;
  margin-bottom: 6px;
}
.t {
  font: 600 14px/1.25 var(--f-body);
}
.s {
  font: 400 12.5px/1.25 var(--f-body);
  color: var(--ink-2);
}
</style>
