<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { dataRev } from '@/app/data-rev'
import { readSpotifyFiles } from '@/app/spotify-import'
import {
  clearSpotify,
  importSpotify,
  rematchSpotify,
  setSpotifyEnabled,
  spotifyEnabled,
  spotifySummary,
  spotifyTopArtists,
  type SpotifySummary,
  type SpotifyTopArtist,
} from '@/data/repos/spotify'
import { countLabel, formatDate, formatListen } from '@/domain/format'
import { LOCALE, $t, $tp } from '@/i18n'

/**
 * Настройки → Spotify. Загрузка выгрузки «Расширенная история прослушиваний» (my_spotify_data.zip)
 * и переключатель: показывать её в статистике или нет. Выключение ничего не удаляет.
 */
const library = useLibrary()
const settings = useSettings()
const ui = useUi()

const on = ref(false)
const summary = shallowRef<SpotifySummary | null>(null)
const artists = shallowRef<SpotifyTopArtist[]>([])
const busy = ref(false)
const progress = ref('')
const confirmClear = ref(false)
const input = ref<HTMLInputElement | null>(null)

async function load() {
  const [e, s, a] = await Promise.all([spotifyEnabled(), spotifySummary(), spotifyTopArtists(5)])
  on.value = e
  summary.value = s.plays ? s : null
  artists.value = a
}
onMounted(load)

/** Статистика поменялась: счётчики в медиатеке и открытые экраны перечитываются */
async function refreshStats() {
  await library.load()
  dataRev.value++
}

async function toggle(v: boolean) {
  on.value = v
  await setSpotifyEnabled(v)
  await refreshStats()
  ui.toast(v ? $t('История Spotify в статистике') : $t('Статистика — только Amber'))
}

function pick() {
  input.value?.click()
}

async function onFiles(ev: Event) {
  const el = ev.target as HTMLInputElement
  const files = [...(el.files ?? [])]
  el.value = ''
  if (!files.length) return
  busy.value = true
  progress.value = $t('Читаю архив…')
  try {
    const { streams } = await readSpotifyFiles(files)
    progress.value = $t('Записываю {0}…', countLabel(streams.length, $tp('прослушивание|прослушивания|прослушиваний')))
    const report = await importSpotify(streams, (done, total) => {
      progress.value = $t('Записываю… {0}%', Math.round((done / total) * 100))
    })
    progress.value = $t('Ищу эти треки в медиатеке…')
    await rematchSpotify(library.tracks, settings.s.counting, true)
    // Первая загрузка сразу включает показ: за этим её и загружали
    if (!summary.value) await setSpotifyEnabled(true)
    await load()
    await refreshStats()
    ui.toast(
      report.added
        ? $t('Добавлено из Spotify: {0}', countLabel(report.added, $tp('прослушивание|прослушивания|прослушиваний')))
        : $t('Новых прослушиваний в файле нет — всё уже загружено'),
      undefined,
      5000,
    )
  } catch (e) {
    ui.toast($t('Не получилось: {0}', e instanceof Error ? e.message : String(e)), undefined, 6000)
  } finally {
    busy.value = false
    progress.value = ''
  }
}

async function clear() {
  confirmClear.value = false
  busy.value = true
  try {
    await clearSpotify()
    await setSpotifyEnabled(false)
    await load()
    await refreshStats()
    ui.toast($t('История Spotify удалена'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="group">
    <h2 class="gtitle">Spotify</h2>
    <input ref="input" type="file" accept=".zip,.json,application/zip,application/json" multiple hidden @change="onFiles" />
    <template v-if="summary">
      <label class="row">
        <span>
          <b>{{ $t('Показывать в статистике') }}</b>
          <small
            >{{ countLabel(summary.counted, $tp('прослушивание|прослушивания|прослушиваний')) }} ·
            {{ formatListen(summary.listenedMs)
            }}<template v-if="summary.first && summary.last">
              · {{ formatDate(summary.first) }} — {{ formatDate(summary.last) }}</template
            ></small
          >
        </span>
        <input
          id="opt-spotify"
          type="checkbox"
          class="switch"
          :checked="on"
          :disabled="busy"
          @change="toggle(($event.target as HTMLInputElement).checked)"
        />
      </label>
      <p class="note">
        {{
          $t(
            'В медиатеке нашлось {0} из {1} Spotify — {2} добавились к их счётчикам. Остальное идёт в общее время, календарь, часы, серии и итоги. Выключение ничего не удаляет.',
            summary.matched.toLocaleString(LOCALE),
            countLabel(summary.tracks, $tp('трека|треков|треков')),
            countLabel(summary.matchedPlays, $tp('прослушивание|прослушивания|прослушиваний')),
          )
        }}
      </p>
      <div v-if="artists.length" class="artists">
        <b>{{ $t('Чаще всего в Spotify') }}</b>
        <div v-for="(a, i) in artists" :key="a.artist" class="artist">
          <span class="n">{{ i + 1 }}</span>
          <span class="ellipsis">{{ a.artist }}</span>
          <small class="muted">{{ formatListen(a.listenedMs) }}</small>
        </div>
      </div>
      <p v-if="progress" class="note">{{ progress }}</p>
      <div class="btns">
        <button type="button" class="btn" :disabled="busy" @click="pick">{{ $t('Загрузить новую выгрузку') }}</button>
        <button v-if="!confirmClear" type="button" class="btn" :disabled="busy" @click="confirmClear = true">
          {{ $t('Удалить') }}
        </button>
        <button v-else type="button" class="btn danger" :disabled="busy" @click="clear">{{ $t('Точно удалить') }}</button>
      </div>
    </template>
    <template v-else>
      <p class="note">
        {{
          $t(
            'История прослушиваний из Spotify дополнит статистику: время, календарь, часы, серии и счётчики треков, которые есть в медиатеке. Запроси на spotify.com → Аккаунт → Конфиденциальность → «Расширенная история потоковой передачи» и загрузи сюда архив my_spotify_data.zip (или JSON-файлы из него). Всё разбирается на этом устройстве.',
          )
        }}
      </p>
      <p v-if="progress" class="note">{{ progress }}</p>
      <button type="button" class="btn primary block" :disabled="busy" @click="pick">{{ $t('Загрузить данные Spotify') }}</button>
    </template>
  </section>
</template>

<style scoped>
.artists {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}
.artists b {
  font-weight: 500;
  margin-bottom: 2px;
}
.artist {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  font-size: 13.5px;
}
.artist .n {
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.artist .ellipsis {
  min-width: 0;
}
</style>
