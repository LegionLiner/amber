<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import IconSort from '~icons/solar/sort-vertical-linear'
import CoverArt from '@/components/CoverArt.vue'
import SortSheet from '@/components/SortSheet.vue'
import AlphaScroller from '@/components/AlphaScroller.vue'
import LibraryHeader from './LibraryHeader.vue'
import { useLibrary } from '@/stores/library'
import { useSettings, type SortPref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { countLabel } from '@/domain/format'
import type { ArtistGroup } from '@/domain/groups'

const library = useLibrary()
const settings = useSettings()
const ui = useUi()
const router = useRouter()
const scrollEl = ref<HTMLElement | null>(null)

const SCREEN = 'library.artists'
const OPTIONS = [
  { key: 'name', label: 'Имя', dir: 'asc' as const },
  { key: 'plays', label: 'Прослушивания', dir: 'desc' as const },
  { key: 'tracks', label: 'Число треков', dir: 'desc' as const },
]
const pref = computed(() => settings.sortFor(SCREEN, { key: 'name', dir: 'asc' }))
const coll = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })
const artists = computed(() => {
  const d = pref.value.dir === 'asc' ? 1 : -1
  const cmp: Record<string, (a: ArtistGroup, b: ArtistGroup) => number> = {
    name: (a, b) => coll.compare(a.name, b.name) * d,
    plays: (a, b) => (a.plays - b.plays) * d || coll.compare(a.name, b.name),
    tracks: (a, b) => (a.tracks.length - b.tracks.length) * d,
  }
  return [...library.artists].sort(cmp[pref.value.key] ?? cmp.name)
})

watch(
  () => ui.reselect,
  (r) => r.tab === 'library' && scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' }),
)

function jump(i: number) {
  const rows = scrollEl.value?.querySelectorAll<HTMLElement>('.row')
  rows?.[i]?.scrollIntoView({ block: 'start' })
}

function openSort() {
  ui.openSheet(SortSheet, { options: OPTIONS, value: pref.value, onPick: (p: SortPref) => settings.setSort(SCREEN, p) })
}
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <LibraryHeader section="artists" />
    <div class="toolbar">
      <span class="muted">{{ artists.length }} исп.</span>
      <button type="button" class="sort" @click="openSort">
        <IconSort />{{ OPTIONS.find((o) => o.key === pref.key)?.label }}
      </button>
    </div>
    <button
      v-for="a in artists"
      :key="a.id"
      type="button"
      class="row"
      data-morph-card
      @click="router.push(`/artist/${encodeURIComponent(a.id)}`)"
    >
      <CoverArt :art="a.art" :seed="a.name" :label="a.name" size="s" radius="50%" class="cv" />
      <span class="text">
        <span class="t ellipsis">{{ a.name }}</span>
        <span class="s ellipsis">
          {{ countLabel(a.tracks.length, ['трек', 'трека', 'треков'])
          }}<template v-if="a.plays"> · {{ a.plays }} прослуш.</template>
        </span>
      </span>
    </button>
    <div v-if="library.loaded && !artists.length" class="empty">
      <h3>Исполнителей нет</h3>
      <p>Имена возьмутся из тегов или из имён файлов вида «Исполнитель - Название».</p>
    </div>
    <div class="bottom-space" />
    <AlphaScroller v-if="pref.key === 'name' && pref.dir === 'asc'" :names="artists.map((a) => a.name)" @jump="jump" />
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
.row {
  width: 100%;
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 14px;
  align-items: center;
  padding: 7px var(--gutter);
  text-align: left;
  content-visibility: auto;
  contain-intrinsic-size: auto 66px;
}
.row:active {
  background: var(--surface);
}
.cv {
  width: 52px;
}
.text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.t {
  font: 500 15px/1.25 var(--f-body);
}
.s {
  font-size: 12.5px;
  color: var(--ink-2);
}
</style>
