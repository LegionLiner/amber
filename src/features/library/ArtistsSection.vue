<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import IconSort from '~icons/solar/sort-vertical-linear'
import CoverArt from '@/components/CoverArt.vue'
import SortSheet from '@/components/SortSheet.vue'
import AlphaScroller from '@/components/AlphaScroller.vue'
import HeadSpace from '@/components/HeadSpace.vue'
import { useLibrary } from '@/stores/library'
import { useSettings, type SortPref } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { countLabel } from '@/domain/format'
import type { ArtistGroup } from '@/domain/groups'
import { $t, $tp } from '@/i18n'

const library = useLibrary()
const settings = useSettings()
const ui = useUi()
const router = useRouter()
const scrollEl = ref<HTMLElement | null>(null)

const SCREEN = 'library.artists'
const OPTIONS = [
  { key: 'name', label: $t('Имя'), dir: 'asc' as const },
  { key: 'plays', label: $t('Прослушивания'), dir: 'desc' as const },
  { key: 'tracks', label: $t('Число треков'), dir: 'desc' as const },
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
    <HeadSpace />
    <div class="toolbar">
      <span class="muted">{{ $t('{0} исп.', artists.length) }}</span>
      <button type="button" class="sort" @click="openSort">
        <IconSort />{{ OPTIONS.find((o) => o.key === pref.key)?.label }}
      </button>
    </div>
    <!-- .cards на телефоне «прозрачная» (список строк), на компьютере — сетка карточек -->
    <div class="cards">
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
            {{ countLabel(a.tracks.length, $tp('трек|трека|треков'))
            }}<template v-if="a.plays"> {{ $t('· {0} прослуш.', a.plays) }}</template>
          </span>
        </span>
      </button>
    </div>
    <div v-if="library.loaded && !artists.length" class="empty">
      <h3>{{ $t('Исполнителей нет') }}</h3>
      <p>{{ $t('Имена возьмутся из тегов или из имён файлов вида «Исполнитель - Название».') }}</p>
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
.cards {
  display: contents;
}
:root.desktop .cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 24px 16px;
  padding: 6px var(--gutter);
}
:root.desktop .row {
  grid-template-columns: 1fr;
  justify-items: center;
  gap: 12px;
  padding: 0;
  text-align: center;
  contain-intrinsic-size: auto 220px;
}
:root.desktop .row:active {
  background: none;
}
:root.desktop .cv {
  width: 100%;
  box-shadow: 0 16px 28px -18px rgba(0, 0, 0, 0.7);
}
:root.desktop .text {
  align-items: center;
  max-width: 100%;
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
