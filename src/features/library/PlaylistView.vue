<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import IconMore from '~icons/solar/menu-dots-bold'
import IconMix from '~icons/solar/transfer-horizontal-linear'
import IconAdd from '~icons/solar/add-circle-linear'
import CollectionPage from '@/components/CollectionPage.vue'
import { openPlaylistMenu } from './playlistMenu'
import { useLibrary } from '@/stores/library'
import { usePlaylists } from '@/stores/playlists'
import { toQueueItem, usePlayer } from '@/stores/player'
import { playlistItems, reorderPlaylist, type PlaylistItemRow } from '@/data/repos/playlists'
import type { RowDetail } from '@/components/TrackRow.vue'
import { formatDuration, relativeDay } from '@/domain/format'
import { applyRules, describe, parseRules } from '@/domain/smart'
import { applyMixTransition, parseTransition } from '@/domain/mix'
import { orderFor } from '@/domain/shuffle'
import type { Track } from '@/domain/track'
import type { PlaySource } from '@/native/types'
import { metaFor } from './rowMeta'

const route = useViewRoute()
const router = useRouter()
const library = useLibrary()
const playlists = usePlaylists()
const player = usePlayer()

const id = computed(() => Number(route.params.id))
const info = computed(() => playlists.list.find((p) => p.id === id.value))
const items = shallowRef<PlaylistItemRow[]>([])
const loaded = ref(false)

watch(
  [id, () => playlists.version],
  async () => {
    if (!Number.isFinite(id.value)) return
    if (!playlists.loaded) await playlists.refresh()
    items.value = info.value?.kind === 'smart' ? [] : await playlistItems(id.value)
    loaded.value = true
  },
  { immediate: true },
)

const rules = computed(() => (info.value?.kind === 'smart' ? parseRules(info.value.rules) : null))
/** Строки, чьи треки есть на устройстве: по ним и места, и перестановка */
const present = computed(() =>
  items.value.flatMap((i) => {
    const t = library.byKey.get(i.trackKey)
    return t ? [{ i, t }] : []
  }),
)
const tracks = computed<Track[]>(() => (rules.value ? applyRules(library.tracks, rules.value) : present.value.map((x) => x.t)))

function detail(t: Track, index: number): RowDetail {
  const added = rules.value ? null : (present.value[index]?.i.addedAt ?? null)
  return {
    album: t.album ?? '',
    added: rules.value ? null : added ? relativeDay(added) : '',
    duration: formatDuration(t.durationMs),
  }
}

/** Новый порядок виден сразу, в базу уходит следом; треки без файла остаются в конце */
function reorder(from: number, to: number) {
  const list = present.value.map((x) => x.i)
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved!)
  const shown = new Set(list.map((i) => i.id))
  items.value = [...list, ...items.value.filter((i) => !shown.has(i.id))]
  void reorderPlaylist(
    id.value,
    items.value.map((i) => i.id),
  ).then(() => playlists.refresh())
}
const source = computed<PlaySource>(() => ({
  type: info.value?.kind === 'smart' ? 'smart' : 'playlist',
  id: String(id.value),
  title: info.value?.name,
}))
const kindLabel = computed(() =>
  info.value?.kind === 'smart' ? 'Умный плейлист' : info.value?.kind === 'mix' ? 'Микс' : 'Плейлист',
)
const subtitle = computed(() => (rules.value ? rules.value.conditions.map(describe).join(' · ') || 'Все треки' : ''))

/** Микс играет со своими переходами на стыках */
async function playMix(index: number, shuffle: boolean) {
  const list = items.value
    .map((i) => ({ i, t: library.byKey.get(i.trackKey) }))
    .filter((x): x is { i: PlaylistItemRow; t: Track } => !!x.t)
  if (!list.length) return
  if (shuffle) {
    await player.playTracks(
      orderFor(
        'normal',
        list.map((x) => x.t),
      ),
      0,
      source.value,
      { shuffle: false },
    )
    return
  }
  const queue = list.map(({ i, t }, n) =>
    applyMixTransition(toQueueItem(t, source.value), n > 0 ? parseTransition(i.transition) : null),
  )
  await player.setQueue(queue, Math.max(0, index))
}

function menu() {
  if (info.value) openPlaylistMenu(info.value, router, () => router.back())
}
</script>

<template>
  <CollectionPage
    v-if="info"
    :kind="kindLabel"
    :title="info.name"
    :art="info.cover"
    :subtitle="subtitle || undefined"
    :tracks="tracks"
    :source="source"
    :meta="metaFor('rating')"
    :play="info.kind === 'mix' ? playMix : undefined"
    positions
    :detail="detail"
    :reorder="info.kind === 'smart' ? undefined : reorder"
  >
    <template #actions>
      <button type="button" class="icon-btn" aria-label="Меню плейлиста" @click="menu"><IconMore /></button>
    </template>
    <template #extra>
      <button v-if="info.kind !== 'smart'" type="button" class="btn addbtn" @click="router.push(`/playlist/${info.id}/add`)">
        <IconAdd />Добавить треки
      </button>
      <p v-if="loaded && !tracks.length && info.kind !== 'smart'" class="hint muted">
        Пока пусто: нажми «Добавить треки» или долгое нажатие на любой трек → «Добавить в плейлист».
      </p>
      <p v-else-if="info.kind === 'smart' && !tracks.length" class="hint muted">Под условия пока ничего не подходит.</p>
      <button
        v-if="info.kind === 'mix' && tracks.length > 1"
        type="button"
        class="btn mixbtn"
        @click="router.push(`/mix/${info.id}`)"
      >
        <IconMix />Стыки микса
      </button>
    </template>
  </CollectionPage>
  <div v-else-if="playlists.loaded" class="empty"><h3>Плейлист не найден</h3></div>
</template>

<style scoped>
.hint {
  margin-top: 16px;
  font-size: 13.5px;
}
.mixbtn {
  margin-top: 12px;
}
.addbtn {
  margin-top: 12px;
  min-height: 40px;
  padding: 0 16px;
  font-size: 14px;
  color: var(--amber-ink);
}
</style>
