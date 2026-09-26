<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import IconNext from '~icons/solar/list-arrow-down-linear'
import IconQueue from '~icons/solar/playlist-linear'
import IconHeart from '~icons/solar/heart-linear'
import IconHeartOn from '~icons/solar/heart-bold'
import IconCard from '~icons/solar/document-text-linear'
import IconAlbum from '~icons/solar/album-linear'
import IconArtist from '~icons/solar/user-rounded-linear'
import IconFolder from '~icons/solar/folder-2-linear'
import IconHide from '~icons/solar/eye-closed-linear'
import IconShow from '~icons/solar/eye-linear'
import IconAddList from '~icons/solar/add-square-linear'
import IconRemove from '~icons/solar/minus-circle-linear'
import IconRadio from '~icons/solar/radio-linear'
import IconTags from '~icons/solar/pen-new-square-linear'
import AddToPlaylistSheet from './AddToPlaylistSheet.vue'
import TagEditorSheet from './TagEditorSheet.vue'
import { useRadio } from '@/stores/radio'
import { usePlaylists } from '@/stores/playlists'
import CoverArt from './CoverArt.vue'
import RatingStars from './RatingStars.vue'
import type { PlaySource } from '@/native/types'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { displayArtist } from '@/domain/track'
import { albumIdOf, artistIdOf } from '@/domain/groups'
import { upsertTrackUser } from '@/data/repos/library'
import { haptic } from '@/native/haptics'

const props = defineProps<{ trackKey: string; source: PlaySource }>()
const emit = defineEmits<{ close: [] }>()

const library = useLibrary()
const player = usePlayer()
const ui = useUi()
const router = useRouter()
const playlists = usePlaylists()
const radio = useRadio()

const t = computed(() => library.byKey.get(props.trackKey))

async function run(fn: () => unknown) {
  await fn()
  emit('close')
}

const actions = computed(() => {
  const track = t.value
  if (!track) return []
  return [
    {
      icon: IconNext,
      label: 'Играть следующим',
      run: () =>
        run(async () => {
          await player.playNext([track], props.source)
          ui.toast('Сыграет следующим')
        }),
    },
    {
      icon: IconQueue,
      label: 'Добавить в очередь',
      run: () =>
        run(async () => {
          await player.addToQueue([track], props.source)
          ui.toast('Добавлено в очередь')
        }),
    },
    {
      icon: track.favoriteAt ? IconHeartOn : IconHeart,
      label: track.favoriteAt ? 'Убрать из избранного' : 'В избранное',
      accent: !!track.favoriteAt,
      run: () =>
        run(async () => {
          await library.toggleFavorite(track.key)
          haptic.success()
        }),
    },
    {
      icon: IconAddList,
      label: 'Добавить в плейлист',
      run: () => ui.openSheet(AddToPlaylistSheet, { keys: [track.key] }),
    },
    {
      icon: IconRadio,
      label: 'Радио по этому треку',
      run: () =>
        run(async () => {
          await radio.start([track])
          ui.toast('Радио: дальше похожее из твоей музыки')
        }),
    },
    {
      icon: IconTags,
      label: 'Изменить теги',
      run: () => ui.openSheet(TagEditorSheet, { keys: [track.key] }),
    },
    ...(props.source.type === 'playlist' && props.source.id
      ? [
          {
            icon: IconRemove,
            label: 'Убрать из этого плейлиста',
            run: () =>
              run(async () => {
                await playlists.removeTrack(Number(props.source.id), track.key)
                ui.toast('Убрано из плейлиста')
              }),
          },
        ]
      : []),
    { icon: IconCard, label: 'Карточка трека', run: () => run(() => router.push(`/track/${track.key}`)) },
    ...(track.album
      ? [
          {
            icon: IconAlbum,
            label: 'Альбом',
            run: () => run(() => router.push(`/album/${encodeURIComponent(albumIdOf(track))}`)),
          },
        ]
      : []),
    ...track.artists.map((name) => ({
      icon: IconArtist,
      label: name,
      run: () => run(() => router.push(`/artist/${encodeURIComponent(artistIdOf(name))}`)),
    })),
    { icon: IconFolder, label: 'Папка', run: () => run(() => router.push({ path: '/folder', query: { path: track.folder } })) },
    {
      icon: track.noShuffle ? IconShow : IconHide,
      label: track.noShuffle ? 'Вернуть в перемешивание' : 'Не играть в перемешивании',
      run: () =>
        run(async () => {
          const noShuffle = !track.noShuffle
          library.patch(track.key, { noShuffle })
          await upsertTrackUser(track.key, { noShuffle: noShuffle ? 1 : 0 })
        }),
    },
  ]
})

function rate(v: number | null) {
  if (t.value) void library.setRating(t.value.key, v)
}
</script>

<template>
  <div v-if="t" class="body scroll">
    <div class="head">
      <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="m" radius="var(--r-m)" class="cv" />
      <div class="meta">
        <div class="title">{{ t.title }}</div>
        <div class="sub ellipsis">{{ displayArtist(t) }}</div>
      </div>
    </div>
    <div class="rate">
      <RatingStars :model-value="t.rating" :size="30" @update:model-value="rate" />
      <span class="hint">{{ t.plays ? `${t.plays} прослуш.` : 'ещё не слушал' }}</span>
    </div>
    <div class="list">
      <button v-for="a in actions" :key="a.label" type="button" class="act" :class="{ accent: a.accent }" @click="a.run()">
        <component :is="a.icon" />
        <span class="ellipsis">{{ a.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.body {
  padding: 0 0 8px;
}
.head {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 14px;
  align-items: center;
  padding: 4px var(--gutter) 6px;
}
.cv {
  width: 56px;
}
.title {
  font: 600 16px/1.25 var(--f-body);
}
.sub {
  margin-top: 3px;
  color: var(--ink-2);
  font-size: 13.5px;
}
.rate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px var(--gutter) 8px;
  border-bottom: 1px solid var(--line);
}
.hint {
  color: var(--ink-3);
  font-size: 12.5px;
}
.list {
  display: flex;
  flex-direction: column;
  padding-top: 6px;
}
.act {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 16px;
  align-items: center;
  min-height: 52px;
  padding: 0 var(--gutter);
  text-align: left;
  font: 500 15px/1.2 var(--f-body);
}
.act:active {
  background: var(--chip);
}
.act svg {
  width: 22px;
  height: 22px;
  color: var(--ink-2);
}
.act.accent svg {
  color: var(--heart);
}
</style>
