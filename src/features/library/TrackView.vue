<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import IconBack from '~icons/solar/alt-arrow-left-linear'
import IconMore from '~icons/solar/menu-dots-bold'
import IconPlay from '~icons/solar/play-bold'
import IconNext from '~icons/solar/list-arrow-down-linear'
import IconHeart from '~icons/solar/heart-linear'
import IconHeartOn from '~icons/solar/heart-bold'
import CoverArt from '@/components/CoverArt.vue'
import RatingStars from '@/components/RatingStars.vue'
import TrackActionsSheet from '@/components/TrackActionsSheet.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { all } from '@/data/db'
import { upsertTrackUser } from '@/data/repos/library'
import { displayArtist } from '@/domain/track'
import { albumIdOf, artistIdOf } from '@/domain/groups'
import IconAlbum from '~icons/solar/album-linear'
import { formatBytes, formatDate, formatDuration, formatListen, relativeDay } from '@/domain/format'
import TrackPlaysChart from './TrackPlaysChart.vue'
import { starsLabel } from '@/domain/rating'
import type { PlaySource } from '@/native/types'
import { $t } from '@/i18n'

const route = useViewRoute()
const router = useRouter()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()

const key = computed(() => String(route.params.key ?? ''))
const t = computed(() => library.byKey.get(key.value))
const source = computed<PlaySource>(() => ({ type: 'track', id: key.value, title: t.value?.title }))
const toArtist = (name: string) => router.push(`/artist/${encodeURIComponent(artistIdOf(name))}`)
const toAlbum = () => t.value && router.push(`/album/${encodeURIComponent(albumIdOf(t.value))}`)

interface Ev {
  startedAt: number
  counted: number
  localHour: number
}
const events = shallowRef<Ev[]>([])
/** История трека перечитывается при смене трека и после каждого нового прослушивания */
watch(
  [key, () => t.value?.plays],
  async ([k]) => {
    events.value = k
      ? await all<Ev>(
          `SELECT started_at AS startedAt, counted, local_hour AS localHour FROM stat_plays WHERE track_key = ? ORDER BY started_at`,
          [k],
        )
      : []
  },
  { immediate: true },
)

/** Моменты засчитанных прослушиваний — для графика по месяцам и дням (TrackPlaysChart) */
const counted = computed(() => events.value.filter((e) => e.counted).map((e) => e.startedAt))

const dayparts = computed(() => {
  const parts = [
    { label: $t('Утро'), from: 5, to: 11, n: 0 },
    { label: $t('День'), from: 11, to: 17, n: 0 },
    { label: $t('Вечер'), from: 17, to: 23, n: 0 },
    { label: $t('Ночь'), from: 23, to: 5, n: 0 },
  ]
  for (const e of events.value) {
    if (!e.counted) continue
    const h = e.localHour
    const p = parts.find((x) => (x.from < x.to ? h >= x.from && h < x.to : h >= x.from || h < x.to))
    if (p) p.n++
  }
  const total = parts.reduce((s, p) => s + p.n, 0)
  return parts.map((p) => ({ ...p, pct: total ? Math.round((p.n / total) * 100) : 0 }))
})

const note = ref('')
watch(
  () => t.value?.note,
  (n) => (note.value = n ?? ''),
  { immediate: true },
)
async function saveNote() {
  if (!t.value || (t.value.note ?? '') === note.value) return
  const v = note.value.trim() || null
  library.patch(t.value.key, { note: v })
  await upsertTrackUser(t.value.key, { note: v })
  ui.toast($t('Заметка сохранена'))
}

const fileRows = computed(() => {
  const x = t.value
  if (!x) return []
  const rows: [string, string][] = [
    [$t('Файл'), x.fileName],
    [$t('Папка'), x.folder || '/'],
    [$t('Длительность'), formatDuration(x.durationMs)],
    [$t('Размер'), formatBytes(x.size)],
  ]
  if (x.mime) rows.push([$t('Формат'), x.mime.replace('audio/', '').replace('mpeg', 'mp3')])
  if (x.bitrate) rows.push([$t('Битрейт'), $t('{0} кбит/с', Math.round(x.bitrate / 1000))])
  if (x.sampleRate) rows.push([$t('Частота'), $t('{0} кГц', (x.sampleRate / 1000).toFixed(1).replace('.', ','))])
  if (x.year) rows.push([$t('Год'), String(x.year)])
  if (x.genre) rows.push([$t('Жанр'), x.genre])
  rows.push([$t('Добавлен'), formatDate(x.addedAt)])
  return rows
})

const tagsDiffer = computed(() => {
  const x = t.value
  return !!x && (x.tags.title !== x.title || (x.tags.artist ?? '') !== x.artist)
})
</script>

<template>
  <div v-if="t" class="scroll screen card">
    <div class="bar">
      <button type="button" class="icon-btn" :aria-label="$t('Назад')" @click="router.back()"><IconBack /></button>
      <button
        type="button"
        class="icon-btn"
        :aria-label="$t('Действия')"
        @click="ui.openSheet(TrackActionsSheet, { trackKey: t.key, source })"
      >
        <IconMore />
      </button>
    </div>

    <div class="head">
      <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="l" radius="var(--r-l)" class="cv" />
      <h1 class="display title">{{ t.title }}</h1>
      <p class="artist">
        <!-- Ссылки строчные (span): запятая держится за именем и не уезжает при переносе в начало строки -->
        <template v-for="(a, i) in t.artists" :key="a"
          ><span role="link" tabindex="0" class="link" @click="toArtist(a)" @keydown.enter.prevent="toArtist(a)">{{ a }}</span
          ><template v-if="i < t.artists.length - 1">, </template></template
        >
        <span v-if="!t.artists.length" class="muted">{{ displayArtist(t) }}</span>
      </p>
      <p v-if="t.album" class="album">
        <span role="link" tabindex="0" class="link" @click="toAlbum" @keydown.enter.prevent="toAlbum"
          ><IconAlbum />{{ t.album }}</span
        >
      </p>
      <div class="rate">
        <RatingStars :model-value="t.rating" :size="32" @update:model-value="(v) => library.setRating(t!.key, v)" />
        <button
          type="button"
          class="icon-btn"
          :class="{ fav: t.favoriteAt }"
          :aria-label="$t('Избранное')"
          @click="library.toggleFavorite(t.key)"
        >
          <IconHeartOn v-if="t.favoriteAt" />
          <IconHeart v-else />
        </button>
      </div>
      <p class="muted small">{{ starsLabel(t.rating) }}</p>
      <div class="btns">
        <button type="button" class="btn primary" @click="player.playTracks([t], 0, source, { shuffle: false })">
          <IconPlay />{{ $t('Слушать') }}
        </button>
        <button type="button" class="btn" @click="player.playNext([t], source).then(() => ui.toast($t('Сыграет следующим')))">
          <IconNext />{{ $t('Следующим') }}
        </button>
      </div>
    </div>

    <!-- .blocks: на широком окне компьютера разделы расходятся по двум колонкам -->
    <div class="blocks">
      <section class="block">
        <h2 class="section-title">{{ $t('История') }}</h2>
        <div class="tiles">
          <div class="tile">
            <small>{{ $t('Прослушиваний') }}</small
            ><b>{{ t.plays }}</b>
          </div>
          <div class="tile">
            <small>{{ $t('Вместе') }}</small
            ><b>{{ formatListen(t.listenedMs) }}</b>
          </div>
          <div class="tile">
            <small>{{ $t('Первое') }}</small
            ><b class="sm">{{ relativeDay(t.firstPlayedAt) }}</b>
          </div>
          <div class="tile">
            <small>{{ $t('Последнее') }}</small
            ><b class="sm">{{ relativeDay(t.lastPlayedAt) }}</b>
          </div>
        </div>
        <div v-if="t.plays" class="chart">
          <TrackPlaysChart :key="t.key" :times="counted" />
          <div class="parts">
            <div v-for="p in dayparts" :key="p.label" class="part">
              <span>{{ p.label }}</span>
              <i><b :style="{ width: `${p.pct}%` }" /></i>
              <span class="num">{{ p.pct }}%</span>
            </div>
          </div>
        </div>
        <p v-if="t.skips" class="muted small pad">{{ $t('Пропущен {0} раз.', t.skips) }}</p>
      </section>

      <section class="block">
        <h2 class="section-title">{{ $t('Заметка') }}</h2>
        <textarea
          id="track-note"
          v-model="note"
          class="note"
          rows="3"
          :placeholder="$t('Почему этот трек важен, с чем связан')"
          @blur="saveNote"
        />
      </section>

      <section class="block">
        <h2 class="section-title">{{ $t('Файл') }}</h2>
        <dl class="info">
          <template v-for="[k, v] in fileRows" :key="k">
            <dt>{{ k }}</dt>
            <dd>{{ v }}</dd>
          </template>
        </dl>
        <p v-if="tagsDiffer" class="muted small pad">
          {{
            $t(
              'В тегах файла: «{0}» — {1}. Показано по имени файла.',
              t.tags.title || $t('пусто'),
              t.tags.artist || $t('исполнитель пуст'),
            )
          }}
        </p>
      </section>
    </div>
    <div class="bottom-space" />
  </div>
  <div v-else class="empty">
    <h3>{{ $t('Трек не найден') }}</h3>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 48px;
  padding: calc(var(--safe-top) + 4px) 8px 0;
  box-sizing: content-box;
}
.head {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 6px var(--gutter) 4px;
}
.cv {
  width: min(66vw, 280px);
  box-shadow: var(--shadow-cover);
}
.title {
  margin-top: 18px;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
  text-wrap: balance;
}
.artist {
  margin-top: 6px;
  font-size: 15px;
}
.album {
  margin-top: 4px;
  font-size: 14px;
}
.album .link {
  color: var(--ink-2);
}
/* Значок — в начале первой строки, а не сбоку от всего многострочного названия */
.album svg {
  width: 16px;
  height: 16px;
  margin-right: 6px;
  vertical-align: -2px;
}
.link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.link {
  color: var(--amber-ink);
  font-weight: 500;
  cursor: pointer;
}
.link:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 2px;
  border-radius: 3px;
}
.rate {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.fav {
  color: var(--heart);
}
.small {
  font-size: 12.5px;
}
.btns {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.block {
  margin-top: 6px;
}
.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 0 var(--gutter);
}
.tile {
  background: var(--surface);
  border-radius: 16px;
  padding: 12px 14px;
}
.tile small {
  display: block;
  font-size: 12px;
  color: var(--ink-2);
}
.tile b {
  display: block;
  margin-top: 4px;
  font: 600 20px/1.2 var(--f-body);
}
.tile b.sm {
  font-size: 15px;
}
.chart {
  margin: 10px var(--gutter) 0;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--surface);
}
.parts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}
.part {
  display: grid;
  grid-template-columns: 52px 1fr 40px;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.part i {
  height: 6px;
  border-radius: 3px;
  background: var(--surface-2);
  overflow: hidden;
}
.part b {
  display: block;
  height: 100%;
  background: rgba(var(--amber-rgb), 0.8);
  border-radius: 3px;
}
.part .num {
  text-align: right;
}
.pad {
  padding: 8px var(--gutter) 0;
}
.note {
  display: block;
  width: calc(100% - 2 * var(--gutter));
  margin: 0 var(--gutter);
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  resize: vertical;
  font-size: 14.5px;
  line-height: 1.45;
}
.info {
  margin: 0 var(--gutter);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 16px;
  font-size: 13.5px;
}
.info dt {
  color: var(--ink-2);
}
.info dd {
  margin: 0;
  word-break: break-word;
  user-select: text;
}

/* ---------- окно компьютера: шапка в строку, разделы в две колонки, карточки — стекло ---------- */
:root.desktop .bar {
  padding-inline: calc(var(--gutter) - 10px);
}
:root.desktop .head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: 1fr repeat(6, auto);
  column-gap: 30px;
  justify-items: start;
  text-align: left;
  padding: 4px var(--gutter) 10px;
}
:root.desktop .head > * {
  grid-column: 2;
}
:root.desktop .cv {
  grid-column: 1;
  grid-row: 1 / 8;
  width: clamp(168px, 19cqw, 232px);
}
:root.desktop .title {
  grid-row: 2;
  margin-top: 0;
  font-size: clamp(30px, 3.8cqw, 50px);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.04em;
  padding-block: 0.05em;
}
:root.desktop .artist {
  grid-row: 3;
  margin-top: 8px;
}
:root.desktop .album {
  grid-row: 4;
}
:root.desktop .rate {
  grid-row: 5;
}
:root.desktop .head > .small {
  grid-row: 6;
}
:root.desktop .btns {
  grid-row: 7;
  margin-top: 16px;
}
:root.desktop .tile,
:root.desktop .chart,
:root.desktop .note,
:root.desktop .info {
  background: var(--glass-card);
  box-shadow: var(--glass-hi);
}
:root.desktop .info {
  padding: 16px 18px;
  border-radius: 18px;
  gap: 10px 22px;
}
:root.desktop .tiles {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
@container (min-width: 900px) {
  :root.desktop .blocks {
    columns: 2;
    column-gap: 28px;
    padding-inline: var(--page-gutter);
    --gutter: 0px;
  }
  :root.desktop .block {
    break-inside: avoid;
    margin-top: 0;
  }
  :root.desktop .tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
