<script setup lang="ts">
import { computed } from 'vue'
import { useViewRoute } from '@/app/view-route'
import IconTags from '~icons/solar/pen-new-square-linear'
import CollectionPage from '@/components/CollectionPage.vue'
import TagEditorSheet from '@/components/TagEditorSheet.vue'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { formatListen, countLabel } from '@/domain/format'
import { tableFor } from './rowMeta'

const route = useViewRoute()
const library = useLibrary()
const ui = useUi()
const table = tableFor('plays', false)
const id = computed(() => decodeURIComponent(String(route.params.id ?? '')))
const album = computed(() => library.albums.find((a) => a.id === id.value))
const subtitle = computed(() => {
  const a = album.value
  if (!a) return ''
  const parts = [a.artist || 'Разные исполнители']
  if (a.year) parts.push(String(a.year))
  parts.push(countLabel(a.tracks.length, ['трек', 'трека', 'треков']), formatListen(a.durationMs))
  return parts.join(' · ')
})

/** Теги сразу всего альбома: исполнитель, название, жанр, год */
function editTags() {
  if (album.value) ui.openSheet(TagEditorSheet, { keys: album.value.tracks.map((t) => t.key) })
}
</script>

<template>
  <CollectionPage
    v-if="album"
    kind="Альбом"
    :title="album.title"
    :subtitle="subtitle"
    :art="album.art"
    :seed="album.seed"
    :tracks="album.tracks"
    :source="{ type: 'album', id: album.id, title: album.title }"
    numbered
    :detail="table?.of"
    :extra-label="table?.label"
  >
    <template #actions>
      <button type="button" class="icon-btn" aria-label="Теги альбома" @click="editTags"><IconTags /></button>
    </template>
  </CollectionPage>
  <div v-else class="empty"><h3>Альбом не найден</h3></div>
</template>
