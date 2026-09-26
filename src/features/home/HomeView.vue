<script setup lang="ts">
import { computed, onActivated, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import IconSettings from '~icons/solar/settings-linear'
import IconShuffle from '~icons/solar/shuffle-linear'
import IconHeart from '~icons/solar/heart-linear'
import IconHistory from '~icons/solar/history-linear'
import IconStar from '~icons/solar/star-linear'
import IconPlay from '~icons/solar/play-bold'
import IconRefresh from '~icons/solar/refresh-linear'
import IconRadio from '~icons/solar/radio-linear'
import { useRadio } from '@/stores/radio'
import { activeContext, listContexts, startContext, stopContexts, type ContextRow } from '@/data/repos/contexts'
import { contextIcon } from '@/features/chronicle/contextIcons'
import CoverArt from '@/components/CoverArt.vue'
import Shelf from '@/components/Shelf.vue'
import TrackRow from '@/components/TrackRow.vue'
import TrackActionsSheet from '@/components/TrackActionsSheet.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { bootState } from '@/app/boot-state'
import { recentPlays, topTracks } from '@/data/repos/stats'
import type { Track } from '@/domain/track'
import { countLabel, greeting } from '@/domain/format'
import { seasonOf } from '@/domain/seasons'
import type { PlaySource } from '@/native/types'

const library = useLibrary()
const player = usePlayer()
const settings = useSettings()
const ui = useUi()
const router = useRouter()

const radio = useRadio()
const scrollEl = ref<HTMLElement | null>(null)
const contexts = shallowRef<ContextRow[]>([])
const hello = ref(greeting())
const recent = shallowRef<Track[]>([])
const week = shallowRef<{ track: Track; plays: number }[]>([])

const DAY = 86_400_000

async function refresh() {
  hello.value = greeting()
  if (!bootState.ready && !library.loaded) return
  const [r, w, c] = await Promise.all([recentPlays(16), topTracks(Date.now() - 7 * DAY, 5), listContexts()])
  contexts.value = c
  recent.value = r.map((x) => library.byKey.get(x.key)).filter((t): t is Track => !!t)
  week.value = w.flatMap((x) => {
    const t = library.byKey.get(x.key)
    return t ? [{ track: t, plays: x.plays }] : []
  })
}

onActivated(refresh)
watch(() => library.tracks, refresh)
watch(
  () => ui.reselect,
  (r) => r.tab === 'home' && scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' }),
)

const recentlyAdded = computed(() => [...library.tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 16))
const forgotten = computed(() => {
  const cutoff = Date.now() - 60 * DAY
  return library.tracks
    .filter((t) => ((t.rating ?? 0) >= 8 || t.plays >= 10) && (t.lastPlayedAt ?? 0) < cutoff && t.plays > 0)
    .sort((a, b) => (b.rating ?? 0) * 10 + b.plays - ((a.rating ?? 0) * 10 + a.plays))
    .slice(0, 30)
})
const unratedHeavy = computed(() =>
  settings.s.askRatingAfterPlays > 0
    ? library.tracks.filter((t) => t.rating == null && t.plays >= settings.s.askRatingAfterPlays).length
    : 0,
)
const favoritesOrBest = computed(() => {
  const fav = library.favorites
  if (fav.length >= 5) return fav
  return library.tracks.filter((t) => (t.rating ?? 0) >= 8 || t.favoriteAt)
})
const subtitle = computed(() => {
  const season = seasonOf(new Date())
  return library.tracks.length
    ? `${season.title} · ${countLabel(library.tracks.length, ['трек', 'трека', 'треков'])}`
    : season.title
})

function play(list: Track[], i: number, source: PlaySource, shuffle = false) {
  void player.playTracks(list, shuffle ? -1 : i, source, { shuffle })
}

const smartMix = () => play(library.tracks, -1, { type: 'library', title: 'Умный микс' }, true)
const favMix = () => play(favoritesOrBest.value, -1, { type: 'favorites', title: 'Любимое' }, true)
const forgottenMix = () => play(forgotten.value, -1, { type: 'smart', title: 'Давно не слушал' }, true)

const weekSource: PlaySource = { type: 'top', id: 'week', title: 'Топ недели' }

/* ---- контекст «сейчас»: запущенный вручную или подходящий по правилам ---- */
const ctxNow = computed(() => activeContext(contexts.value, new Date(), player.output))
async function toggleCtx(c: ContextRow) {
  if (c.running != null) await stopContexts()
  else await startContext(c.id)
  contexts.value = await listContexts()
}
async function myRadio() {
  await radio.startMine()
  ui.fullPlayer = true
}
</script>

<template>
  <div ref="scrollEl" class="scroll screen home">
    <header class="hdr">
      <div class="top">
        <span class="brand display">Янтарь</span>
        <button type="button" class="icon-btn" aria-label="Настройки" @click="router.push('/settings')"><IconSettings /></button>
      </div>
      <h1 class="display hello">{{ hello }}</h1>
      <p class="muted sub">{{ subtitle }}</p>
    </header>

    <div v-if="library.loaded && !library.tracks.length" class="empty">
      <h3>Музыки пока нет</h3>
      <p>Найдём mp3 на телефоне. Это займёт минуту, дальше сканирование только по изменениям.</p>
      <button type="button" class="btn primary" :disabled="library.scanning" @click="library.scan(true)">
        <IconRefresh />{{ library.scanning ? 'Ищу…' : 'Найти музыку' }}
      </button>
    </div>

    <template v-else>
      <div class="quick">
        <button type="button" class="q" @click="smartMix"><IconShuffle /><span>Умный микс</span></button>
        <button type="button" class="q" :disabled="!favoritesOrBest.length" @click="favMix">
          <IconHeart /><span>Любимое</span>
        </button>
        <button type="button" class="q" :disabled="!forgotten.length" @click="forgottenMix">
          <IconHistory /><span>Давно не слушал</span>
        </button>
        <button type="button" class="q" :disabled="!library.tracks.length || radio.busy" @click="myRadio">
          <IconRadio /><span>Моё радио</span>
        </button>
      </div>

      <div v-if="ctxNow || contexts.length" class="ctxbar">
        <button
          v-for="c in ctxNow ? [ctxNow] : contexts.slice(0, 4)"
          :key="c.id"
          type="button"
          class="ctx"
          :class="{ on: ctxNow?.id === c.id }"
          :style="{ '--cc': c.color ?? 'var(--amber)' }"
          @click="ctxNow?.id === c.id ? router.push(`/context/${c.id}`) : toggleCtx(c)"
        >
          <component :is="contextIcon(c.icon)" />
          <span>{{ ctxNow?.id === c.id ? `Сейчас: ${c.title}` : c.title }}</span>
          <small v-if="ctxNow?.id === c.id && c.running != null" class="stop" @click.stop="toggleCtx(c)">стоп</small>
        </button>
      </div>

      <button v-if="player.current && !player.playing" type="button" class="cont" @click="player.play()">
        <CoverArt
          :art="player.currentTrack?.art"
          :seed="player.current.title"
          :label="player.current.title"
          size="s"
          class="cv"
        />
        <span class="ct">
          <b>Продолжить</b>
          <span class="ellipsis">{{ player.current.title }} · {{ player.current.artist }}</span>
        </span>
        <span class="go"><IconPlay /></span>
      </button>

      <button v-if="unratedHeavy" type="button" class="rate-card" @click="router.push('/top?tab=rate')">
        <IconStar />
        <span>
          <b>{{ countLabel(unratedHeavy, ['трек', 'трека', 'треков']) }} без оценки</b>
          <span>Ты слушаешь их часто. Оценишь?</span>
        </span>
      </button>

      <Shelf title="Недавно играло" :tracks="recent" @play="(i) => play(recent, i, { type: 'smart', title: 'Недавно играло' })" />

      <section v-if="week.length">
        <div class="section-title">
          <span>Топ недели</span>
          <button type="button" class="more-link" @click="router.push('/chronicle')">вся статистика</button>
        </div>
        <div v-for="(w, i) in week" :key="w.track.key" class="wrow">
          <TrackRow
            :track="w.track"
            :active="player.current?.key === w.track.key"
            :playing="player.playing"
            :meta="{ kind: 'text', text: `${w.plays}×` }"
            @tap="
              play(
                week.map((x) => x.track),
                i,
                weekSource,
              )
            "
            @more="ui.openSheet(TrackActionsSheet, { trackKey: w.track.key, source: weekSource })"
          />
        </div>
      </section>

      <Shelf
        title="Недавно добавленные"
        :tracks="recentlyAdded"
        @play="(i) => play(recentlyAdded, i, { type: 'smart', title: 'Недавно добавленные' })"
      />
      <Shelf
        title="Давно не слушал"
        :tracks="forgotten"
        @play="(i) => play(forgotten, i, { type: 'smart', title: 'Давно не слушал' })"
      />
    </template>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.hdr {
  padding: calc(var(--safe-top) + 6px) var(--gutter) 6px;
}
.top {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  font-size: 15px;
  font-weight: 600;
  color: var(--amber-ink);
}
.hello {
  font-size: 28px;
  font-weight: 600;
  margin-top: 6px;
}
.sub {
  margin-top: 6px;
  font-size: 13.5px;
}
.ctxbar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 10px var(--gutter) 0;
  scrollbar-width: none;
}
.ctx {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--chip);
  font: 500 13px/1 var(--f-body);
}
.ctx svg {
  width: 16px;
  height: 16px;
  color: var(--cc);
}
.ctx.on {
  background: color-mix(in srgb, var(--cc) 20%, transparent);
  color: var(--ink);
}
.stop {
  margin-left: 4px;
  font-size: 12px;
  color: var(--ink-2);
  text-decoration: underline;
}
.quick {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 14px var(--gutter) 4px;
}
.q {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 12px;
  border-radius: 18px;
  background: var(--surface);
  font: 600 13px/1.2 var(--f-body);
  text-align: left;
}
.q:disabled {
  opacity: 0.45;
}
.q svg {
  width: 22px;
  height: 22px;
  color: var(--amber-ink);
}
.cont {
  margin: 12px var(--gutter) 0;
  width: calc(100% - 2 * var(--gutter));
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border-radius: 18px;
  background: var(--surface);
  text-align: left;
}
.cont .cv {
  width: 48px;
}
.ct {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.ct b {
  color: var(--ink);
  font-size: 14.5px;
}
.go {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--ink);
  color: var(--bg);
}
.go svg {
  width: 18px;
  height: 18px;
}
.rate-card {
  margin: 12px var(--gutter) 0;
  width: calc(100% - 2 * var(--gutter));
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border-radius: 18px;
  background: rgba(var(--amber-rgb), 0.12);
  text-align: left;
}
.rate-card svg {
  width: 26px;
  height: 26px;
  color: var(--amber-ink);
}
.rate-card span {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.rate-card b {
  color: var(--ink);
  font-size: 14.5px;
}
.wrow {
  height: 64px;
}
</style>
