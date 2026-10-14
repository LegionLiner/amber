<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useUi } from '@/stores/ui'
import { albumIdOf, artistIdOf } from '@/domain/groups'
import { displayArtist, type Track } from '@/domain/track'

/**
 * Подпись трека ссылками: каждый исполнитель ведёт на свою страницу, альбом — на страницу альбома.
 * Стоит там, где трек показан «сам по себе»: плеер, панель плеера, карточка трека, таблица на компьютере.
 * В строках списка на телефоне ссылок нет: там нажатие по строке включает трек.
 */
const props = defineProps<{
  track: Track | null | undefined
  /** Что показать, пока трека нет в медиатеке (название из очереди) */
  fallback?: string
  /** Показывать альбом после исполнителей */
  album?: boolean
  /** Только альбом (колонка таблицы) */
  only?: 'album' | 'artists'
}>()
const router = useRouter()
const ui = useUi()

function go(path: string) {
  // Из большого плеера и очереди — сначала закрыть их: страница открывается под ними
  ui.fullPlayer = false
  ui.queueOpen = false
  void router.push(path)
}
const toArtist = (name: string) => go(`/artist/${encodeURIComponent(artistIdOf(name))}`)
const toAlbum = () => props.track && go(`/album/${encodeURIComponent(albumIdOf(props.track))}`)
</script>

<template>
  <span class="tl">
    <template v-if="only !== 'album'">
      <template v-if="track?.artists.length">
        <template v-for="(a, i) in track.artists" :key="a"
          ><button type="button" class="lnk" :title="`Исполнитель: ${a}`" @pointerdown.stop @click.stop="toArtist(a)">
            {{ a }}</button
          ><span v-if="i < track.artists.length - 1">, </span></template
        >
      </template>
      <template v-else>{{ fallback ?? (track ? displayArtist(track) : '') }}</template>
    </template>
    <template v-if="track?.album && (album || only === 'album')"
      ><span v-if="only !== 'album'" class="dot"> · </span
      ><button type="button" class="lnk" :title="`Альбом: ${track.album}`" @pointerdown.stop @click.stop="toAlbum">
        {{ track.album }}
      </button></template
    >
  </span>
</template>

<style scoped>
.lnk {
  display: inline;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.lnk:hover {
  color: var(--ink);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.lnk:active {
  opacity: 0.7;
}
</style>
