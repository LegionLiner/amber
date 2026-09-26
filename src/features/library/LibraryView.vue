<script setup lang="ts">
import { computed } from 'vue'
import { useViewRoute } from '@/app/view-route'
import TracksSection from './TracksSection.vue'
import AlbumsSection from './AlbumsSection.vue'
import ArtistsSection from './ArtistsSection.vue'
import FoldersSection from './FoldersSection.vue'
import GenresSection from './GenresSection.vue'
import FavoritesSection from './FavoritesSection.vue'
import PlaylistsSection from './PlaylistsSection.vue'

const route = useViewRoute()
const section = computed(() => (route.params.section as string | undefined) || 'tracks')
const views = {
  tracks: TracksSection,
  albums: AlbumsSection,
  artists: ArtistsSection,
  folders: FoldersSection,
  genres: GenresSection,
  favorites: FavoritesSection,
  playlists: PlaylistsSection,
} as const
const view = computed(() => views[section.value as keyof typeof views] ?? TracksSection)
</script>

<template>
  <div class="screen">
    <component :is="view" />
  </div>
</template>
