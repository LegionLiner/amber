<script setup lang="ts">
import { computed, onActivated, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import { refDebounced } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import IconBack from '~icons/solar/alt-arrow-left-linear'
import IconSearch from '~icons/solar/magnifer-linear'
import IconClose from '~icons/solar/close-circle-bold'
import IconAdd from '~icons/solar/add-circle-linear'
import IconCheck from '~icons/solar/check-circle-bold'
import CoverArt from '@/components/CoverArt.vue'
import ChipTabs from '@/components/ChipTabs.vue'
import { useLibrary } from '@/stores/library'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { playlistItems } from '@/data/repos/playlists'
import { LibrarySearch } from '@/domain/search'
import { sortTracks } from '@/domain/sort'
import { displayArtist, type Track } from '@/domain/track'
import { countLabel } from '@/domain/format'
import { haptic } from '@/native/haptics'
import { $t, $tp } from '@/i18n'

/**
 * Подбор треков прямо из плейлиста: поиск по всей медиатеке, у каждого трека отметка,
 * есть ли он уже в плейлисте. Тап добавляет, повторный тап убирает — сразу, без кнопки «Сохранить».
 */
const route = useViewRoute()
const router = useRouter()
const library = useLibrary()
const playlists = usePlaylists()
const ui = useUi()

const id = computed(() => Number(route.params.id))
const info = computed(() => playlists.list.find((p) => p.id === id.value))

/** Ключи треков, которые уже лежат в плейлисте */
const inList = shallowRef(new Set<string>())
const changed = ref(0)
async function load() {
  if (!Number.isFinite(id.value)) return
  if (!playlists.loaded) await playlists.refresh()
  inList.value = new Set((await playlistItems(id.value)).map((i) => i.trackKey))
}
watch(id, load, { immediate: true })
onActivated(() => {
  changed.value = 0
  void load()
})

type Filter = 'all' | 'new' | 'fav' | 'top'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: $t('Все') },
  { id: 'new', label: $t('Новые') },
  { id: 'fav', label: $t('Любимые') },
  { id: 'top', label: $t('Частые') },
]
const filter = ref<Filter>('all')
const query = ref('')
const q = refDebounced(query, 120)

let index: LibrarySearch | null = null
let indexedFor: Track[] | null = null
function engine(): LibrarySearch {
  if (!index || indexedFor !== library.tracks) {
    index = new LibrarySearch(library.tracks)
    indexedFor = library.tracks
  }
  return index
}

const list = computed<Track[]>(() => {
  const text = q.value.trim()
  let base = text
    ? engine()
        .search(text, 500)
        .map((k) => library.byKey.get(k))
        .filter((t): t is Track => !!t)
    : library.tracks
  if (filter.value === 'fav') base = base.filter((t) => t.favoriteAt || (t.rating ?? 0) >= 8)
  // При поиске порядок — по совпадению, иначе по выбранной вкладке
  if (text) return filter.value === 'fav' ? base : base.slice()
  if (filter.value === 'new') return sortTracks(base, 'added', 'desc')
  if (filter.value === 'top') return sortTracks(base, 'plays', 'desc')
  if (filter.value === 'fav') return sortTracks(base, 'rating', 'desc')
  return sortTracks(base, 'title', 'asc')
})

const ROW_H = 64
const scrollEl = ref<HTMLElement | null>(null)
const virt = useVirtualizer(
  computed(() => ({
    count: list.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => ROW_H,
    overscan: 10,
    getItemKey: (i: number) => list.value[i]?.key ?? i,
  })),
)
const rows = computed(() => virt.value.getVirtualItems())
watch([q, filter], () => scrollEl.value?.scrollTo({ top: 0 }))

/** Последний тронутый трек: у его галочки короткая анимация */
const popped = ref<string | null>(null)

async function toggle(t: Track) {
  const had = inList.value.has(t.key)
  // Сразу показываем результат, база догоняет
  const next = new Set(inList.value)
  if (had) next.delete(t.key)
  else next.add(t.key)
  inList.value = next
  popped.value = had ? null : t.key
  changed.value += had ? -1 : 1
  haptic.tick()
  try {
    if (had) await playlists.removeTrack(id.value, t.key)
    else await playlists.add(id.value, [t.key])
  } catch (e) {
    const back = new Set(inList.value)
    if (had) back.add(t.key)
    else back.delete(t.key)
    inList.value = back
    changed.value += had ? 1 : -1
    ui.toast($t('Не получилось: {0}', e instanceof Error ? e.message : String(e)))
  }
}

function done() {
  if (changed.value > 0) ui.toast($t('Добавлено: {0}', countLabel(changed.value, $tp('трек|трека|треков'))))
  router.back()
}
</script>

<template>
  <div class="screen add">
    <header class="hdr glass-hdr">
      <div class="bar">
        <button type="button" class="icon-btn" :aria-label="$t('Назад')" @click="router.back()"><IconBack /></button>
        <div class="ttl">
          <h1 class="ellipsis">{{ $t('Добавить треки') }}</h1>
          <small class="ellipsis">
            {{ $t('в «{0}» · {1}', info?.name ?? '…', countLabel(inList.size, $tp('трек|трека|треков'))) }}
          </small>
        </div>
        <button type="button" class="done" @click="done">{{ $t('Готово') }}</button>
      </div>
      <label class="field">
        <IconSearch class="ic" />
        <input
          id="playlist-add-search"
          v-model="query"
          type="search"
          :placeholder="$t('Название, исполнитель, альбом')"
          enterkeyhint="search"
        />
        <button v-if="query" type="button" class="clear" :aria-label="$t('Очистить')" @click="query = ''"><IconClose /></button>
      </label>
      <ChipTabs v-model="filter" :items="FILTERS" />
    </header>

    <div ref="scrollEl" class="scroll list">
      <div :style="{ height: `${virt.getTotalSize()}px`, position: 'relative' }">
        <button
          v-for="r in rows"
          :key="String(r.key)"
          type="button"
          class="row"
          :class="{ in: inList.has(list[r.index]!.key) }"
          :style="{ transform: `translateY(${r.start}px)` }"
          :aria-pressed="inList.has(list[r.index]!.key)"
          @click="toggle(list[r.index]!)"
        >
          <CoverArt :art="list[r.index]!.art" :seed="list[r.index]!.title" :label="list[r.index]!.title" size="s" class="cv" />
          <span class="text">
            <span class="t ellipsis">{{ list[r.index]!.title }}</span>
            <span class="s ellipsis">
              <b v-if="inList.has(list[r.index]!.key)" class="here">{{ $t('уже в плейлисте ·') }} </b
              >{{ displayArtist(list[r.index]!) }}
            </span>
          </span>
          <span class="mark">
            <IconCheck v-if="inList.has(list[r.index]!.key)" class="on" :class="{ pop: popped === list[r.index]!.key }" />
            <IconAdd v-else />
          </span>
        </button>
      </div>
      <div v-if="!list.length" class="empty">
        <h3>{{ q.trim() ? $t('Ничего не нашлось') : $t('Здесь пусто') }}</h3>
      </div>
      <div class="bottom-space" />
    </div>
  </div>
</template>

<style scoped>
.add {
  display: flex;
  flex-direction: column;
}
.hdr {
  flex: none;
  padding-top: calc(var(--safe-top) + 4px);
  background: var(--bg);
}
.bar {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: center;
  gap: 8px;
  height: 52px;
  /* От полей экрана: на телефоне это прежние 6 и 8 px, в широком окне шапка встаёт в колонку со списком */
  padding: 0 calc(var(--gutter) - 8px) 0 calc(var(--gutter) - 10px);
}
/* В окне компьютера «Готово» встаёт ровно над правым краем поля поиска */
:root.desktop .bar {
  padding-right: var(--gutter);
}
.ttl {
  min-width: 0;
  line-height: 1.2;
}
.ttl h1 {
  font: 600 17px/1.2 var(--f-body);
}
.ttl small {
  display: block;
  font-size: 12.5px;
  color: var(--ink-2);
}
.done {
  padding: 9px 14px;
  border-radius: 999px;
  background: rgba(var(--amber-rgb), 0.16);
  color: var(--amber-ink);
  font: 600 14px/1 var(--f-body);
}
.done:active {
  transform: scale(0.95);
}
.field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px var(--gutter) 10px;
  height: 46px;
  padding: 0 12px;
  border-radius: 14px;
  background: var(--surface-2);
}
.field .ic {
  width: 20px;
  height: 20px;
  color: var(--ink-3);
  flex: none;
}
.field input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 15px;
}
.field input::-webkit-search-cancel-button {
  display: none;
}
.clear {
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.clear svg {
  width: 20px;
  height: 20px;
}
.list {
  flex: 1;
  min-height: 0;
}
.row {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 64px;
  display: grid;
  grid-template-columns: 46px 1fr 40px;
  gap: 12px;
  align-items: center;
  padding: 0 var(--gutter);
  text-align: left;
  transition: background var(--t-fast) var(--ease);
}
.row:active {
  background: var(--surface);
}
.cv {
  width: 46px;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.t {
  font: 500 15px/1.25 var(--f-body);
}
.s {
  font-size: 12.5px;
  color: var(--ink-2);
}
.here {
  font-weight: 600;
  color: var(--amber-ink);
}
.mark {
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.mark svg {
  width: 26px;
  height: 26px;
}
.mark .on {
  color: var(--amber);
}
.row.in .t {
  color: var(--amber-ink);
}
</style>
