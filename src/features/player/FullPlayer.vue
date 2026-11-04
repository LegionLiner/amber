<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
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
import IconSpeaker from '~icons/solar/speaker-minimalistic-linear'
import IconBt from '~icons/solar/bluetooth-linear'
import IconHeadphones from '~icons/solar/headphones-round-linear'
import IconText from '~icons/solar/document-text-linear'
import IconSleep from '~icons/solar/moon-sleep-linear'
import IconMarks from '~icons/solar/bookmark-linear'
import IconAdd from '~icons/solar/add-square-linear'
import IconTags from '~icons/solar/pen-new-square-linear'
import IconCard from '~icons/solar/music-note-linear'
import { useRouter } from 'vue-router'
import BookmarksSheet from './BookmarksSheet.vue'
import TagEditorSheet from '@/components/TagEditorSheet.vue'
import AddToPlaylistSheet from '@/components/AddToPlaylistSheet.vue'
import IconTune from '~icons/solar/tuning-2-linear'
import IconVolume from '~icons/solar/volume-loud-linear'
import IconMute from '~icons/solar/volume-cross-linear'
import BarSlider from '@/components/desktop/BarSlider.vue'
import { isDesktop } from '@/native/desktop/bridge'
import { setVolume, toggleMute, volume } from '@/app/desktop'
import { plainSound } from '@/domain/effects'
import SleepSheet from './SleepSheet.vue'
import PlayerMenuSheet from './PlayerMenuSheet.vue'
import OutputSheet from './OutputSheet.vue'
import LyricsSheet from './LyricsSheet.vue'
import TrackLinks from '@/components/TrackLinks.vue'
import IconDevices from '~icons/solar/devices-linear'
import IconStage from '~icons/solar/full-screen-linear'
import DevicesSheet from '@/features/remote/DevicesSheet.vue'
import { useSync } from '@/stores/sync'
import { useRemote } from '@/stores/remote'
import PlayerAmbient from './PlayerAmbient.vue'
import NowExtras from '@/components/desktop/NowExtras.vue'
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
import { coverGlow, useCoverGlow } from '@/app/cover-colors'
import { sourceLabel } from '@/domain/sources'
import { haptic } from '@/native/haptics'
import { afterSlide, motionReduced } from '@/app/motion'
import type { QueueItem } from '@/native/types'

const player = usePlayer()
const library = useLibrary()
const ui = useUi()

/*
 * Текст песни на широком окне компьютера — не шторкой, а на месте названия и кнопок, ростом с обложку.
 * Та же кнопка или крестик возвращают кнопки. На телефоне и в узком окне текст открывается шторкой
 */
const wideDesk = useMediaQuery('(min-width: 980px)')
const lyricsMode = ref(false)
const lyricsInline = computed(() => isDesktop && wideDesk.value && lyricsMode.value)
function openLyrics() {
  if (isDesktop && wideDesk.value) lyricsMode.value = !lyricsMode.value
  else ui.openSheet(LyricsSheet)
}
watch(
  () => ui.fullPlayer,
  (open) => {
    if (!open) lyricsMode.value = false
  },
)
/** Сторона обложки: панель текста встаёт ровно с ней по высоте */
const artEl = ref<HTMLElement | null>(null)
const artSize = ref(0)
let artRo: ResizeObserver | null = null
onMounted(() => {
  artRo = new ResizeObserver(() => (artSize.value = Math.round(artEl.value?.getBoundingClientRect().width ?? 0)))
})
watch(artEl, (el, old) => {
  if (old) artRo?.unobserve(old)
  if (el) artRo?.observe(el)
})
onBeforeUnmount(() => artRo?.disconnect())
const sync = useSync()
const remote = useRemote()

const item = computed(() => player.current)
const track = computed(() => player.currentTrack)
/** Фон — цвета, которых на обложке больше всего по площади (app/cover-colors) */
const colors = useCoverGlow(() => ({
  art: track.value?.art,
  seed: item.value?.title ?? '',
  color1: track.value?.color1,
  color2: track.value?.color2,
}))
// Обложку следующего трека разбираем заранее: при смене трека фон готов сразу
watch(
  () => player.upcoming[0]?.key,
  (k) => {
    const art = k ? library.byKey.get(k)?.art : null
    if (art) void coverGlow(art)
  },
  { immediate: true },
)
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
  // Компьютер: устройство Windows по имени — наушники узнаём по названию, остальное — колонки
  if (o.startsWith('pc:')) return /headset|headphone|наушник|гарнитур|airpods|buds/i.test(o) ? IconHeadphones : IconSpeaker
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
const soundOn = computed(() => !plainSound(player.sound))

function close() {
  ui.fullPlayer = false
}
const router = useRouter()
function openCard() {
  if (!item.value) return
  close()
  void router.push(`/track/${item.value.key}`)
}

/* ---- показ: тапом по мини-плееру или протяжкой его вверх (тогда плеер едет за пальцем) ---- */
const shown = computed(() => (ui.fullPlayer || ui.playerDrag != null) && !!item.value)
/** Плеер вытягивается от верхнего края мини-плеера */
const dragFrom = ref(0)
watch(
  () => ui.playerDrag != null,
  (d) => {
    if (d) dragFrom.value = document.querySelector('.mini')?.getBoundingClientRect().top ?? window.innerHeight
  },
)

/* ---- жест вниз для закрытия и свайпы по обложке ---- */
const dy = ref(0)
let sx = 0
let sy = 0
let lock: 'x' | 'y' | null = null
let active = false
let zone: 'top' | 'art' = 'top'
let lastTap = 0
let lastX = 0
let lastY = 0
let lastT = 0
let vx = 0
let vy = 0
const burst = ref(0)

const sheetStyle = computed(() => {
  if (ui.playerDrag != null) return { transform: `translateY(${(1 - ui.playerDrag) * dragFrom.value}px)`, transition: 'none' }
  if (dy.value) return { transform: `translateY(${dy.value}px)`, transition: 'none' }
  return undefined
})

function down(e: PointerEvent, z: 'top' | 'art') {
  active = true
  lock = null
  zone = z
  sx = lastX = e.clientX
  sy = lastY = e.clientY
  lastT = e.timeStamp
  vx = vy = 0
  if (z === 'art' && deck.value) artW = deck.value.offsetWidth
}
function move(e: PointerEvent) {
  if (!active) return
  const mx = e.clientX - sx
  const my = e.clientY - sy
  if (!lock && Math.hypot(mx, my) > 8) {
    // Пока обложка доезжает после прошлого свайпа, новый свайп её не дёргает
    lock = zone === 'art' && Math.abs(mx) > Math.abs(my) && !frozen.value ? 'x' : 'y'
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const dt = Math.max(1, e.timeStamp - lastT)
  vx = (e.clientX - lastX) / dt
  vy = (e.clientY - lastY) / dt
  lastX = e.clientX
  lastY = e.clientY
  lastT = e.timeStamp
  if (lock === 'y') dy.value = Math.max(0, my)
  if (lock === 'x') {
    // В конце очереди соседа нет: обложка идёт туго и возвращается
    const has = mx < 0 ? slots.value[2] : slots.value[0]
    artAnim.value = null
    artDx.value = has ? mx : mx * 0.25
  }
}
function up() {
  if (!active) return
  active = false
  if (lock === 'y') {
    if (dy.value > 110 || (vy > 0.6 && dy.value > 30)) close()
    dy.value = 0
  } else if (lock === 'x') {
    const d = artDx.value
    const flick = Math.abs(vx) > 0.45 && Math.sign(vx) === Math.sign(d)
    if (Math.abs(d) > artW * 0.28 || flick) commit(d < 0 ? 1 : -1)
    else animateTo(0, 260)
  } else if (zone === 'art') {
    const now = Date.now()
    if (now - lastTap < 320) {
      lastTap = 0
      void favorite(true)
    } else lastTap = now
  }
}

/* ---- карусель обложек: слева предыдущий трек, справа следующий ---- */
const GAP = 28
type Slots = [QueueItem | null, QueueItem | null, QueueItem | null]
const liveSlots = computed<Slots>(() => {
  const at = (j: number) => (j >= 0 && j !== player.index ? (player.queue[j] ?? null) : null)
  return [at(player.neighborIndex(-1)), item.value, at(player.neighborIndex(1))]
})
/** На время доезда после свайпа обложки не пересчитываются, иначе посреди анимации подменились бы */
const frozen = shallowRef<Slots | null>(null)
const slots = computed(() => frozen.value ?? liveSlots.value)
const slotKeys = computed(() =>
  slots.value.map((s, i) => (s ? (i === 0 && s.qid === slots.value[2]?.qid ? `${s.qid}#p` : s.qid) : `empty${i}`)),
)
const deck = ref<HTMLElement | null>(null)
const artDx = ref(0)
const artAnim = ref<string | null>(null)
let artW = 0
let animEnd = 0
let expect: string | null = null
let freezeTimer = 0
/** Насколько сдвинута лента, 0..1. artDx читается всегда: иначе при первом расчёте (artW ещё 0)
 * вычисление не подписывалось на сдвиг и соседние обложки навсегда оставались тусклыми */
const slide = computed(() => {
  const dx = Math.abs(artDx.value)
  return artW ? Math.min(1, dx / (artW + GAP)) : 0
})

const deckStyle = computed(() => ({ transform: `translateX(${artDx.value}px)`, transition: artAnim.value ?? 'none' }))
function slotStyle(i: number) {
  const p = slide.value
  const toward = (i === 2 && artDx.value < 0) || (i === 0 && artDx.value > 0)
  const s = i === 1 ? 1 - 0.12 * p : toward ? 0.88 + 0.12 * p : 0.88
  const o = i === 1 ? 1 - 0.45 * p : toward ? 0.55 + 0.45 * p : 0.55
  return {
    transform: `translateX(calc(${i - 1} * (100% + ${GAP}px))) scale(${s})`,
    opacity: o,
    transition: artAnim.value ?? 'none',
  }
}
function artOf(q: QueueItem) {
  return library.byKey.get(q.key)?.art ?? null
}

function animateTo(x: number, ms: number, ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)') {
  artAnim.value = `transform ${ms}ms ${ease}, opacity ${ms}ms ${ease}`
  artDx.value = x
  animEnd = performance.now() + ms
}

/** Свайп дотянули: соседняя обложка доезжает до центра, трек меняется */
function commit(dir: 1 | -1) {
  const target = slots.value[dir > 0 ? 2 : 0]
  if (!target) return animateTo(0, 260)
  haptic.tick()
  frozen.value = slots.value
  expect = target.qid
  animateTo(-dir * (artW + GAP), 240)
  clearTimeout(freezeTimer)
  freezeTimer = window.setTimeout(release, 2000)
  // Трек переключаем, когда обложка уже доехала: перерисовка плеера под новый трек тяжёлая,
  // и если начать её вместе с анимацией, обложка замирает, а потом прыгает
  afterSlide(deck.value, () => void player.step(dir))
}
function release() {
  clearTimeout(freezeTimer)
  const wait = animEnd - performance.now()
  if (wait > 0) {
    freezeTimer = window.setTimeout(release, wait + 16)
    return
  }
  expect = null
  artAnim.value = null
  frozen.value = null
  artDx.value = 0
}
onBeforeUnmount(() => clearTimeout(freezeTimer))

/**
 * Трек сменился не свайпом (кнопки, конец трека, кроссфейд): обложки всё равно едут в нужную сторону.
 * На кроссфейде медленно, в темпе перехода — вместе с цветом фона.
 */
watch(
  () => item.value?.qid,
  (q, old) => {
    if (!q || !old || !shown.value) return
    if (frozen.value) {
      if (q === expect) release()
      return
    }
    if (!deck.value || motionReduced()) return
    const n = player.queue.length
    const i = player.index
    const was = player.queue.findIndex((x) => x.qid === old)
    const dir = was < 0 ? 0 : (was + 1) % n === i ? 1 : (i + 1) % n === was ? -1 : 0
    if (!dir) {
      deck.value.querySelector('.slot.center')?.animate(
        [
          { opacity: 0, transform: 'scale(0.9)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      )
      return
    }
    artW = deck.value.offsetWidth
    const long = player.transitionMs > 0
    artAnim.value = null
    artDx.value = dir * (artW + GAP)
    void nextTick(() => {
      // Зафиксировать исходное положение, иначе браузер склеит оба изменения и анимации не будет
      void deck.value?.offsetWidth
      if (long) animateTo(0, Math.min(1400, Math.max(700, player.transitionMs * 0.35)), 'cubic-bezier(0.45, 0, 0.2, 1)')
      else animateTo(0, 340)
    })
  },
)

/* ---- кнопки ---- */
const heartPop = ref(false)
const shufflePop = ref(0)
const repeatPop = ref(false)
watch(
  () => item.value?.qid,
  () => {
    heartPop.value = false
    burst.value = 0
  },
)

async function favorite(fromDoubleTap = false) {
  const t = track.value
  if (!t) return
  if (fromDoubleTap && t.favoriteAt) {
    burst.value++
    haptic.tick()
    return
  }
  const on = await library.toggleFavorite(t.key)
  heartPop.value = on
  if (on) burst.value++
  haptic.success()
}

function toggleShuffle() {
  shufflePop.value++
  void player.toggleShuffle()
}
function cycleRepeat() {
  repeatPop.value = true
  void player.cycleRepeat()
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
 * Если плеер вытягивают пальцем, положением управляет sheetStyle.
 */
function onEnter(el: Element, done: () => void) {
  if (ui.playerDrag != null) return done()
  const root = el as HTMLElement
  const art = root.querySelector<HTMLElement>('.art')
  const from = document.querySelector<HTMLElement>('.mini .cv')?.getBoundingClientRect()
  if (!art || !from || !from.width || motionReduced()) {
    root.classList.add('slide-in')
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('slide-in')))
    setTimeout(done, 340)
    return
  }
  // Полёт считается от центра и с учётом того, где обложка окажется в конце: на паузе она уменьшена
  // (scale в CSS, от центра). Раньше полёт шёл от левого верхнего угла к масштабу 1, а в конце включался
  // масштаб паузы от центра — обложка садилась левее и выше и потом прыгала на место
  const to = art.getBoundingClientRect()
  const tf = getComputedStyle(art).transform
  const k = tf && tf !== 'none' ? new DOMMatrix(tf).a : 1
  const s = (from.width / to.width) * k
  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top + from.height / 2 - (to.top + to.height / 2)
  art.style.transition = 'none'
  art.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`
  root.style.transition = 'none'
  root.style.opacity = '0'
  void root.offsetWidth
  art.style.transition = 'transform 460ms cubic-bezier(0.16, 1, 0.3, 1)'
  art.style.transform = ''
  root.style.transition = 'opacity 240ms ease'
  root.style.opacity = '1'
  setTimeout(() => {
    art.style.transition = ''
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
      v-if="shown && item"
      class="full"
      :class="{ paused: !player.playing }"
      :style="sheetStyle"
      role="dialog"
      aria-label="Плеер"
    >
      <!-- Живой фон из красок обложки: пятна, сияние, стеклянные пузыри (PlayerAmbient) -->
      <PlayerAmbient :colors="colors" :art="track?.art" :playing="player.playing" />

      <div class="content" :class="{ 'lyrics-on': lyricsInline }" :style="{ '--art-size': artSize ? `${artSize}px` : undefined }">
        <header
          class="top"
          @pointerdown="down($event, 'top')"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
          @lostpointercapture.self="up"
        >
          <button type="button" class="icon-btn" aria-label="Свернуть" @pointerdown.stop @click="close"><IconDown /></button>
          <div class="src">
            <small>Играет из</small>
            <b class="ellipsis">{{ source }}</b>
          </div>
          <span class="top-r">
            <button
              v-if="sync.signedIn"
              type="button"
              class="icon-btn"
              :class="{ dev: remote.playingElsewhere.length > 0 }"
              aria-label="Устройства"
              @pointerdown.stop
              @click="ui.openSheet(DevicesSheet)"
            >
              <IconDevices />
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label="Сцена: только обложка на весь экран"
              title="Сцена: только обложка на весь экран"
              @pointerdown.stop
              @click="ui.zen = true"
            >
              <IconStage />
            </button>
            <button type="button" class="icon-btn" aria-label="Действия" @pointerdown.stop @click="more"><IconMore /></button>
          </span>
        </header>

        <div
          class="art-wrap"
          @pointerdown="down($event, 'art')"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
          @lostpointercapture.self="up"
        >
          <div ref="artEl" class="art">
            <div ref="deck" class="deck" :style="deckStyle">
              <template v-for="(s, i) in slots" :key="slotKeys[i]">
                <div v-if="s" class="slot" :class="{ center: i === 1 }" :style="slotStyle(i)">
                  <CoverArt :art="artOf(s)" :seed="s.title" :label="s.title" size="l" radius="var(--r-l)" />
                </div>
              </template>
            </div>
          </div>
          <!-- Убираем после анимации: оставшийся элемент проигрывал её заново при каждом открытии плеера -->
          <IconHeartOn v-if="burst" :key="burst" class="burst" aria-hidden="true" @animationend="burst = 0" />
        </div>

        <div class="info">
          <Transition name="title">
            <div :key="item.qid" class="names">
              <h2 class="display ellipsis">{{ item.title }}</h2>
              <p class="ellipsis">
                <TrackLinks v-if="track" :track="track" album />
                <template v-else
                  >{{ item.artist }}<template v-if="item.album"> · {{ item.album }}</template></template
                >
              </p>
            </div>
          </Transition>
          <button
            type="button"
            class="icon-btn heart"
            :class="{ on: track?.favoriteAt }"
            aria-label="Избранное"
            @click="favorite()"
          >
            <IconHeartOn v-if="track?.favoriteAt" key="on" :class="{ pop: heartPop }" />
            <IconHeart v-else key="off" />
          </button>
        </div>

        <div class="rate">
          <!-- key: у нового трека звёзды начинают с чистого листа, без следов жеста на прошлом -->
          <RatingStars :key="item.qid" :model-value="track?.rating ?? null" :size="26" @update:model-value="rate" />
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
            @click="toggleShuffle"
          >
            <IconShuffle :key="shufflePop" :class="{ pop: shufflePop > 0 }" />
          </button>
          <button type="button" class="icon-btn big-nav prev" aria-label="Предыдущий" @click="player.prev()"><IconPrev /></button>
          <button type="button" class="play" :aria-label="player.playing ? 'Пауза' : 'Играть'" @click="togglePlay">
            <Transition name="icon-swap">
              <IconPause v-if="player.playing" key="pause" />
              <IconPlay v-else key="play" />
            </Transition>
          </button>
          <button type="button" class="icon-btn big-nav next" aria-label="Следующий" @click="player.next()"><IconNext /></button>
          <button
            type="button"
            class="icon-btn small"
            :class="{ on: player.repeat !== 'off' }"
            aria-label="Повтор"
            @click="cycleRepeat"
          >
            <IconRepeatOne v-if="player.repeat === 'one'" key="one" :class="{ 'spin-pop': repeatPop }" />
            <IconRepeat v-else :key="player.repeat" :class="{ 'spin-pop': repeatPop }" />
          </button>
        </div>

        <!-- Компьютер: рядом с управлением — текущие строки текста и ближайшие треки очереди -->
        <NowExtras v-if="isDesktop" class="fx" :next="3" :open-lyrics="openLyrics" :lyrics-rev="lyricsMode" />

        <!-- Компьютер: текст песни на месте названия и кнопок, ростом с обложку -->
        <Transition name="lyrpane">
          <div v-if="lyricsInline" class="lyr-pane">
            <LyricsSheet inline @close="lyricsMode = false" />
          </div>
        </Transition>

        <div class="bottom">
          <button type="button" class="out" @click="ui.openSheet(OutputSheet)">
            <component :is="outIcon" /><span class="ellipsis">{{ outputLabel(player.output) }}</span>
          </button>
          <span class="tools">
            <!-- Звук: свои пресеты, скорость, тон, эффекты. Всегда на виду; подсвечена, когда звук изменён -->
            <button
              type="button"
              class="icon-btn"
              :class="{ on: soundOn }"
              aria-label="Звук: пресеты, скорость и эффекты"
              @click="ui.openSheet(SpeedSheet)"
            >
              <IconTune />
            </button>
            <!-- Телефон: текст и очередь. Компьютер: текст виден в панели справа, очередь — с панели плеера,
                 а здесь — действия с треком -->
            <button
              v-if="!isDesktop"
              type="button"
              class="icon-btn"
              :class="{ on: lyricsInline }"
              aria-label="Текст песни"
              :aria-pressed="lyricsInline"
              @click="openLyrics"
            >
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
            <button v-if="!isDesktop" type="button" class="icon-btn" aria-label="Очередь" @click="ui.queueOpen = true">
              <IconQueue />
            </button>
            <template v-else>
              <button
                type="button"
                class="icon-btn"
                aria-label="Метки и лучшие моменты"
                title="Метки и лучшие моменты"
                @click="ui.openSheet(BookmarksSheet, { trackKey: item.key, title: item.title })"
              >
                <IconMarks />
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label="В плейлист"
                title="В плейлист"
                @click="ui.openSheet(AddToPlaylistSheet, { keys: [item.key] })"
              >
                <IconAdd />
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label="Изменить теги"
                title="Изменить теги"
                @click="ui.openSheet(TagEditorSheet, { keys: [item.key] })"
              >
                <IconTags />
              </button>
              <button type="button" class="icon-btn" aria-label="Карточка трека" title="Карточка трека" @click="openCard">
                <IconCard />
              </button>
            </template>
            <!-- Компьютер: большой плеер закрывает панель с громкостью, поэтому громкость и здесь -->
            <span v-if="isDesktop" class="vol">
              <button
                type="button"
                class="icon-btn"
                :aria-label="volume > 0 ? 'Выключить звук' : 'Включить звук'"
                @click="toggleMute"
              >
                <IconMute v-if="volume === 0" /><IconVolume v-else />
              </button>
              <BarSlider class="volbar" :value="volume" label="Громкость" @input="setVolume" @change="setVolume" />
            </span>
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
.content {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: calc(var(--safe-top) + 4px) 22px calc(var(--safe-bottom) + 14px);
}
.top {
  display: grid;
  /* Края одной ширины: название источника остаётся ровно посередине */
  grid-template-columns: 120px 1fr 120px;
  align-items: center;
  gap: 8px;
  height: 52px;
  touch-action: none;
}
.top > .icon-btn {
  justify-self: start;
}
.top-r {
  display: flex;
  justify-content: flex-end;
}
.top-r .dev {
  color: var(--amber-ink);
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
/* Место под обложку: квадрат, по нему считаются размеры слотов карусели */
.art {
  position: relative;
  width: min(100%, 46vh);
  aspect-ratio: 1;
  transition: transform 520ms var(--ease-out);
}
/* На паузе обложка чуть отступает — видно, что музыка стоит */
.paused .art {
  transform: scale(0.93);
}
.deck {
  position: absolute;
  inset: 0;
  will-change: transform;
}
.slot {
  position: absolute;
  inset: 0;
  border-radius: var(--r-l);
  box-shadow: var(--shadow-cover);
  /* Своя слойка у каждой обложки: сдвиг и масштаб при смене трека — без перерисовки */
  will-change: transform, opacity;
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
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-top: 8px;
}
.names {
  flex: 1;
  min-width: 0;
}
/* Панель текста появляется на месте кнопок, кнопки уходят (desktop.css) */
.lyrpane-enter-active {
  transition:
    opacity 320ms var(--ease) 80ms,
    transform 420ms var(--ease-out) 80ms;
}
.lyrpane-leave-active {
  transition:
    opacity 200ms var(--ease),
    transform 260ms var(--ease);
}
.lyrpane-enter-from,
.lyrpane-leave-to {
  opacity: 0;
  transform: translateX(-14px);
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
/* Название нового трека проявляется поверх уходящего, без пустого места между ними */
.title-enter-active,
.title-leave-active {
  transition:
    opacity 260ms var(--ease),
    transform 320ms var(--ease-out);
}
.title-leave-active {
  position: absolute;
  left: 0;
  right: 52px;
  bottom: 0;
}
.title-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.title-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.names-enter-active,
.names-leave-active {
  transition:
    opacity 180ms var(--ease),
    transform 220ms var(--ease-out);
}
.names-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.names-leave-to {
  opacity: 0;
  transform: translateY(-6px);
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
.icon-btn.small {
  transition: color var(--t-mid) var(--ease);
}
.big-nav {
  width: 56px;
  height: 56px;
}
.big-nav svg {
  width: 32px;
  height: 32px;
}
/* Кнопки перехода «толкают» иконку в свою сторону */
.big-nav.prev:active svg {
  transform: translateX(-4px) scale(0.9);
}
.big-nav.next:active svg {
  transform: translateX(4px) scale(0.9);
}
.play {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--ink);
  color: var(--bg);
  transition:
    transform var(--t-fast) var(--ease),
    border-radius 320ms var(--ease-out);
}
.play:active {
  transform: scale(0.92);
}
/* На паузе кнопка чуть «квадратнее», как в системном плеере */
.paused .play {
  border-radius: 26px;
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
.vol {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 10px;
}
.volbar {
  width: 110px;
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
