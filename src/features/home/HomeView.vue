<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import IconSettings from '~icons/solar/settings-linear'
import IconShuffle from '~icons/solar/shuffle-linear'
import IconHeart from '~icons/solar/heart-linear'
import IconHistory from '~icons/solar/history-linear'
import IconStar from '~icons/solar/star-linear'
import IconPlay from '~icons/solar/play-bold'
import IconPause from '~icons/solar/pause-bold'
import IconRefresh from '~icons/solar/refresh-linear'
import IconRadio from '~icons/solar/radio-linear'
import { useRadio } from '@/stores/radio'
import { activeContext, listContexts, startContext, stopContexts, type ContextRow } from '@/data/repos/contexts'
import { contextIcon } from '@/features/chronicle/contextIcons'
import CoverArt from '@/components/CoverArt.vue'
import Shelf from '@/components/Shelf.vue'
import TrackRow from '@/components/TrackRow.vue'
import TrackActionsSheet from '@/components/TrackActionsSheet.vue'
import DamagedFilesCard from '@/components/DamagedFilesCard.vue'
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
import { onPageShown } from '@/app/paging'
import { stampedLoad } from '@/app/data-rev'
import { isDesktop } from '@/native/desktop/bridge'
import { useCoverGlow } from '@/app/cover-colors'
import { displayArtist } from '@/domain/track'
import { $t, $tp } from '@/i18n'

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

/** Перечитываем, только если история поменялась (app/data-rev.ts); приветствие — каждый раз */
const loadData = stampedLoad(async () => {
  const [r, w, c] = await Promise.all([recentPlays(16), topTracks(Date.now() - 7 * DAY, 5), listContexts()])
  contexts.value = c
  recent.value = r.map((x) => library.byKey.get(x.key)).filter((t): t is Track => !!t)
  week.value = w.flatMap((x) => {
    const t = library.byKey.get(x.key)
    return t ? [{ track: t, plays: x.plays }] : []
  })
})
function refresh() {
  hello.value = greeting()
  if (!bootState.ready && !library.loaded) return
  void loadData()
}

// Главная — сосед первого раздела медиатеки: данные нужны ещё до того, как до неё долистают
onPageShown(refresh, { preload: true })
// Медиатеку перечитали (новые файлы, правки тегов) — треки в полках надо взять заново
watch(
  () => library.tracks,
  () => {
    hello.value = greeting()
    if (bootState.ready || library.loaded) void loadData(true)
  },
)
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
  return library.tracks.length ? `${season.title} · ${countLabel(library.tracks.length, $tp('трек|трека|треков'))}` : season.title
})

function play(list: Track[], i: number, source: PlaySource, shuffle = false) {
  void player.playTracks(list, shuffle ? -1 : i, source, { shuffle })
}

const smartMix = () => play(library.tracks, -1, { type: 'library', title: $t('Умный микс') }, true)
const favMix = () => play(favoritesOrBest.value, -1, { type: 'favorites', title: $t('Любимое') }, true)
const forgottenMix = () => play(forgotten.value, -1, { type: 'smart', title: $t('Давно не слушал') }, true)

const weekSource: PlaySource = { type: 'top', id: 'week', title: $t('Топ недели') }
const freshSource: PlaySource = { type: 'smart', title: $t('Недавно добавленные') }

/* Окно компьютера: главная — асимметричной сеткой, а первая плитка светится цветом того, что играет */
const glow = useCoverGlow(() => ({
  art: player.currentTrack?.art,
  seed: player.current?.title ?? 'amber',
  color1: player.currentTrack?.color1,
  color2: player.currentTrack?.color2,
}))
const tracksLabel = (n: number) => countLabel(n, $tp('трек|трека|треков'))

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
    <!-- Телефон: шапка с приветствием. На компьютере приветствие живёт в первой плитке сетки (ниже) -->
    <header v-if="!isDesktop || !library.tracks.length" class="hdr">
      <div class="top">
        <span class="brand display">Amber</span>
        <button type="button" class="icon-btn" :aria-label="$t('Настройки')" @click="router.push('/settings')">
          <IconSettings />
        </button>
      </div>
      <h1 class="display hello">{{ hello }}</h1>
      <p class="muted sub">{{ subtitle }}</p>
    </header>

    <div v-if="library.loaded && !library.tracks.length" class="empty">
      <h3>{{ $t('Музыки пока нет') }}</h3>
      <p>{{ $t('Найдём mp3 на телефоне. Это займёт минуту, дальше сканирование только по изменениям.') }}</p>
      <button type="button" class="btn primary" :disabled="library.scanning" @click="library.scan(true)">
        <IconRefresh />{{ library.scanning ? $t('Ищу…') : $t('Найти музыку') }}
      </button>
    </div>

    <template v-else>
      <DamagedFilesCard />

      <!-- Компьютер: слева большая плитка — приветствие и то, что играет; справа быстрые запуски разного размера -->
      <div v-if="isDesktop" class="lead">
        <section class="hero-tile" :style="{ '--c1': glow[0], '--c2': glow[1] }">
          <div class="hero-top">
            <p class="eyebrow">{{ subtitle }}</p>
            <button
              type="button"
              class="icon-btn"
              :aria-label="$t('Настройки')"
              :title="$t('Настройки (Ctrl+,)')"
              @click="router.push('/settings')"
            >
              <IconSettings />
            </button>
          </div>
          <h1 class="display hello">{{ hello }}</h1>
          <div v-if="player.current" class="resume">
            <button type="button" class="rcover" :aria-label="$t('Открыть плеер')" @click="ui.fullPlayer = true">
              <CoverArt
                :art="player.currentTrack?.art"
                :seed="player.current.title"
                :label="player.current.title"
                size="s"
                radius="12px"
              />
            </button>
            <span class="rtext">
              <small>{{ player.playing ? $t('Сейчас играет') : $t('Продолжить') }}</small>
              <b class="ellipsis">{{ player.current.title }}</b>
              <span class="ellipsis">{{ player.current.artist }}</span>
            </span>
            <button
              type="button"
              class="rplay"
              :aria-label="player.playing ? $t('Пауза') : $t('Играть')"
              @click="player.toggle()"
            >
              <IconPause v-if="player.playing" /><IconPlay v-else />
            </button>
          </div>
          <button v-else type="button" class="btn primary start" @click="smartMix">
            <IconShuffle />{{ $t('Включить умный микс') }}
          </button>
        </section>
        <div class="tiles">
          <button type="button" class="tile big" @click="smartMix">
            <span class="tic"><IconShuffle /></span>
            <span class="tt"
              ><b>{{ $t('Умный микс') }}</b
              ><small>{{ $t('Любимое, забытое и новое вперемешку') }}</small></span
            >
          </button>
          <button type="button" class="tile" :disabled="!favoritesOrBest.length" @click="favMix">
            <span class="tic"><IconHeart /></span>
            <span class="tt"
              ><b>{{ $t('Любимое') }}</b
              ><small>{{ tracksLabel(favoritesOrBest.length) }}</small></span
            >
          </button>
          <button type="button" class="tile" :disabled="!forgotten.length" @click="forgottenMix">
            <span class="tic"><IconHistory /></span>
            <span class="tt"
              ><b>{{ $t('Давно не слушал') }}</b
              ><small>{{ tracksLabel(forgotten.length) }}</small></span
            >
          </button>
          <button type="button" class="tile big" :disabled="!library.tracks.length || radio.busy" @click="myRadio">
            <span class="tic"><IconRadio /></span>
            <span class="tt"
              ><b>{{ $t('Моё радио') }}</b
              ><small>{{ $t('Бесконечно, по похожести на то, что нравится') }}</small></span
            >
          </button>
        </div>
      </div>
      <div v-else class="quick">
        <button type="button" class="q" @click="smartMix">
          <IconShuffle /><span>{{ $t('Умный микс') }}</span>
        </button>
        <button type="button" class="q" :disabled="!favoritesOrBest.length" @click="favMix">
          <IconHeart /><span>{{ $t('Любимое') }}</span>
        </button>
        <button type="button" class="q" :disabled="!forgotten.length" @click="forgottenMix">
          <IconHistory /><span>{{ $t('Давно не слушал') }}</span>
        </button>
        <button type="button" class="q" :disabled="!library.tracks.length || radio.busy" @click="myRadio">
          <IconRadio /><span>{{ $t('Моё радио') }}</span>
        </button>
      </div>

      <div v-if="ctxNow || contexts.length" class="ctxbar hscroll">
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
          <span>{{ ctxNow?.id === c.id ? $t('Сейчас: {0}', c.title) : c.title }}</span>
          <small v-if="ctxNow?.id === c.id && c.running != null" class="stop" @click.stop="toggleCtx(c)">{{ $t('стоп') }}</small>
        </button>
      </div>

      <button v-if="!isDesktop && player.current && !player.playing" type="button" class="cont" @click="player.play()">
        <CoverArt
          :art="player.currentTrack?.art"
          :seed="player.current.title"
          :label="player.current.title"
          size="s"
          class="cv"
        />
        <span class="ct">
          <b>{{ $t('Продолжить') }}</b>
          <span class="ellipsis">{{ player.current.title }} · {{ player.current.artist }}</span>
        </span>
        <span class="go"><IconPlay /></span>
      </button>

      <button v-if="unratedHeavy" type="button" class="rate-card" @click="router.push('/top?tab=rate')">
        <IconStar />
        <span>
          <b>{{ $t('{0} без оценки', countLabel(unratedHeavy, $tp('трек|трека|треков'))) }}</b>
          <span>{{ $t('Ты слушаешь их часто. Оценишь?') }}</span>
        </span>
      </button>

      <Shelf
        :title="$t('Недавно играло')"
        :tracks="recent"
        @play="(i) => play(recent, i, { type: 'smart', title: $t('Недавно играло') })"
      />

      <!-- .duo на телефоне «прозрачная»; на компьютере — две колонки: топ недели и новинки сеткой обложек -->
      <div class="duo">
        <section v-if="week.length" class="week">
          <div class="section-title">
            <span>{{ $t('Топ недели') }}</span>
            <button type="button" class="more-link" @click="router.push('/chronicle')">{{ $t('вся статистика') }}</button>
          </div>
          <div v-for="(w, i) in week" :key="w.track.key" class="wrow">
            <TrackRow
              :track="w.track"
              :position="isDesktop ? i + 1 : null"
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
        <section v-if="isDesktop && recentlyAdded.length" class="fresh">
          <div class="section-title">
            <span>{{ $t('Недавно добавленные') }}</span>
          </div>
          <div class="fresh-grid">
            <button
              v-for="(t, i) in recentlyAdded.slice(0, 6)"
              :key="t.key"
              type="button"
              class="fcard"
              @click="play(recentlyAdded, i, freshSource)"
            >
              <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="m" radius="var(--r-m)" />
              <span class="ft ellipsis">{{ t.title }}</span>
              <span class="fs ellipsis">{{ displayArtist(t) }}</span>
            </button>
          </div>
        </section>
      </div>

      <Shelf
        v-if="!isDesktop"
        :title="$t('Недавно добавленные')"
        :tracks="recentlyAdded"
        @play="(i) => play(recentlyAdded, i, { type: 'smart', title: $t('Недавно добавленные') })"
      />
      <Shelf
        :title="$t('Давно не слушал')"
        :tracks="forgotten"
        @play="(i) => play(forgotten, i, { type: 'smart', title: $t('Давно не слушал') })"
      />
    </template>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.hdr {
  padding: calc(var(--safe-top) + 16px) var(--gutter) 16px;
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
.duo {
  display: contents;
}

/* ================= окно компьютера ================= */
.lead {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 14px;
  padding: 22px var(--gutter) 0;
}
/* Плитки — стекло: тонированная заливка, блик сверху, грань по контуру */
.hero-tile,
.tile {
  background: var(--glass-card);
  box-shadow: var(--glass-hi);
}
.hero-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 268px;
  padding: 18px 20px 20px 26px;
  border-radius: 26px;
  overflow: hidden;
  /* Цвет обложки светит из левого нижнего угла, второй — справа сверху */
  background:
    radial-gradient(90% 120% at 0% 100%, color-mix(in srgb, var(--c1) 40%, transparent), transparent 62%),
    radial-gradient(70% 90% at 100% 0%, color-mix(in srgb, var(--c2) 22%, transparent), transparent 66%), var(--glass-card);
  transition:
    --c1 1.4s var(--ease),
    --c2 1.4s var(--ease);
}
.hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-right: -6px;
}
.eyebrow {
  font: 500 13px/1 var(--f-body);
  color: var(--ink-2);
}
.hero-tile .hello {
  margin-top: auto;
  padding-top: 18px;
  font-size: clamp(34px, 4.4cqw, 54px);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.045em;
  text-wrap: balance;
}
.resume {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  margin: 20px 0 0 -8px;
  padding: 8px 10px 8px 8px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--bg) 46%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 6%, transparent);
}
.rcover {
  width: 56px;
  border-radius: 12px;
  transition: transform var(--t-fast) var(--ease);
}
.rcover:hover {
  transform: scale(1.05);
}
.rtext {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-size: 12.5px;
  color: var(--ink-2);
}
.rtext small {
  font: 500 12px/1 var(--f-body);
  color: var(--amber-ink);
}
.rtext b {
  color: var(--ink);
  font: 600 15.5px/1.2 var(--f-body);
}
.rplay {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--ink);
  color: var(--bg);
  transition: transform var(--t-fast) var(--ease);
}
.rplay svg {
  width: 19px;
  height: 19px;
}
.rplay:hover {
  transform: scale(1.07);
}
.rplay:active {
  transform: scale(0.94);
}
.start {
  align-self: flex-start;
  margin-top: 20px;
}
.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.tile {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 14px;
  min-height: 0;
  padding: 14px 14px 13px;
  border-radius: 20px;
  text-align: left;
  transition:
    transform var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}
.tile.big {
  grid-column: 1 / -1;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  padding: 12px 16px 12px 12px;
}
.tile:hover:not(:disabled) {
  background: var(--glass-card-hover);
  transform: translateY(-2px);
}
.tile:active:not(:disabled) {
  transform: scale(0.985);
}
.tile:disabled {
  opacity: 0.45;
  cursor: default;
}
.tic {
  width: 38px;
  height: 38px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: rgba(var(--amber-rgb), 0.13);
  color: var(--amber-ink);
}
.tic svg {
  width: 20px;
  height: 20px;
}
.tt {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.tt b {
  font: 600 14.5px/1.2 var(--f-body);
}
.tt small {
  font-size: 12.5px;
  line-height: 1.3;
  color: var(--ink-2);
}

:root.desktop .rate-card {
  margin-top: 14px;
  padding: 11px 16px;
  border-radius: 16px;
  transition: background var(--t-fast) var(--ease);
}
:root.desktop .rate-card:hover {
  background: rgba(var(--amber-rgb), 0.17);
}
:root.desktop .rate-card svg {
  width: 22px;
  height: 22px;
}
:root.desktop .rate-card span {
  flex-direction: row;
  gap: 10px;
  align-items: baseline;
}

/* Две колонки: рейтинг недели списком и новинки сеткой — ни одна не тянется на всю ширину ради пяти строк */
:root.desktop .duo {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 0 40px;
  padding: 0 var(--gutter);
}
/* Внутри колонки свои поля: строки и заголовки считают отступы от неё, а не от всей сцены */
:root.desktop .week,
:root.desktop .fresh {
  --gutter: 12px;
  min-width: 0;
  margin: 0 -12px;
}
.fresh-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px 14px;
  padding: 0 12px;
}
.fcard {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  text-align: left;
}
.fcard :deep(.cover) {
  width: 100%;
  margin-bottom: 4px;
  transition:
    transform var(--t-mid) var(--ease-out),
    filter var(--t-fast) var(--ease),
    box-shadow var(--t-mid) var(--ease-out);
}
.fcard:hover :deep(.cover) {
  transform: translateY(-4px);
  filter: brightness(1.08);
  box-shadow: 0 18px 30px -16px rgba(0, 0, 0, 0.7);
}
.fcard:active :deep(.cover) {
  transform: translateY(-1px) scale(0.985);
}
.ft {
  font: 500 13.5px/1.25 var(--f-body);
}
.fs {
  font: 400 12px/1.25 var(--f-body);
  color: var(--ink-2);
}

/* Блоки главной появляются по очереди, снизу вверх — один раз, при первом показе */
:root.desktop .home > * {
  animation: home-rise 520ms var(--ease-out) backwards;
}
:root.desktop .home > :nth-child(2) {
  animation-delay: 50ms;
}
:root.desktop .home > :nth-child(3) {
  animation-delay: 100ms;
}
:root.desktop .home > :nth-child(4) {
  animation-delay: 150ms;
}
:root.desktop .home > :nth-child(n + 5) {
  animation-delay: 200ms;
}
@keyframes home-rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
}
</style>
