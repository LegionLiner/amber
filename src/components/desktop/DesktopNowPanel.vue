<script setup lang="ts">
import { computed } from 'vue'
import IconHeart from '~icons/solar/heart-linear'
import IconHeartOn from '~icons/solar/heart-bold'
import IconExpand from '~icons/solar/maximize-square-minimalistic-linear'
import IconClose from '~icons/solar/alt-arrow-right-linear'
import CoverArt from '@/components/CoverArt.vue'
import RatingStars from '@/components/RatingStars.vue'
import NowExtras from './NowExtras.vue'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useCoverGlow } from '@/app/cover-colors'
import TrackLinks from '@/components/TrackLinks.vue'
import { countLabel, relativeDay } from '@/domain/format'
import { $t, $tp } from '@/i18n'

/**
 * Панель «Сейчас играет» справа — то, ради чего на широком окне раньше открывали большой плеер:
 * обложка, оценка и избранное под рукой, текущие строки текста (если он синхронный) и что будет дальше.
 * Стоит в сетке окна отдельной стеклянной панелью и сворачивается кнопкой в строке заголовка.
 */
const player = usePlayer()
const library = useLibrary()
const settings = useSettings()
const ui = useUi()

const item = computed(() => player.current)
const track = computed(() => player.currentTrack)
const colors = useCoverGlow(() => ({
  art: track.value?.art,
  seed: item.value?.title ?? 'amber',
  color1: track.value?.color1,
  color2: track.value?.color2,
}))

const stats = computed(() => {
  const t = track.value
  if (!t) return ''
  const parts: string[] = []
  if (t.plays) parts.push(countLabel(t.plays, $tp('прослушивание|прослушивания|прослушиваний')))
  if (t.lastPlayedAt) parts.push($t('последний раз {0}', relativeDay(t.lastPlayedAt)))
  return parts.join(' · ')
})

function favorite() {
  if (track.value) void library.toggleFavorite(track.value.key)
}
function rate(v: number | null) {
  if (track.value) void library.setRating(track.value.key, v)
}
</script>

<template>
  <aside v-if="item" class="nowp" :aria-label="$t('Сейчас играет')" :style="{ '--c1': colors[0], '--c2': colors[1] }">
    <div class="scroll body">
      <header class="head">
        <span class="label">{{ $t('Сейчас играет') }}</span>
        <button
          type="button"
          class="hbtn"
          :aria-label="$t('Свернуть панель')"
          :title="$t('Свернуть панель')"
          @click="settings.s.nowPanel = false"
        >
          <IconClose />
        </button>
      </header>

      <button type="button" class="art" :aria-label="$t('Открыть плеер')" @click="ui.fullPlayer = true">
        <Transition name="np-art" mode="out-in">
          <CoverArt :key="item.qid" :art="track?.art" :seed="item.title" :label="item.title" size="l" radius="18px" />
        </Transition>
        <span class="expand"><IconExpand /></span>
      </button>

      <Transition name="np-text" mode="out-in">
        <div :key="item.qid" class="names">
          <h2 class="display title">{{ item.title }}</h2>
          <!-- Ссылки строчные (TrackLinks): у каждого исполнителя своя, при переносе ничего не отрывается -->
          <p class="by"><TrackLinks :track="track" :fallback="item.artist" album /></p>
        </div>
      </Transition>

      <div class="rate">
        <RatingStars :model-value="track?.rating ?? null" :size="22" @update:model-value="rate" />
        <button
          type="button"
          class="hbtn heart"
          :class="{ on: track?.favoriteAt }"
          :aria-label="track?.favoriteAt ? $t('Убрать из избранного') : $t('В избранное')"
          @click="favorite"
        >
          <IconHeartOn v-if="track?.favoriteAt" /><IconHeart v-else />
        </button>
      </div>
      <p v-if="stats" class="stats num">{{ stats }}</p>

      <NowExtras class="extras" :next="5" />
    </div>
  </aside>
</template>

<style scoped>
.nowp {
  grid-column: 3;
  grid-row: 2;
  position: relative;
  z-index: 2;
  width: var(--now-w);
  min-height: 0;
  border-radius: var(--pane-r);
  overflow: hidden;
  /* Верх панели чуть подкрашен обложкой: она «светит» вниз */
  background:
    radial-gradient(120% 46% at 50% 0%, color-mix(in srgb, var(--c1) 26%, transparent), transparent 72%), var(--glass-pane);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-hi), var(--shadow-pane);
  transition:
    --c1 1.2s var(--ease),
    --c2 1.2s var(--ease);
}
.body {
  height: 100%;
  padding: 12px 16px calc(var(--pane-gap) + 6px);
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
}
.label {
  font: 600 12.5px/1 var(--f-body);
  color: var(--ink-2);
}
.hbtn {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--ink-2);
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    transform var(--t-fast) var(--ease);
}
.hbtn svg {
  width: 19px;
  height: 19px;
}
.hbtn:hover {
  background: var(--chip);
  color: var(--ink);
}
.hbtn:active {
  transform: scale(0.9);
}
.heart.on {
  color: var(--heart);
}

/* ---- обложка ---- */
.art {
  position: relative;
  display: block;
  margin-top: 8px;
  border-radius: 18px;
  transition: transform var(--t-mid) var(--ease-out);
}
.art :deep(.cover) {
  width: 100%;
  /* Тень в цвет обложки, а не чёрная: обложка будто подсвечивает панель */
  box-shadow:
    0 26px 44px -26px color-mix(in srgb, var(--c1) 70%, #000),
    0 2px 0 rgba(255, 255, 255, 0.06) inset;
}
.art:hover {
  transform: translateY(-2px) scale(1.012);
}
.art:active {
  transform: scale(0.985);
}
.expand {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: rgba(0, 0, 0, 0.5);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  color: #fff;
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity var(--t-fast) var(--ease),
    transform var(--t-fast) var(--ease);
}
.expand svg {
  width: 18px;
  height: 18px;
}
.art:hover .expand,
.art:focus-visible .expand {
  opacity: 1;
  transform: none;
}

/* ---- название ---- */
.names {
  margin-top: 16px;
  min-width: 0;
}
.title {
  font-size: 19px;
  font-weight: 600;
  line-height: 1.22;
  letter-spacing: -0.02em;
  text-wrap: balance;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.by {
  margin-top: 6px;
  font-size: 13.5px;
  line-height: 1.35;
  color: var(--ink-2);
}
.rate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
.stats {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-3);
}

.extras {
  margin-top: 16px;
}

/* смена трека: обложка и название проявляются заново */
.np-art-enter-active,
.np-art-leave-active {
  transition:
    opacity 220ms var(--ease),
    transform 320ms var(--ease-out);
}
.np-art-enter-from {
  opacity: 0;
  transform: scale(0.96);
}
.np-art-leave-to {
  opacity: 0;
  transform: scale(1.02);
}
.np-text-enter-active,
.np-text-leave-active {
  transition:
    opacity 180ms var(--ease),
    transform 260ms var(--ease-out);
}
.np-text-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.np-text-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
