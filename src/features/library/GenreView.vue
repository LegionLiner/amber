<script setup lang="ts">
import { computed } from 'vue'
import { useViewRoute } from '@/app/view-route'
import CollectionPage from '@/components/CollectionPage.vue'
import { useLibrary } from '@/stores/library'
import { sortTracks } from '@/domain/sort'
import { metaFor } from './rowMeta'

const route = useViewRoute()
const library = useLibrary()
const id = computed(() => decodeURIComponent(String(route.params.id ?? '')))
const genre = computed(() => library.genres.find((g) => g.id === id.value))
const tracks = computed(() => (genre.value ? sortTracks(genre.value.tracks, 'rating', 'desc') : []))
</script>

<template>
  <CollectionPage
    v-if="genre"
    kind="Жанр"
    :title="genre.name"
    :tracks="tracks"
    :source="{ type: 'genre', id: genre.id, title: genre.name }"
    :meta="metaFor('rating')"
  />
  <div v-else class="empty"><h3>Жанр не найден</h3></div>
</template>
