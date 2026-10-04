<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useViewRoute } from '@/app/view-route'
import IconDrag from '~icons/solar/hamburger-menu-linear'
import IconRemove from '~icons/solar/minus-circle-linear'
import ScreenHeader from '@/components/ScreenHeader.vue'
import CoverArt from '@/components/CoverArt.vue'
import { useLibrary } from '@/stores/library'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { playlistItems, removeFromPlaylist, reorderPlaylist, type PlaylistItemRow } from '@/data/repos/playlists'
import { useDragList } from '@/composables/useDragList'
import { displayArtist } from '@/domain/track'

/** Порядок плейлиста: тянешь за ручку, отпускаешь — порядок сохранён */
const route = useViewRoute()
const library = useLibrary()
const playlists = usePlaylists()
const ui = useUi()
const id = computed(() => Number(route.params.id))
const info = computed(() => playlists.list.find((p) => p.id === id.value))
const items = shallowRef<PlaylistItemRow[]>([])
const scrollEl = ref<HTMLElement | null>(null)
const ROW_H = 60

// Экран живёт в KeepAlive: треки, добавленные в плейлист после первого открытия, тоже должны здесь появиться
watch(
  [id, () => playlists.version],
  async () => {
    if (!Number.isFinite(id.value)) return
    if (!playlists.loaded) await playlists.refresh()
    items.value = await playlistItems(id.value)
  },
  { immediate: true },
)

const drag = useDragList({
  rowH: ROW_H,
  count: () => items.value.length,
  scrollEl,
  onMove: async (from, to) => {
    const list = items.value.slice()
    const [it] = list.splice(from, 1)
    list.splice(to, 0, it!)
    items.value = list
    await reorderPlaylist(
      id.value,
      list.map((i) => i.id),
    )
    await playlists.refresh()
  },
})

async function remove(i: PlaylistItemRow) {
  await removeFromPlaylist(i.id)
  items.value = items.value.filter((x) => x.id !== i.id)
  await playlists.refresh()
  ui.toast('Убрано из плейлиста')
}
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <ScreenHeader title="Порядок" :subtitle="info?.name" back />
    <div class="list" :style="{ height: `${items.length * ROW_H}px` }">
      <div
        v-for="(it, i) in items"
        :key="it.id"
        class="item"
        :class="{ dragging: drag.from.value === i }"
        :style="{ top: `${i * ROW_H}px`, height: `${ROW_H}px`, ...drag.styleFor(i) }"
      >
        <template v-if="library.byKey.get(it.trackKey)">
          <CoverArt
            :art="library.byKey.get(it.trackKey)!.art"
            :seed="library.byKey.get(it.trackKey)!.title"
            :label="library.byKey.get(it.trackKey)!.title"
            size="s"
            class="cv"
          />
          <span class="text">
            <span class="t ellipsis">{{ library.byKey.get(it.trackKey)!.title }}</span>
            <span class="s ellipsis">{{ displayArtist(library.byKey.get(it.trackKey)!) }}</span>
          </span>
        </template>
        <span v-else class="text"><span class="t muted">Файл не найден</span></span>
        <button type="button" class="mini" aria-label="Убрать" @click="remove(it)"><IconRemove /></button>
        <span
          class="mini handle"
          aria-label="Перетащить"
          @pointerdown="drag.start($event, i)"
          @pointermove="drag.move"
          @pointerup="drag.end"
          @pointercancel="drag.end"
        >
          <IconDrag />
        </span>
      </div>
    </div>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.list {
  position: relative;
}
.item {
  position: absolute;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: 42px 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 0 6px 0 var(--gutter);
  transition: transform 180ms var(--ease-out);
}
.item.dragging {
  transition: none;
  z-index: 2;
  background: var(--surface-2);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.cv {
  width: 42px;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.t {
  font: 500 14.5px/1.25 var(--f-body);
}
.s {
  font-size: 12.5px;
  color: var(--ink-2);
}
.mini {
  width: 40px;
  height: 44px;
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.mini svg {
  width: 20px;
  height: 20px;
}
.handle {
  touch-action: none;
  cursor: grab;
}
</style>
