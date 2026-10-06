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
import { artistIdOf } from '@/domain/groups'
import { formatBytes, formatDate, formatDuration, formatListen, relativeDay } from '@/domain/format'
import { starsLabel } from '@/domain/rating'
import type { PlaySource } from '@/native/types'

const route = useViewRoute()
const router = useRouter()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()

const key = computed(() => String(route.params.key ?? ''))
const t = computed(() => library.byKey.get(key.value))
const source = computed<PlaySource>(() => ({ type: 'track', id: key.value, title: t.value?.title }))

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
          `SELECT started_at AS startedAt, counted, local_hour AS localHour FROM play_events WHERE track_key = ? ORDER BY started_at`,
          [k],
        )
      : []
  },
  { immediate: true },
)

/** 12 последних недель: сколько раз трек засчитывался каждую неделю */
const weeks = computed(() => {
  const W = 7 * 86_400_000
  const now = Date.now()
  const out = Array.from({ length: 12 }, () => 0)
  for (const e of events.value) {
    if (!e.counted) continue
    const w = Math.floor((now - e.startedAt) / W)
    if (w >= 0 && w < 12) out[11 - w]!++
  }
  return out
})
const weekMax = computed(() => Math.max(1, ...weeks.value))

const dayparts = computed(() => {
  const parts = [
    { label: 'Утро', from: 5, to: 11, n: 0 },
    { label: 'День', from: 11, to: 17, n: 0 },
    { label: 'Вечер', from: 17, to: 23, n: 0 },
    { label: 'Ночь', from: 23, to: 5, n: 0 },
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
  ui.toast('Заметка сохранена')
}

const fileRows = computed(() => {
  const x = t.value
  if (!x) return []
  const rows: [string, string][] = [
    ['Файл', x.fileName],
    ['Папка', x.folder || '/'],
    ['Длительность', formatDuration(x.durationMs)],
    ['Размер', formatBytes(x.size)],
  ]
  if (x.mime) rows.push(['Формат', x.mime.replace('audio/', '').replace('mpeg', 'mp3')])
  if (x.bitrate) rows.push(['Битрейт', `${Math.round(x.bitrate / 1000)} кбит/с`])
  if (x.sampleRate) rows.push(['Частота', `${(x.sampleRate / 1000).toFixed(1).replace('.', ',')} кГц`])
  if (x.year) rows.push(['Год', String(x.year)])
  if (x.genre) rows.push(['Жанр', x.genre])
  rows.push(['Добавлен', formatDate(x.addedAt)])
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
      <button type="button" class="icon-btn" aria-label="Назад" @click="router.back()"><IconBack /></button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Действия"
        @click="ui.openSheet(TrackActionsSheet, { trackKey: t.key, source })"
      >
        <IconMore />
      </button>
    </div>

    <div class="head">
      <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="l" radius="var(--r-l)" class="cv" />
      <h1 class="display title">{{ t.title }}</h1>
      <p class="artist">
        <template v-for="(a, i) in t.artists" :key="a">
          <button type="button" class="link" @click="router.push(`/artist/${encodeURIComponent(artistIdOf(a))}`)">{{ a }}</button
          ><span v-if="i < t.artists.length - 1">, </span>
        </template>
        <span v-if="!t.artists.length" class="muted">{{ displayArtist(t) }}</span>
      </p>
      <div class="rate">
        <RatingStars :model-value="t.rating" :size="32" @update:model-value="(v) => library.setRating(t!.key, v)" />
        <button
          type="button"
          class="icon-btn"
          :class="{ fav: t.favoriteAt }"
          aria-label="Избранное"
          @click="library.toggleFavorite(t.key)"
        >
          <IconHeartOn v-if="t.favoriteAt" />
          <IconHeart v-else />
        </button>
      </div>
      <p class="muted small">{{ starsLabel(t.rating) }}</p>
      <div class="btns">
        <button type="button" class="btn primary" @click="player.playTracks([t], 0, source, { shuffle: false })">
          <IconPlay />Слушать
        </button>
        <button type="button" class="btn" @click="player.playNext([t], source).then(() => ui.toast('Сыграет следующим'))">
          <IconNext />Следующим
        </button>
      </div>
    </div>

    <!-- .blocks: на широком окне компьютера разделы расходятся по двум колонкам -->
    <div class="blocks">
      <section class="block">
        <h2 class="section-title">История</h2>
        <div class="tiles">
          <div class="tile">
            <small>Прослушиваний</small><b>{{ t.plays }}</b>
          </div>
          <div class="tile">
            <small>Вместе</small><b>{{ formatListen(t.listenedMs) }}</b>
          </div>
          <div class="tile">
            <small>Первое</small><b class="sm">{{ relativeDay(t.firstPlayedAt) }}</b>
          </div>
          <div class="tile">
            <small>Последнее</small><b class="sm">{{ relativeDay(t.lastPlayedAt) }}</b>
          </div>
        </div>
        <div v-if="t.plays" class="chart">
          <div class="chart-title">По неделям, 12 недель</div>
          <div class="bars">
            <span v-for="(n, i) in weeks" :key="i" :style="{ height: `${(n / weekMax) * 100}%` }" :title="`${n}`" />
          </div>
          <div class="parts">
            <div v-for="p in dayparts" :key="p.label" class="part">
              <span>{{ p.label }}</span>
              <i><b :style="{ width: `${p.pct}%` }" /></i>
              <span class="num">{{ p.pct }}%</span>
            </div>
          </div>
        </div>
        <p v-if="t.skips" class="muted small pad">Пропущен {{ t.skips }} раз.</p>
      </section>

      <section class="block">
        <h2 class="section-title">Заметка</h2>
        <textarea
          id="track-note"
          v-model="note"
          class="note"
          rows="3"
          placeholder="Почему этот трек важен, с чем связан"
          @blur="saveNote"
        />
      </section>

      <section class="block">
        <h2 class="section-title">Файл</h2>
        <dl class="info">
          <template v-for="[k, v] in fileRows" :key="k">
            <dt>{{ k }}</dt>
            <dd>{{ v }}</dd>
          </template>
        </dl>
        <p v-if="tagsDiffer" class="muted small pad">
          В тегах файла: «{{ t.tags.title || 'пусто' }}» — {{ t.tags.artist || 'исполнитель пуст' }}. Показано по имени файла.
        </p>
      </section>
    </div>
    <div class="bottom-space" />
  </div>
  <div v-else class="empty"><h3>Трек не найден</h3></div>
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
.link {
  color: var(--amber-ink);
  font-weight: 500;
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
.chart-title {
  font-size: 12px;
  color: var(--ink-2);
  margin-bottom: 10px;
}
.bars {
  height: 64px;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  border-bottom: 1px solid var(--line);
}
.bars span {
  flex: 1;
  min-height: 2px;
  background: var(--amber);
  border-radius: 4px 4px 0 0;
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
  grid-template-rows: 1fr repeat(5, auto);
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
  grid-row: 1 / 7;
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
:root.desktop .rate {
  grid-row: 4;
}
:root.desktop .head > .small {
  grid-row: 5;
}
:root.desktop .btns {
  grid-row: 6;
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
