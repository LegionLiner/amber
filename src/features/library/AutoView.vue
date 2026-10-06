<script setup lang="ts">
import { computed, onActivated, ref, shallowRef, watch } from 'vue'
import { useViewRoute } from '@/app/view-route'
import CollectionPage from '@/components/CollectionPage.vue'
import { useLibrary } from '@/stores/library'
import { loadAutoContext } from '@/data/repos/auto'
import { AUTO_PLAYLISTS, buildAuto, type AutoId } from '@/domain/auto'
import type { Track } from '@/domain/track'
import { metaFor, tableFor } from './rowMeta'

const route = useViewRoute()
const library = useLibrary()
const id = computed(() => String(route.params.id) as AutoId)
const def = computed(() => AUTO_PLAYLISTS.find((a) => a.id === id.value))
const tracks = shallowRef<Track[]>([])
const loaded = ref(false)

async function load() {
  if (!def.value) return
  const ctx = await loadAutoContext()
  tracks.value = buildAuto(id.value, library.tracks, ctx)
  loaded.value = true
}
watch([id, () => library.tracks], load, { immediate: true })
onActivated(load)

/** По чему собрана подборка — то и видно в строке (а в окне компьютера — в третьей колонке таблицы) */
const sortKey = computed(() => {
  if (id.value === 'eternal' || id.value === 'onRepeat') return 'plays'
  if (id.value === 'recentlyAdded') return 'added'
  if (id.value === 'forgotten') return 'lastPlayed'
  if (id.value === 'skipped') return 'skips'
  return 'rating'
})
const meta = computed(() => metaFor(sortKey.value))
const table = computed(() => tableFor(sortKey.value === 'rating' ? 'plays' : sortKey.value))

const EMPTY: Partial<Record<AutoId, string>> = {
  now: 'Подборка появится, когда наберётся история: нужно хотя бы три прослушивания трека в это время суток.',
  onRepeat: 'Сюда попадают треки, которые за две недели звучат заметно чаще обычного.',
  forgotten: 'Здесь будут любимые треки, которые ты не слушал больше двух месяцев.',
  yearAgo: 'Через год здесь будет то, что звучит сейчас.',
}
</script>

<template>
  <CollectionPage
    v-if="def"
    kind="Подборка"
    :title="def.title"
    :subtitle="loaded ? undefined : def.hint"
    :tracks="tracks"
    :source="{ type: 'smart', id: def.id, title: def.title }"
    :meta="meta"
    :detail="table?.of"
    :extra-label="table?.label"
  >
    <template #extra>
      <p class="hint muted">{{ loaded && !tracks.length ? (EMPTY[def.id] ?? 'Пока пусто.') : def.hint }}</p>
    </template>
  </CollectionPage>
  <div v-else class="empty"><h3>Подборка не найдена</h3></div>
</template>

<style scoped>
.hint {
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.45;
  max-width: 34ch;
}
</style>
