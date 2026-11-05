<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useUi } from '@/stores/ui'
import { albumIdOf, artistIdOf } from '@/domain/groups'
import { displayArtist, type Track } from '@/domain/track'
import { $t } from '@/i18n'

/**
 * Подпись трека ссылками: каждый исполнитель ведёт на свою страницу, альбом — на страницу альбома.
 * Стоит там, где трек показан «сам по себе»: плеер, панель плеера, карточка трека, таблица на компьютере.
 * В строках списка на телефоне ссылок нет: там нажатие по строке включает трек.
 *
 * Ссылки — строчные span, а не кнопки: кнопку браузер всегда рисует цельным блоком, и длинное имя
 * обрезалось посреди буквы без многоточия, а при переносе запятая уезжала в начало строки
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
          ><span
            role="link"
            tabindex="0"
            class="lnk"
            :title="$t('Исполнитель: {0}', a)"
            @pointerdown.stop
            @click.stop="toArtist(a)"
            @keydown.enter.prevent="toArtist(a)"
            >{{ a }}</span
          ><template v-if="i < track.artists.length - 1">, </template></template
        >
      </template>
      <template v-else>{{ fallback ?? (track ? displayArtist(track) : '') }}</template>
    </template>
    <!-- Точка держится за последним словом исполнителя (неразрывный пробел): при переносе не остаётся одна на строке -->
    <template v-if="track?.album && (album || only === 'album')"
      ><span v-if="only !== 'album'" class="dot">{{ '\u00a0· ' }}</span
      ><span
        role="link"
        tabindex="0"
        class="lnk"
        :title="$t('Альбом: {0}', track.album)"
        @pointerdown.stop
        @click.stop="toAlbum"
        @keydown.enter.prevent="toAlbum"
        >{{ track.album }}</span
      ></template
    >
  </span>
</template>

<style scoped>
.lnk {
  cursor: pointer;
}
.lnk:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 2px;
  border-radius: 3px;
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
