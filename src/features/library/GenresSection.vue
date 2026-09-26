<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import IconTag from '~icons/solar/hashtag-linear'
import LibraryHeader from './LibraryHeader.vue'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { countLabel } from '@/domain/format'

const library = useLibrary()
const ui = useUi()
const router = useRouter()
const scrollEl = ref<HTMLElement | null>(null)

watch(
  () => ui.reselect,
  (r) => r.tab === 'library' && scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' }),
)
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <LibraryHeader section="genres" />
    <button
      v-for="g in library.genres"
      :key="g.id"
      type="button"
      class="row"
      @click="router.push(`/genre/${encodeURIComponent(g.id)}`)"
    >
      <span class="ic"><IconTag /></span>
      <span class="t ellipsis">{{ g.name }}</span>
      <span class="n muted num">{{ countLabel(g.tracks.length, ['трек', 'трека', 'треков']) }}</span>
    </button>
    <div v-if="library.loaded && !library.genres.length" class="empty">
      <h3>Жанров нет</h3>
      <p>В файлах не заполнен жанр. Скоро здесь появятся твои теги вроде #драйв или #осень.</p>
    </div>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.row {
  width: 100%;
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px var(--gutter);
  text-align: left;
}
.row:active {
  background: var(--surface);
}
.ic {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--surface-2);
  color: var(--amber-ink);
}
.ic svg {
  width: 20px;
  height: 20px;
}
.t {
  font: 500 15px/1.25 var(--f-body);
}
.n {
  font-size: 12.5px;
}
</style>
