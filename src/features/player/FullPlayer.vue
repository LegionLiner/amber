<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import IconDown from '~icons/solar/alt-arrow-down-linear'
import IconMore from '~icons/solar/menu-dots-bold'
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
import IconPhone from '~icons/solar/smartphone-linear'
import IconBt from '~icons/solar/bluetooth-linear'
import IconHeadphones from '~icons/solar/headphones-round-linear'
import IconText from '~icons/solar/document-text-linear'
import IconSleep from '~icons/solar/moon-sleep-linear'
import SleepSheet from './SleepSheet.vue'
import PlayerMenuSheet from './PlayerMenuSheet.vue'
import OutputSheet from './OutputSheet.vue'
import LyricsSheet from './LyricsSheet.vue'
import SpeedSheet from './SpeedSheet.vue'
import { loadWaveform } from '@/data/repos/library'
import { outputLabel } from '@/domain/outputs'
import { bookmarksFor, type Bookmark } from '@/data/repos/bookmarks'
import CoverArt from '@/components/CoverArt.vue'
import RatingStars from '@/components/RatingStars.vue'
import SeekBar from './SeekBar.vue'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { ambientColors } from '@/domain/palette'
import { sourceLabel } from '@/domain/sources'
import { haptic } from '@/native/haptics'

const player = usePlayer()
const library = useLibrary()
const ui = useUi()

const item = computed(() => player.current)
const track = computed(() => player.currentTrack)
const colors = computed(() => {
  const t = track.value
  return ambientColors(t?.color1 ?? null, t?.color2 ?? null, item.value?.title ?? '')
})
const source = computed(() => (item.value ? sourceLabel(item.value.source) : ''))

/* ---- метки текущего трека: засечки на полосе перемотки ---- */
const marks = shallowRef<Bookmark[]>([])
async function loadMarks() {
  const k = item.value?.key
  marks.value = k ? await bookmarksFor(k) : []
}
watch(() => item.value?.key, loadMarks, { immediate: true })
const markPoints = computed(() => marks.value.map((b) => ({ at: b.positionMs, best: b.kind === 'best' })))

/* ---- волна трека из анализа ---- */
const wave = shallowRef<Uint8Array | null>(null)
watch(
  () => [item.value?.key, track.value?.analyzed] as const,
  async ([k]) => {
    wave.value = k ? await loadWaveform(k).catch(() => null) : null
  },
  { immediate: true },
)
const outIcon = computed(() => {
  const o = player.output
  return o.startsWith('bt:') ? IconBt : o === 'wired' || o === 'usb' ? IconHeadphones : IconPhone
})

// Метки могли поменяться в шторке «Метки» из меню плеера
watch(
  () => ui.sheet,
  (s, old) => {
    if (!s && old) void loadMarks()
  },
)

const sleepOn = computed(() => player.sleepAt > 0 || player.sleepEndOfTrack)

function close() {
  ui.fullPlayer = false
}

/* ---- жест вниз для закрытия и свайпы по обложке ---- */
const dy = ref(0)
const artDx = ref(0)
let sx = 0
let sy = 0
let lock: 'x' | 'y' | null = null
let active = false
let zone: 'top' | 'art' = 'top'
let lastTap = 0
const burst = ref(0)

function down(e: PointerEvent, z: 'top' | 'art') {
  active = true
  lock = null
  zone = z
  sx = e.clientX
  sy = e.clientY
}
function move(e: PointerEvent) {
  if (!active) return
  const mx = e.clientX - sx
  const my = e.clientY - sy
  if (!lock && Math.hypot(mx, my) > 8) {
    lock = zone === 'art' && Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  if (lock === 'y') dy.value = Math.max(0, my)
  if (lock === 'x') artDx.value = mx
}
async function up() {
  if (!active) return
  active = false
  if (lock === 'y') {
    if (dy.value > 110) close()
    dy.value = 0
  } else if (lock === 'x') {
    const d = artDx.value
    artDx.value = 0
    if (Math.abs(d) > 70) {
      haptic.tick()
      await (d < 0 ? player.next() : player.prev())
    }
  } else if (zone === 'art') {
    const now = Date.now()
    if (now - lastTap < 320) {
      lastTap = 0
      void favorite(true)
    } else lastTap = now
  }
}

async function favorite(fromDoubleTap = false) {
  const t = track.value
  if (!t) return
  if (fromDoubleTap && t.favoriteAt) {
    burst.value++
    haptic.tick()
    return
  }
  const on = await library.toggleFavorite(t.key)
  if (on) burst.value++
  haptic.success()
}

function rate(v: number | null) {
  if (track.value) void library.setRating(track.value.key, v)
}

function more() {
  if (item.value) ui.openSheet(PlayerMenuSheet)
}

/**
 * «Полёт» обложки: при открытии из мини-плеера обложка вылетает из маленькой в большую (FLIP),
 * а фон плеера проявляется. Без мини-плеера (или с выключенными анимациями) — обычный выезд снизу.
 */
function onEnter(el: Element, done: () => void) {
  const root = el as HTMLElement
  const art = root.querySelector<HTMLElement>('.art')
  const from = document.querySelector<HTMLElement>('.mini .cv')?.getBoundingClientRect()
  const reduced = document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!art || !from || !from.width || reduced) {
    root.classList.add('slide-in')
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('slide-in')))
    setTimeout(done, 340)
    return
  }
  const to = art.getBoundingClientRect()
  const s = from.width / to.width
  art.style.transition = 'none'
  art.style.transformOrigin = 'top left'
  art.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`
  root.style.transition = 'none'
  root.style.opacity = '0'
  void root.offsetWidth
  art.style.transition = 'transform 460ms cubic-bezier(0.16, 1, 0.3, 1)'
  art.style.transform = ''
  root.style.transition = 'opacity 240ms ease'
  root.style.opacity = '1'
  setTimeout(() => {
    art.style.transition = ''
    art.style.transformOrigin = ''
    root.style.transition = ''
    root.style.opacity = ''
    done()
  }, 480)
}

function onLeave(el: Element, done: () => void) {
  const root = el as HTMLElement
  root.style.transition = 'transform 320ms cubic-bezier(0.16, 1, 0.3, 1)'
  root.style.transform = 'translateY(100%)'
  setTimeout(done, 330)
}

function togglePlay() {
  haptic.tick()
  void player.toggle()
}
</script>

<template>
  <Transition name="full" :css="false" @enter="onEnter" @leave="onLeave">
    <div
      v-if="ui.fullPlayer && item"
      class="full"
      :style="dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined"
      role="dialog"
      aria-label="Плеер"
    >
      <div class="ambient" :style="{ '--c1': colors[0], '--c2': colors[1] }" aria-hidden="true">
        <i class="b1" /><i class="b2" /><i class="b3" />
        <div class="veil" />
      </div>

      <div class="content">
        <header class="top" @pointerdown="down($event, 'top')" @pointermove="move" @pointerup="up" @pointercancel="up">
          <button type="button" class="icon-btn" aria-label="Свернуть" @pointerdown.stop @click="close"><IconDown /></button>
          <div class="src">
            <small>Играет из</small>
            <b class="ellipsis">{{ source }}</b>
          </div>
          <button type="button" class="icon-btn" aria-label="Действия" @pointerdown.stop @click="more"><IconMore /></button>
        </header>

        <div class="art-wrap" @pointerdown="down($event, 'art')" @pointermove="move" @pointerup="up" @pointercancel="up">
          <div
            class="art"
            :style="artDx ? { transform: `translateX(${artDx}px) rotate(${artDx / 40}deg)`, transition: 'none' } : undefined"
          >
            <CoverArt :art="track?.art" :seed="item.title" :label="item.title" size="l" radius="var(--r-l)" />
          </div>
          <IconHeartOn v-if="burst" :key="burst" class="burst" aria-hidden="true" />
        </div>

        <div class="info">
          <div class="names">
            <h2 class="display ellipsis">{{ item.title }}</h2>
            <p class="ellipsis">
              {{ item.artist }}<template v-if="item.album"> · {{ item.album }}</template>
            </p>
          </div>
          <button
            type="button"
            class="icon-btn heart"
            :class="{ on: track?.favoriteAt }"
            aria-label="Избранное"
            @click="favorite()"
          >
            <IconHeartOn v-if="track?.favoriteAt" />
            <IconHeart v-else />
          </button>
        </div>

        <div class="rate">
          <RatingStars :model-value="track?.rating ?? null" :size="26" @update:model-value="rate" />
          <span class="plays num">{{ track?.plays ? `${track.plays} прослуш.` : 'первый раз' }}</span>
        </div>

        <SeekBar
          :position="player.position"
          :duration="player.durationMs"
          :marks="markPoints"
          :wave="wave"
          :ab="player.ab"
          @seek="player.seek"
        />

        <div class="controls">
          <button
            type="button"
            class="icon-btn small"
            :class="{ on: player.shuffleMode !== 'off' }"
            aria-label="Перемешивание"
            @click="player.toggleShuffle()"
          >
            <IconShuffle />
          </button>
          <button type="button" class="icon-btn big-nav" aria-label="Предыдущий" @click="player.prev()"><IconPrev /></button>
          <button type="button" class="play" :aria-label="player.playing ? 'Пауза' : 'Играть'" @click="togglePlay">
            <IconPause v-if="player.playing" />
            <IconPlay v-else />
          </button>
          <button type="button" class="icon-btn big-nav" aria-label="Следующий" @click="player.next()"><IconNext /></button>
          <button
            type="button"
            class="icon-btn small"
            :class="{ on: player.repeat !== 'off' }"
            aria-label="Повтор"
            @click="player.cycleRepeat()"
          >
            <IconRepeatOne v-if="player.repeat === 'one'" />
            <IconRepeat v-else />
          </button>
        </div>

        <div class="bottom">
          <button type="button" class="out" @click="ui.openSheet(OutputSheet)">
            <component :is="outIcon" /><span class="ellipsis">{{ outputLabel(player.output) }}</span>
          </button>
          <span class="tools">
            <button v-if="player.speed !== 1" type="button" class="speed num" @click="ui.openSheet(SpeedSheet)">
              {{ player.speed.toFixed(2).replace(/0$/, '') }}×
            </button>
            <button type="button" class="icon-btn" aria-label="Текст песни" @click="ui.openSheet(LyricsSheet)">
              <IconText />
            </button>
            <button
              type="button"
              class="icon-btn"
              :class="{ on: sleepOn }"
              aria-label="Сон-таймер"
              @click="ui.openSheet(SleepSheet)"
            >
              <IconSleep />
            </button>
            <button type="button" class="icon-btn" aria-label="Очередь" @click="ui.queueOpen = true"><IconQueue /></button>
          </span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.full {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: var(--bg);
  overflow: hidden;
  transition: transform var(--t-mid) var(--ease-out);
}
.full.slide-in {
  transition: none;
  transform: translateY(100%);
}
.full-enter-from,
.full-leave-to {
  transform: translateY(100%);
}
.ambient {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.ambient i {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.75;
}
.b1 {
  width: 90vw;
  height: 90vw;
  left: -30vw;
  top: -20vw;
  background: var(--c1);
  animation: drift1 26s ease-in-out infinite alternate;
}
.b2 {
  width: 80vw;
  height: 80vw;
  right: -35vw;
  top: 30vh;
  background: var(--c2);
  opacity: 0.5 !important;
  animation: drift2 30s ease-in-out infinite alternate;
}
.b3 {
  width: 70vw;
  height: 70vw;
  left: 10vw;
  top: 10vh;
  background: var(--c1);
  opacity: 0.35 !important;
  animation: drift1 34s ease-in-out infinite alternate-reverse;
}
[data-theme='light'] .ambient i {
  opacity: 0.45;
}
@keyframes drift1 {
  to {
    transform: translate(18vw, 10vh) scale(1.15);
  }
}
@keyframes drift2 {
  to {
    transform: translate(-16vw, 8vh) scale(0.9);
  }
}
.veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg) 15%, transparent) 0%,
    color-mix(in srgb, var(--bg) 55%, transparent) 50%,
    var(--bg) 92%
  );
}
.content {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: calc(var(--safe-top) + 4px) 22px calc(var(--safe-bottom) + 14px);
}
.top {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
  gap: 8px;
  height: 52px;
  touch-action: none;
}
.src {
  text-align: center;
  min-width: 0;
  line-height: 1.25;
}
.src small {
  display: block;
  font-size: 11px;
  color: var(--ink-2);
}
.src b {
  display: block;
  font-size: 13px;
  font-weight: 600;
}
.art-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 14px 0 10px;
  touch-action: none;
}
.art {
  width: min(100%, 46vh);
  box-shadow: var(--shadow-cover);
  border-radius: var(--r-l);
  transition: transform 260ms var(--ease-out);
}
.burst {
  position: absolute;
  width: 96px;
  height: 96px;
  color: var(--heart);
  animation: burst 700ms var(--ease-out) forwards;
  pointer-events: none;
  filter: drop-shadow(0 6px 24px rgba(0, 0, 0, 0.35));
}
@keyframes burst {
  0% {
    transform: scale(0.3);
    opacity: 0;
  }
  30% {
    transform: scale(1.15);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 0;
  }
}
.info {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-top: 8px;
}
.names {
  flex: 1;
  min-width: 0;
}
.names h2 {
  font-size: 21px;
  font-weight: 600;
  line-height: 1.2;
}
.names p {
  margin-top: 5px;
  font-size: 14.5px;
  color: var(--ink-2);
}
.heart.on {
  color: var(--heart);
}
.rate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 6px 0 4px;
}
.plays {
  font-size: 12.5px;
  color: var(--ink-2);
}
.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}
.small svg {
  width: 22px;
  height: 22px;
}
.icon-btn:not(.on).small {
  color: var(--ink-2);
}
.big-nav {
  width: 56px;
  height: 56px;
}
.big-nav svg {
  width: 32px;
  height: 32px;
}
.play {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--ink);
  color: var(--bg);
  transition: transform var(--t-fast) var(--ease);
}
.play:active {
  transform: scale(0.94);
}
.play svg {
  width: 32px;
  height: 32px;
}
.bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}
.tools {
  display: flex;
  gap: 2px;
}
.speed {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(var(--amber-rgb), 0.16);
  color: var(--amber-ink);
  font: 600 12.5px/1 var(--f-body);
  align-self: center;
}
.out {
  max-width: 48%;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 13px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--amber-ink);
  font: 500 12.5px/1 var(--f-body);
}
.out svg {
  width: 16px;
  height: 16px;
  flex: none;
}
</style>
