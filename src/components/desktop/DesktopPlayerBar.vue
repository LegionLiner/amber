<script setup lang="ts">
import { computed, ref } from 'vue'
import IconPlay from '~icons/solar/play-bold'
import IconPause from '~icons/solar/pause-bold'
import IconNext from '~icons/solar/skip-next-bold'
import IconPrev from '~icons/solar/skip-previous-bold'
import IconShuffle from '~icons/solar/shuffle-linear'
import IconRepeat from '~icons/solar/repeat-linear'
import IconRepeatOne from '~icons/solar/repeat-one-linear'
import IconHeart from '~icons/solar/heart-linear'
import IconHeartOn from '~icons/solar/heart-bold'
import IconQueue from '~icons/solar/playlist-linear'
import IconText from '~icons/solar/document-text-linear'
import IconSleep from '~icons/solar/moon-sleep-linear'
import IconTune from '~icons/solar/tuning-2-linear'
import IconVolume from '~icons/solar/volume-loud-linear'
import IconVolumeLow from '~icons/solar/volume-small-linear'
import IconMute from '~icons/solar/volume-cross-linear'
import IconExpand from '~icons/solar/maximize-square-minimalistic-linear'
import IconMic from '~icons/solar/microphone-linear'
import CoverArt from '@/components/CoverArt.vue'
import BarSlider from './BarSlider.vue'
import SpeedSheet from '@/features/player/SpeedSheet.vue'
import LyricsSheet from '@/features/player/LyricsSheet.vue'
import SleepSheet from '@/features/player/SleepSheet.vue'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { formatDuration } from '@/domain/format'
import { plainSound } from '@/domain/effects'
import { setVolume, toggleMute, volume } from '@/app/desktop'
import { voice } from '@/app/voice'
import { useCoverGlow } from '@/app/cover-colors'
import { useSettings } from '@/stores/settings'

/**
 * Панель плеера внизу окна: что играет, управление и перемотка посередине, звук, очередь и громкость справа.
 * Заменяет на компьютере мини-плеер и нижнюю навигацию. Обложка и название открывают большой плеер.
 */
const player = usePlayer()
const library = useLibrary()
const ui = useUi()
const settings = useSettings()
const micTitle = computed(() =>
  voice.state === 'listening'
    ? 'Слушаю: «Эмбер, стоп / дальше / назад / тише / громче». Нажми, чтобы выключить'
    : voice.state === 'loading'
      ? `${voice.stage}…`
      : voice.state === 'error'
        ? `Голосовые команды: ${voice.error}`
        : 'Голосовые команды',
)

const item = computed(() => player.current)
const track = computed(() => player.currentTrack)
/** Капсула слегка подкрашена обложкой того, что играет */
const colors = useCoverGlow(() => ({
  art: track.value?.art,
  seed: item.value?.title ?? 'amber',
  color1: track.value?.color1,
  color2: track.value?.color2,
}))
const soundOn = computed(() => !plainSound(player.sound))
const sleepOn = computed(() => player.sleepAt > 0 || player.sleepEndOfTrack)

/** Пока тянешь перемотку, время показывает точку под курсором, а музыка ещё не прыгает */
const seekDraft = ref<number | null>(null)
const frac = computed(() => {
  if (seekDraft.value != null) return seekDraft.value
  return player.durationMs > 0 ? Math.min(1, player.position / player.durationMs) : 0
})
const shownPos = computed(() => (seekDraft.value != null ? seekDraft.value * player.durationMs : player.position))
function seekTo(v: number) {
  seekDraft.value = null
  if (player.durationMs > 0) void player.seek(v * player.durationMs)
}

function favorite() {
  if (track.value) void library.toggleFavorite(track.value.key)
}
</script>

<template>
  <footer class="pbar" :class="{ empty: !item }" :style="{ '--c1': colors[0] }">
    <div class="now">
      <template v-if="item">
        <button type="button" class="cover" aria-label="Открыть плеер" @click="ui.fullPlayer = true">
          <CoverArt :art="track?.art" :seed="item.title" :label="item.title" size="s" radius="12px" />
          <span class="expand"><IconExpand /></span>
        </button>
        <div class="names">
          <button type="button" class="t ellipsis" @click="ui.fullPlayer = true">{{ item.title }}</button>
          <span class="a ellipsis"
            >{{ item.artist }}<template v-if="item.album"> · {{ item.album }}</template></span
          >
        </div>
        <button
          type="button"
          class="icon-btn heart"
          :class="{ on: track?.favoriteAt }"
          :aria-label="track?.favoriteAt ? 'Убрать из избранного' : 'В избранное'"
          title="В избранное (Ctrl+L)"
          @click="favorite"
        >
          <IconHeartOn v-if="track?.favoriteAt" /><IconHeart v-else />
        </button>
      </template>
      <span v-else class="idle">Выбери трек — он заиграет здесь</span>
    </div>

    <div class="mid">
      <div class="controls">
        <button
          type="button"
          class="icon-btn small"
          :class="{ on: player.shuffleMode !== 'off' }"
          aria-label="Перемешивание"
          title="Перемешивание"
          :disabled="!item"
          @click="player.toggleShuffle()"
        >
          <IconShuffle />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="Предыдущий"
          title="Предыдущий (Ctrl+←)"
          :disabled="!item"
          @click="player.prev()"
        >
          <IconPrev />
        </button>
        <button
          type="button"
          class="play"
          :aria-label="player.playing ? 'Пауза' : 'Играть'"
          title="Пауза / играть (пробел)"
          :disabled="!item"
          @click="player.toggle()"
        >
          <IconPause v-if="player.playing" /><IconPlay v-else />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="Следующий"
          title="Следующий (Ctrl+→)"
          :disabled="!item"
          @click="player.next()"
        >
          <IconNext />
        </button>
        <button
          type="button"
          class="icon-btn small"
          :class="{ on: player.repeat !== 'off' }"
          :aria-label="player.repeat === 'one' ? 'Повтор трека' : player.repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен'"
          title="Повтор"
          :disabled="!item"
          @click="player.cycleRepeat()"
        >
          <IconRepeatOne v-if="player.repeat === 'one'" /><IconRepeat v-else />
        </button>
      </div>
      <div class="seek">
        <span class="time num">{{ formatDuration(shownPos) }}</span>
        <BarSlider
          class="seekbar"
          :value="frac"
          label="Перемотка"
          :wheel-step="0.02"
          @input="(v: number) => (seekDraft = v)"
          @change="seekTo"
        />
        <span class="time num">{{ formatDuration(player.durationMs) }}</span>
      </div>
    </div>

    <div class="tools">
      <button
        type="button"
        class="icon-btn opt"
        :class="{ on: soundOn }"
        aria-label="Звук: пресеты, скорость и эффекты"
        title="Звук: пресеты, скорость и эффекты"
        @click="ui.openSheet(SpeedSheet)"
      >
        <IconTune />
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Текст песни"
        title="Текст песни"
        :disabled="!item"
        @click="ui.openSheet(LyricsSheet)"
      >
        <IconText />
      </button>
      <button
        type="button"
        class="icon-btn opt"
        :class="{ on: sleepOn }"
        aria-label="Сон-таймер"
        title="Сон-таймер"
        @click="ui.openSheet(SleepSheet)"
      >
        <IconSleep />
      </button>
      <button
        type="button"
        class="icon-btn"
        :class="{ on: ui.queueOpen }"
        aria-label="Очередь"
        title="Очередь"
        @click="ui.queueOpen = !ui.queueOpen"
      >
        <IconQueue />
      </button>
      <button
        v-if="settings.s.voice"
        type="button"
        class="icon-btn mic"
        :class="[voice.state, { wake: voice.wakeAt > 0 }]"
        :aria-label="micTitle"
        :title="micTitle"
        @click="settings.s.voice = false"
      >
        <IconMic />
      </button>
      <div class="vol">
        <button
          type="button"
          class="icon-btn"
          :aria-label="volume > 0 ? 'Выключить звук' : 'Включить звук'"
          title="Громкость (Ctrl+↑/↓)"
          @click="toggleMute"
        >
          <IconMute v-if="volume === 0" /><IconVolumeLow v-else-if="volume < 0.5" /><IconVolume v-else />
        </button>
        <BarSlider class="volbar" :value="volume" label="Громкость" @input="setVolume" @change="setVolume" />
      </div>
    </div>
  </footer>
</template>

<style scoped>
/*
 * Плеер — стеклянная капсула, плавающая над нижним краем сцены: списки прокручиваются под ней.
 * Слева она подсвечена цветом обложки. Ширина считается от сцены, поэтому в узком окне
 * второстепенные кнопки и ползунок громкости уходят сами (контейнерные запросы ниже).
 */
.pbar {
  grid-column: 2;
  grid-row: 2;
  align-self: end;
  justify-self: center;
  container-type: inline-size;
  container-name: dock;
  position: relative;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  width: min(calc(100% - 28px), 1180px);
  height: var(--dock-h);
  margin-bottom: 12px;
  padding: 0 12px 0 10px;
  border-radius: 20px;
  background:
    radial-gradient(46% 180% at 0% 50%, color-mix(in srgb, var(--c1) 24%, transparent), transparent 70%), var(--glass-dock);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-hi), var(--shadow-float);
  transition: --c1 1.2s var(--ease);
}
.now {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.cover {
  position: relative;
  width: 52px;
  height: 52px;
  flex: none;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 10px 20px -10px color-mix(in srgb, var(--c1) 75%, #000);
  transition: transform var(--t-fast) var(--ease);
}
.cover :deep(.cover) {
  width: 52px;
  height: 52px;
}
.cover:hover {
  transform: scale(1.04);
}
.cover:active {
  transform: scale(0.97);
}
.expand {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  opacity: 0;
  transition: opacity var(--t-fast) var(--ease);
}
.expand svg {
  width: 20px;
  height: 20px;
}
.cover:hover .expand,
.cover:focus-visible .expand {
  opacity: 1;
}
.names {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.t {
  font: 600 14.5px/1.2 var(--f-body);
  text-align: left;
  max-width: 100%;
}
.t:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.a {
  font-size: 12.5px;
  color: var(--ink-2);
}
.idle {
  padding-left: 8px;
  color: var(--ink-3);
  font-size: 13.5px;
}
.heart {
  flex: none;
}
.heart.on {
  color: var(--heart);
}
.mid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  width: clamp(280px, 44cqw, 600px);
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.controls .icon-btn {
  width: 36px;
  height: 36px;
}
.controls .icon-btn svg {
  width: 21px;
  height: 21px;
}
.controls .small svg {
  width: 18px;
  height: 18px;
}
.controls .small {
  color: var(--ink-2);
}
.play {
  width: 38px;
  height: 38px;
  margin: 0 4px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--ink);
  color: var(--bg);
  box-shadow: 0 6px 16px -6px color-mix(in srgb, var(--ink) 55%, transparent);
  transition:
    transform var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}
.play:hover:not(:disabled) {
  transform: scale(1.07);
  box-shadow: 0 8px 20px -6px color-mix(in srgb, var(--ink) 70%, transparent);
}
.play:active:not(:disabled) {
  transform: scale(0.94);
}
.play svg {
  width: 17px;
  height: 17px;
}
.icon-btn.on {
  color: var(--amber-ink);
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
.seek {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.time {
  font-size: 11.5px;
  color: var(--ink-3);
  text-align: center;
}
.tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  min-width: 0;
}
.tools .icon-btn {
  width: 36px;
  height: 36px;
  color: var(--ink-2);
}
.tools .icon-btn:hover:not(:disabled) {
  color: var(--ink);
}
.tools .icon-btn.on {
  color: var(--amber-ink);
}
.tools .icon-btn svg {
  width: 20px;
  height: 20px;
}
.vol {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
}
.volbar {
  width: 92px;
}
/* Узкая сцена: сначала уходит ползунок громкости, потом второстепенные кнопки и альбом в подписи */
@container dock (max-width: 900px) {
  .volbar {
    display: none;
  }
}
@container dock (max-width: 780px) {
  .opt,
  .heart {
    display: none;
  }
}
/* Голосовые команды: слушает — янтарный, услышал «Эмбер» — пульсирует, ошибка — красный */
.mic.listening {
  color: var(--amber-ink);
}
.mic.loading {
  opacity: 0.5;
}
.mic.error {
  color: var(--bad);
}
.mic.wake {
  color: var(--amber);
  background: rgba(var(--amber-rgb), 0.18);
  animation: mic-pulse 0.9s ease-in-out infinite alternate;
}
@keyframes mic-pulse {
  to {
    box-shadow: 0 0 0 6px rgba(var(--amber-rgb), 0.12);
  }
}
</style>
