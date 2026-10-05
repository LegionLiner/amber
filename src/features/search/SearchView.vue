<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import IconSearch from '~icons/solar/magnifer-linear'
import IconClose from '~icons/solar/close-circle-bold'
import IconHistory from '~icons/solar/history-linear'
import IconFolder from '~icons/solar/folder-2-linear'
import IconDownload from '~icons/solar/download-minimalistic-linear'
import YoutubeSheet from './YoutubeSheet.vue'
import CoverArt from '@/components/CoverArt.vue'
import TrackRow from '@/components/TrackRow.vue'
import TrackActionsSheet from '@/components/TrackActionsSheet.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { LibrarySearch, latToRu, normalize, ruToLat, swapLayout } from '@/domain/search'
import type { Track } from '@/domain/track'
import { albumIdOf } from '@/domain/groups'
import type { PlaySource } from '@/native/types'
import { onPageShown } from '@/app/paging'

const library = useLibrary()
const player = usePlayer()
const settings = useSettings()
const ui = useUi()
const router = useRouter()

const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const q = refDebounced(query, 120)
const showAll = ref(false)

/** Индекс строится при первом поиске и перестраивается, когда меняется библиотека */
let index: LibrarySearch | null = null
let indexedFor: Track[] | null = null
function engine(): LibrarySearch {
  if (!index || indexedFor !== library.tracks) {
    index = new LibrarySearch(library.tracks)
    indexedFor = library.tracks
  }
  return index
}

/** В поиск вставили ссылку на YouTube — предлагаем скачать */
const ytLink = computed(() => /^\s*(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(query.value))
function openYoutube(url?: string) {
  ui.openSheet(YoutubeSheet, { url })
}

const trackResults = shallowRef<Track[]>([])
watch([q, () => library.tracks], () => {
  showAll.value = false
  if (!q.value.trim()) {
    trackResults.value = []
    return
  }
  trackResults.value = engine()
    .search(q.value)
    .map((k) => library.byKey.get(k))
    .filter((t): t is Track => !!t)
})

function matches(name: string, needle: string): boolean {
  const n = normalize(name)
  if (!n) return false
  return [needle, latToRu(needle), ruToLat(needle), normalize(swapLayout(needle))].some((v) => v && n.includes(v))
}

const needle = computed(() => normalize(q.value))
const artistResults = computed(() =>
  needle.value ? library.artists.filter((a) => matches(a.name, needle.value)).slice(0, 12) : [],
)
const albumResults = computed(() =>
  needle.value ? library.albums.filter((a) => matches(a.title, needle.value)).slice(0, 8) : [],
)
const folderResults = computed(() => {
  if (!needle.value) return []
  const seen = new Set<string>()
  for (const t of library.tracks) if (matches(t.folder.split('/').filter(Boolean).pop() ?? '', needle.value)) seen.add(t.folder)
  return [...seen].slice(0, 6)
})

const shownTracks = computed(() => (showAll.value ? trackResults.value : trackResults.value.slice(0, 30)))
const source = computed<PlaySource>(() => ({ type: 'search', title: `Поиск «${q.value.trim()}»` }))

function remember() {
  const v = query.value.trim()
  if (!v) return
  settings.s.recentSearches = [v, ...settings.s.recentSearches.filter((x) => x !== v)].slice(0, 12)
}

function play(i: number) {
  remember()
  void player.playTracks(trackResults.value, i, source.value, { shuffle: false })
}

let focusedOnce = false
onPageShown(() => {
  if (!focusedOnce) {
    focusedOnce = true
    setTimeout(() => input.value?.focus(), 250)
  }
})
watch(
  () => ui.reselect,
  (r) => {
    if (r.tab !== 'search') return
    query.value = ''
    input.value?.focus()
  },
)

/* Обработчики из нескольких действий — функциями: в шаблоне без «;» компилятор Vue их не разберёт */
function submit() {
  remember()
  input.value?.blur()
}
function clearQuery() {
  query.value = ''
  input.value?.focus()
}
function go(to: Parameters<typeof router.push>[0]) {
  remember()
  void router.push(to)
}
</script>

<template>
  <div class="scroll screen">
    <header class="hdr glass-hdr">
      <h1 class="display title">Поиск</h1>
      <label class="field">
        <IconSearch class="ic" />
        <input
          id="search-input"
          ref="input"
          v-model="query"
          type="search"
          enterkeyhint="search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="Трек, исполнитель, папка, заметка"
          @keydown.enter="submit"
        />
        <button v-if="query" type="button" class="clear" aria-label="Очистить" @click="clearQuery">
          <IconClose />
        </button>
      </label>
      <button v-if="!ytLink" type="button" class="yt-btn" @click="openYoutube()">
        <IconDownload />Скачать с YouTube по ссылке
      </button>
    </header>

    <button v-if="ytLink" type="button" class="yt-card" @click="openYoutube(query.trim())">
      <IconDownload />
      <span><b>Ссылка на YouTube</b><small>Скачать звук этого ролика в медиатеку</small></span>
    </button>

    <div v-if="!q.trim()" class="recent">
      <template v-if="settings.s.recentSearches.length">
        <div class="section-title">
          <span>Недавние запросы</span>
          <button type="button" class="more-link" @click="settings.s.recentSearches = []">очистить</button>
        </div>
        <button v-for="r in settings.s.recentSearches" :key="r" type="button" class="recent-row" @click="query = r">
          <IconHistory />{{ r }}
        </button>
      </template>
      <p v-else class="hint muted">Ищет с опечатками, транслитом и в неверной раскладке: «rbyj» найдёт «Кино».</p>
    </div>

    <template v-else>
      <section v-if="artistResults.length">
        <div class="section-title"><span>Исполнители</span></div>
        <div class="chips hscroll">
          <button
            v-for="a in artistResults"
            :key="a.id"
            type="button"
            class="chip"
            data-morph-card
            @click="go(`/artist/${encodeURIComponent(a.id)}`)"
          >
            <CoverArt :art="a.art" :seed="a.name" :label="a.name" size="s" radius="50%" class="av" />{{ a.name }}
          </button>
        </div>
      </section>

      <section v-if="trackResults.length">
        <div class="section-title">
          <span>Треки</span><span class="muted cnt">{{ trackResults.length }}</span>
        </div>
        <div v-for="(t, i) in shownTracks" :key="t.key" class="row">
          <TrackRow
            :track="t"
            :active="player.current?.key === t.key"
            :playing="player.playing"
            :meta="{ kind: 'stars', rating: t.rating }"
            @tap="play(i)"
            @more="ui.openSheet(TrackActionsSheet, { trackKey: t.key, source })"
            @swipe-right="player.playNext([t], source).then(() => ui.toast('Сыграет следующим'))"
            @swipe-left="library.toggleFavorite(t.key)"
          />
        </div>
        <button v-if="!showAll && trackResults.length > 30" type="button" class="btn all" @click="showAll = true">
          Показать все {{ trackResults.length }}
        </button>
      </section>

      <section v-if="albumResults.length">
        <div class="section-title"><span>Альбомы</span></div>
        <div class="albums hscroll">
          <button
            v-for="a in albumResults"
            :key="a.id"
            type="button"
            class="album"
            data-morph-card
            @click="go(`/album/${encodeURIComponent(albumIdOf({ album: a.title, albumArtist: a.artist }))}`)"
          >
            <CoverArt :art="a.art" :seed="a.seed" :label="a.title" size="m" radius="var(--r-m)" />
            <span class="ellipsis t">{{ a.title }}</span>
            <span class="ellipsis s">{{ a.artist }}</span>
          </button>
        </div>
      </section>

      <section v-if="folderResults.length">
        <div class="section-title"><span>Папки</span></div>
        <button
          v-for="f in folderResults"
          :key="f"
          type="button"
          class="recent-row"
          @click="go({ path: '/folder', query: { path: f } })"
        >
          <IconFolder />{{ f }}
        </button>
      </section>

      <div v-if="!trackResults.length && !artistResults.length && !albumResults.length && !folderResults.length" class="empty">
        <h3>Ничего не нашлось</h3>
        <p>Попробуй часть названия или имя файла.</p>
      </div>
    </template>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.yt-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--ink-2);
  font: 500 13px/1 var(--f-body);
}
.yt-btn svg,
.yt-card svg {
  width: 18px;
  height: 18px;
  flex: none;
}
.yt-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: calc(100% - 2 * var(--gutter));
  margin: 4px var(--gutter) 10px;
  padding: 14px 16px;
  border-radius: var(--r-m);
  background: rgba(var(--amber-rgb), 0.14);
  color: var(--amber-ink);
  text-align: left;
}
.yt-card span {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.yt-card b {
  font: 600 15px/1.2 var(--f-body);
}
.yt-card small {
  font-size: 12.5px;
  color: var(--ink-2);
}
.hdr {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: calc(var(--safe-top) + 18px) var(--gutter) 16px;
  margin-bottom: 8px;
  background: var(--bg);
}
.title {
  font-size: 26px;
  font-weight: 600;
  margin: 6px 0 12px;
}
.field {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 8px 0 14px;
  border-radius: 14px;
  background: var(--surface-2);
}
.field .ic {
  width: 20px;
  height: 20px;
  color: var(--ink-2);
  flex: none;
}
.field input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: none;
  outline: none;
  font-size: 16px;
}
.field input::-webkit-search-cancel-button {
  display: none;
}
.clear {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.clear svg {
  width: 20px;
  height: 20px;
}
.hint {
  padding: 24px var(--gutter);
  font-size: 14px;
  line-height: 1.5;
}
.recent-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 var(--gutter);
  text-align: left;
  font-size: 15px;
}
.recent-row svg {
  width: 20px;
  height: 20px;
  color: var(--ink-3);
  flex: none;
}
.cnt {
  font-size: 13px;
  font-weight: 500;
}
.row {
  height: 64px;
}
.all {
  margin: 8px var(--gutter);
  width: calc(100% - 2 * var(--gutter));
}
.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 0 var(--gutter) 4px;
  scrollbar-width: none;
}
.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px 5px 5px;
  border-radius: 999px;
  background: var(--surface);
  font: 500 14px/1 var(--f-body);
}
.av {
  width: 30px;
}
.albums {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 0 var(--gutter) 4px;
  scrollbar-width: none;
}
.album {
  flex: none;
  width: 120px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
}
.album :deep(.cover) {
  width: 120px;
  margin-bottom: 4px;
}
.album .t {
  font: 500 13.5px/1.25 var(--f-body);
}
.album .s {
  font-size: 12px;
  color: var(--ink-2);
}
</style>
