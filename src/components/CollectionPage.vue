<script setup lang="ts">
import { computed, onActivated, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { useRouter } from 'vue-router'
import IconBack from '~icons/solar/alt-arrow-left-linear'
import IconPlay from '~icons/solar/play-bold'
import IconShuffle from '~icons/solar/shuffle-linear'
import CoverArt from './CoverArt.vue'
import TrackList from './TrackList.vue'
import type { RowMeta } from './TrackRow.vue'
import type { Track } from '@/domain/track'
import type { PlaySource } from '@/native/types'
import { usePlayer } from '@/stores/player'
import { ambientColors } from '@/domain/palette'
import { formatListen, countLabel } from '@/domain/format'
import { flyCoverTo } from '@/app/motion'

/** Общая страница набора треков: альбом, исполнитель, жанр, папка */
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
  }>(),
  { art: null, seed: '', round: false, numbered: false, subtitle: '' },
)

const router = useRouter()
const player = usePlayer()

const colors = computed(() => {
  const withColor = props.tracks.find((t) => t.color1)
  return ambientColors(withColor?.color1 ?? null, withColor?.color2 ?? null, props.seed || props.title)
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
    >
      <template #header>
        <div class="hero" :style="{ '--c1': colors[0] }">
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
          <p class="kind">{{ kind }}</p>
          <h1 class="display title">{{ title }}</h1>
          <p class="line muted">{{ line }}</p>
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
.kind {
  margin-top: 16px;
  font: 600 11px/1 var(--f-body);
  letter-spacing: 0.1em;
  text-transform: uppercase;
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
</style>
