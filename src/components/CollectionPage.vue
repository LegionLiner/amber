<script setup lang="ts">
import { computed, onActivated, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { useRouter } from 'vue-router'
import IconBack from '~icons/solar/alt-arrow-left-linear'
import IconPlay from '~icons/solar/play-bold'
import IconShuffle from '~icons/solar/shuffle-linear'
import CoverArt from './CoverArt.vue'
import TrackList from './TrackList.vue'
import type { RowDetail, RowMeta } from './TrackRow.vue'
import type { Track } from '@/domain/track'
import type { PlaySource } from '@/native/types'
import { usePlayer } from '@/stores/player'
import { useCoverGlow } from '@/app/cover-colors'
import { formatListen, countLabel } from '@/domain/format'
import { flyCoverTo } from '@/app/motion'
import { isDesktop } from '@/native/desktop/bridge'

/**
 * Общая страница набора треков: альбом, исполнитель, жанр, папка, плейлист.
 *
 * На телефоне шапка — столбиком по центру (обложка, название, кнопки). В окне компьютера она
 * горизонтальная: обложка слева, справа крупное название и действия в одну строку — так шапка
 * занимает треть экрана, а не половину, и список начинается выше.
 */
const props = withDefaults(
  defineProps<{
    title: string
    kind: string
    tracks: Track[]
    source: PlaySource
    art?: string | null
    seed?: string
    round?: boolean
    numbered?: boolean
    subtitle?: string
    meta?: (t: Track) => RowMeta
    /** Своя логика запуска: index −1 и shuffle — «Перемешать» */
    play?: (index: number, shuffle: boolean) => void
    /** Плейлисты: места слева, подробности (альбом, добавлен, длительность), перестановка удержанием */
    positions?: boolean
    detail?: (t: Track, index: number) => RowDetail
    /** Подпись третьей колонки таблицы в окне компьютера */
    extraLabel?: string
    reorder?: (from: number, to: number) => void
  }>(),
  { art: null, seed: '', round: false, numbered: false, subtitle: '', positions: false },
)

const router = useRouter()
const player = usePlayer()

/** Цвет шапки — по обложке коллекции (или первой обложке среди треков) */
const colors = useCoverGlow(() => {
  const withArt = props.tracks.find((t) => t.art)
  return { art: props.art || withArt?.art, seed: props.seed || props.title, color1: withArt?.color1, color2: withArt?.color2 }
})
/* Страницу открыли тапом по карточке: обложка прилетает из неё */
const heroCover = ref<ComponentPublicInstance | null>(null)
const land = () => flyCoverTo(heroCover.value?.$el as HTMLElement | undefined)
onMounted(land)
onActivated(land)

const totalMs = computed(() => props.tracks.reduce((s, t) => s + t.durationMs, 0))
const line = computed(
  () => props.subtitle || `${countLabel(props.tracks.length, ['трек', 'трека', 'треков'])} · ${formatListen(totalMs.value)}`,
)
</script>

<template>
  <div class="screen page">
    <TrackList
      :tracks="tracks"
      :source="source"
      :numbered="numbered"
      :meta="meta"
      :play="play ? (i: number) => play!(i, false) : undefined"
      :positions="positions"
      :detail="detail"
      :extra-label="extraLabel"
      :reorder="reorder"
    >
      <template #header>
        <div class="hero" :class="{ wide: isDesktop }" :style="{ '--c1': colors[0], '--c2': colors[1] }">
          <div class="bar">
            <button type="button" class="icon-btn" aria-label="Назад" @click="router.back()"><IconBack /></button>
            <slot name="actions" />
          </div>
          <CoverArt
            ref="heroCover"
            :art="art"
            :seed="seed || title"
            :label="title"
            size="m"
            :radius="round ? '50%' : 'var(--r-l)'"
            class="cv"
          />
          <!-- .meta и .acts на телефоне «прозрачные» (display: contents): раскладку столбиком они не меняют -->
          <div class="meta">
            <p class="kind">{{ kind }}</p>
            <h1 class="display title">{{ title }}</h1>
            <p class="line muted">{{ line }}</p>
            <div class="acts">
              <div class="btns">
                <button
                  type="button"
                  class="btn primary"
                  :disabled="!tracks.length"
                  @click="play ? play(0, false) : player.playTracks(tracks, 0, source, { shuffle: false })"
                >
                  <IconPlay />Слушать
                </button>
                <button
                  type="button"
                  class="btn"
                  :disabled="!tracks.length"
                  @click="play ? play(-1, true) : player.playTracks(tracks, -1, source, { shuffle: true })"
                >
                  <IconShuffle />Перемешать
                </button>
              </div>
              <slot name="extra" />
            </div>
          </div>
        </div>
      </template>
    </TrackList>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  padding: calc(var(--safe-top) + 4px) var(--gutter) 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background: linear-gradient(180deg, color-mix(in srgb, var(--c1) 42%, transparent), transparent 85%);
}
.bar {
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cv {
  width: min(56vw, 230px);
  box-shadow: var(--shadow-cover);
  margin-top: 4px;
}
.meta,
.acts {
  display: contents;
}
.kind {
  margin-top: 16px;
  font: 600 13px/1 var(--f-body);
  color: var(--ink-2);
}
.title {
  margin-top: 8px;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
  text-wrap: balance;
}
.line {
  margin-top: 6px;
  font-size: 13px;
}
.btns {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

/* ---------- окно компьютера: шапка в строку ---------- */
.hero.wide {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas:
    'bar bar'
    'cv meta';
  column-gap: 30px;
  align-items: end;
  padding: 4px var(--gutter) 22px;
  text-align: left;
  /* Свет обложки: слева её основной цвет, справа второй; книзу гаснет */
  background:
    radial-gradient(70% 120% at 12% 0%, color-mix(in srgb, var(--c1) 46%, transparent), transparent 70%),
    radial-gradient(60% 110% at 92% 8%, color-mix(in srgb, var(--c2) 26%, transparent), transparent 72%);
}
.wide .bar {
  grid-area: bar;
  height: 44px;
  margin: 0 -10px 6px;
  width: auto;
}
.wide .cv {
  grid-area: cv;
  width: clamp(168px, 19cqw, 232px);
  margin-top: 0;
  box-shadow:
    0 30px 50px -24px color-mix(in srgb, var(--c1) 70%, #000),
    0 10px 20px -12px rgba(0, 0, 0, 0.6);
}
.wide .meta {
  grid-area: meta;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  padding-bottom: 2px;
}
.wide .kind {
  margin-top: 0;
}
.wide .title {
  margin-top: 10px;
  font-size: clamp(34px, 4.6cqw, 60px);
  font-weight: 700;
  line-height: 1.04;
  letter-spacing: -0.045em;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* Выносные элементы букв (й, ё, д) не должны обрезаться ограничением строк */
  padding-block: 0.06em;
}
.wide .line {
  margin-top: 10px;
  font-size: 13.5px;
}
.wide .acts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
}
.wide .btns {
  margin-top: 0;
}
/* Дополнительные кнопки страницы (добавить треки, стыки микса) — в той же строке, без своих отступов */
.wide .acts :deep(.btn) {
  margin-top: 0;
}
/* Всё остальное из дополнений (подсказка, вложенные папки) — отдельной строкой под кнопками */
.wide .acts > :deep(:not(.btns):not(button)) {
  flex-basis: 100%;
  max-width: none;
  margin-top: 2px;
}
</style>
