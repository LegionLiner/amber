<script setup lang="ts">
import { computed } from 'vue'
import { useViewRoute } from '@/app/view-route'
import IconRadio from '~icons/solar/radio-linear'
import CollectionPage from '@/components/CollectionPage.vue'
import { useLibrary } from '@/stores/library'
import { useRadio } from '@/stores/radio'
import { useUi } from '@/stores/ui'
import { sortTracks } from '@/domain/sort'
import { formatListen, countLabel } from '@/domain/format'
import { metaFor, tableFor } from './rowMeta'

const route = useViewRoute()
const library = useLibrary()
const radio = useRadio()
const ui = useUi()
const table = tableFor('plays')
const id = computed(() => decodeURIComponent(String(route.params.id ?? '')))
const artist = computed(() => library.artists.find((a) => a.id === id.value))
const tracks = computed(() => (artist.value ? sortTracks(artist.value.tracks, 'plays', 'desc') : []))
const subtitle = computed(() => {
  const a = artist.value
  if (!a) return ''
  const ms = a.tracks.reduce((s, t) => s + t.listenedMs, 0)
  const parts = [countLabel(a.tracks.length, ['трек', 'трека', 'треков'])]
  if (a.plays) parts.push(`${a.plays} прослуш.`, `${formatListen(ms)} вместе`)
  return parts.join(' · ')
})

/** Радио исполнителя: зёрна — его самые слушаемые треки, дальше похожее из всей медиатеки */
async function startRadio() {
  const a = artist.value
  if (!a) return
  await radio.start(tracks.value.slice(0, 5), `Радио: ${a.name}`)
  ui.fullPlayer = true
}
</script>

<template>
  <CollectionPage
    v-if="artist"
    kind="Исполнитель"
    :title="artist.name"
    :subtitle="subtitle"
    :art="artist.art"
    :seed="artist.name"
    :tracks="tracks"
    :source="{ type: 'artist', id: artist.id, title: artist.name }"
    :meta="metaFor('plays')"
    :detail="table?.of"
    :extra-label="table?.label"
    round
  >
    <template #actions>
      <button type="button" class="icon-btn" aria-label="Радио исполнителя" @click="startRadio"><IconRadio /></button>
    </template>
  </CollectionPage>
  <div v-else class="empty"><h3>Исполнитель не найден</h3></div>
</template>
