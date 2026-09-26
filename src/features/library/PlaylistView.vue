<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import IconMore from '~icons/solar/menu-dots-bold'
import IconOrder from '~icons/solar/sort-vertical-linear'
import IconRules from '~icons/solar/filter-linear'
import IconMix from '~icons/solar/transfer-horizontal-linear'
import IconAdd from '~icons/solar/add-circle-linear'
import CollectionPage from '@/components/CollectionPage.vue'
import NameSheet from '@/components/NameSheet.vue'
import PlaylistMenuSheet from './PlaylistMenuSheet.vue'
import { useLibrary } from '@/stores/library'
import { usePlaylists } from '@/stores/playlists'
import { toQueueItem, usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { playlistItems, type PlaylistItemRow } from '@/data/repos/playlists'
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
const ui = useUi()

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
const tracks = computed<Track[]>(() => {
  if (rules.value) return applyRules(library.tracks, rules.value)
  return items.value.map((i) => library.byKey.get(i.trackKey)).filter((t): t is Track => !!t)
})
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
  const p = info.value
  if (!p) return
  const actions = [
    ...(p.kind !== 'smart' ? [{ label: 'Добавить треки', icon: IconAdd, run: () => go(`/playlist/${p.id}/add`) }] : []),
    ...(p.kind === 'smart' ? [{ label: 'Условия', icon: IconRules, run: () => go(`/playlist/${p.id}/rules`) }] : []),
    ...(p.kind !== 'smart' ? [{ label: 'Изменить порядок', icon: IconOrder, run: () => go(`/playlist/${p.id}/order`) }] : []),
    ...(p.kind === 'mix' ? [{ label: 'Редактор стыков', icon: IconMix, run: () => go(`/mix/${p.id}`) }] : []),
  ]
  ui.openSheet(PlaylistMenuSheet, {
    name: p.name,
    actions,
    onRename: () =>
      ui.openSheet(NameSheet, {
        title: 'Переименовать',
        initial: p.name,
        confirm: 'Сохранить',
        onDone: (v: string) => playlists.rename(p.id, v),
      }),
    onDelete: async () => {
      await playlists.remove(p.id)
      ui.toast(`«${p.name}» удалён`)
      router.back()
    },
  })
}
function go(path: string) {
  ui.closeSheet()
  void router.push(path)
}
</script>

<template>
  <CollectionPage
    v-if="info"
    :kind="kindLabel"
    :title="info.name"
    :subtitle="subtitle || undefined"
    :tracks="tracks"
    :source="source"
    :meta="metaFor('rating')"
    :play="info.kind === 'mix' ? playMix : undefined"
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
