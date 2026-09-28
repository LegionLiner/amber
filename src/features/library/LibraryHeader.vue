<script setup lang="ts">
import { useRouter } from 'vue-router'
import IconRefresh from '~icons/solar/refresh-linear'
import ChipTabs from '@/components/ChipTabs.vue'
import { useLibrary } from '@/stores/library'

export type LibrarySection = 'tracks' | 'playlists' | 'albums' | 'artists' | 'folders' | 'genres' | 'favorites'

defineProps<{ section: LibrarySection }>()
const router = useRouter()
const library = useLibrary()

const SECTIONS: { id: LibrarySection; label: string }[] = [
  { id: 'tracks', label: 'Треки' },
  { id: 'playlists', label: 'Плейлисты' },
  { id: 'albums', label: 'Альбомы' },
  { id: 'artists', label: 'Исполнители' },
  { id: 'folders', label: 'Папки' },
  { id: 'genres', label: 'Жанры' },
  { id: 'favorites', label: 'Избранное' },
]

/** Раздел — экран ленты: лента сама доедет до него */
function select(id: LibrarySection) {
  void router.replace(`/library/${id}`)
}
</script>

<template>
  <header class="hdr">
    <div class="top">
      <h1 class="display title">Медиатека</h1>
      <button
        type="button"
        class="icon-btn"
        :class="{ spin: library.scanning }"
        aria-label="Обновить библиотеку"
        @click="library.scan(false)"
      >
        <IconRefresh />
      </button>
    </div>
    <p v-if="library.scanning" class="scan muted">
      Ищу изменения{{ library.progress ? ` · ${library.progress.done} из ${library.progress.total}` : '…' }}
    </p>
  </header>
  <ChipTabs :items="SECTIONS" :model-value="section" @update:model-value="select" />
</template>

<style scoped>
.hdr {
  padding: calc(var(--safe-top) + 10px) var(--gutter) 6px;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
}
.title {
  font-size: 26px;
  font-weight: 600;
}
.scan {
  font-size: 12.5px;
  margin-top: 2px;
}
.spin :deep(svg) {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
