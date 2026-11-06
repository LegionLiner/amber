<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import IconClose from '~icons/solar/close-circle-linear'
import IconSave from '~icons/solar/download-linear'
import IconPlay from '~icons/solar/play-bold'
import CoverArt from '@/components/CoverArt.vue'
import CountUp from './CountUp.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { buildRecap } from '@/data/repos/recap'
import { MusicCore } from '@/native/music-core'
import { coverSrc } from '@/native/paths'
import { coverGlow } from '@/app/cover-colors'
import { buildSlides, renderSlide, slideTones, type Slide, type SlideTones } from './story'
import { $t } from '@/i18n'
import { isDesktop } from '@/native/desktop/bridge'

/**
 * Итоги в виде историй: слайды на весь экран, тап справа — дальше, слева — назад, удержание — пауза.
 * Каждый слайд — в цветах обложки своего трека, фон живой (световые пятна плывут), краски перетекают
 * от слайда к слайду. Содержимое появляется по очереди: числа досчитываются, строки въезжают, столбики растут.
 * Любой слайд можно сохранить картинкой 1080×1920 — она рисуется так же (story.ts → renderSlide).
 */
const props = defineProps<{ from: string; to: string; title: string }>()
const emit = defineEmits<{ close: [] }>()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()

const slides = shallowRef<Slide[]>([])
/** Краски слайдов: сразу — запасные, через мгновение — по картинкам обложек */
const tones = shallowRef<SlideTones[]>([])
const i = ref(0)
const paused = ref(false)
const saving = ref(false)
/**
 * Сколько показывается слайд. Время идёт CSS-анимацией полоски сверху (на паузе — стоит): раньше прогресс
 * считался каждый кадр в Vue, и весь слайд с обложками перерисовывался 60 раз в секунду — на телефоне лагало
 */
const DURATION = 7000

onMounted(async () => {
  const r = await buildRecap(props.from, props.to)
  const list = buildSlides(r, props.title, library.byKey)
  tones.value = list.map((s) => slideTones(s.colors))
  slides.value = list
  // Цвета обложек: каждая разбирается один раз (и кэшируется), слайды перекрашиваются по мере готовности
  list.forEach((s, n) => {
    const art = s.accent?.art
    if (!art) return
    void coverGlow(art).then((g) => {
      if (!g) return
      const next = [...tones.value]
      next[n] = slideTones(g)
      tones.value = next
    })
  })
})
/** Полоска текущего слайда дошла до конца — следующий (последний остаётся на экране) */
function timeUp() {
  if (i.value < slides.value.length - 1) i.value++
}

const s = computed(() => slides.value[i.value])
const tone = computed(() => tones.value[i.value] ?? slideTones(['#8a5a1c', '#2a160a']))
const vars = computed(() => ({
  '--bg1': tone.value.bg1,
  '--bg2': tone.value.bg2,
  '--g1': tone.value.g1,
  '--g2': tone.value.g2,
}))

/** Пьедестал: первые три места — с обложками */
const podium = computed(() => {
  const l = s.value?.list
  return l && l.length >= 3 ? l.slice(0, 3) : null
})
const rows = computed(() => (podium.value ? (s.value?.list?.slice(3) ?? []) : (s.value?.list ?? [])))
const hourMax = computed(() => Math.max(1, ...(s.value?.hours ?? [0])))
const peakHour = computed(() => s.value?.hours?.indexOf(hourMax.value) ?? -1)
/** Веер открытий: главное — посередине, ещё два — по бокам */
const fan = computed(() => {
  const sl = s.value
  if (!sl?.cover) return []
  const others = (sl.collage ?? []).filter((t) => t.key !== sl.cover!.key).slice(0, 2)
  return others
})

function go(d: number) {
  const n = i.value + d
  if (n < 0) return
  if (n >= slides.value.length) return emit('close')
  i.value = n
}
let downAt = 0
function down() {
  downAt = Date.now()
  paused.value = true
}
function up(e: PointerEvent) {
  paused.value = false
  if (Date.now() - downAt > 300) return
  const x = e.clientX / window.innerWidth
  go(x < 0.33 ? -1 : 1)
}

async function save() {
  const slide = s.value
  if (!slide) return
  saving.value = true
  paused.value = true
  try {
    const data = await renderSlide(slide, tone.value, (t) => coverSrc(t.art, 'l'), props.title)
    const name = `amber-${props.from.slice(0, 7)}-${i.value + 1}.png`
    await MusicCore.exportFile({ name, data, mime: 'image/png', base64: true })
    ui.toast($t('Картинка сохранена'))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/cancel|отмен/i.test(msg)) ui.toast($t('Не получилось: {0}', msg))
  } finally {
    saving.value = false
    paused.value = false
  }
}
function playTop() {
  const sl = s.value
  const list = sl?.list?.flatMap((x) => (x.track ? [x.track] : [])) ?? sl?.collage ?? (sl?.cover ? [sl.cover] : [])
  if (list?.length)
    void player.playTracks(
      list,
      0,
      { type: 'top', id: `recap-${props.from}`, title: $t('Итоги: {0}', props.title) },
      { shuffle: false },
    )
}
</script>

<template>
  <div class="story" :class="{ paused }" :style="{ ...vars, '--dur': `${DURATION}ms` }" role="dialog" :aria-label="$t('Итоги')">
    <!-- Живой фон: основа в цветах обложки и три световых пятна, которые медленно плывут -->
    <div class="bg" aria-hidden="true">
      <i class="blob b1" />
      <i class="blob b2" />
      <i v-if="isDesktop" class="blob b3" />
      <i v-if="isDesktop" class="grain" />
    </div>
    <div class="bars">
      <i v-for="(_, n) in slides" :key="n"
        ><b v-if="n < i" class="done" /><b v-else-if="n === i" :key="i" class="run" @animationend="timeUp"
      /></i>
    </div>
    <div class="top">
      <span class="brand">Amber · {{ title }}</span>
      <button type="button" class="icon-btn light" :aria-label="$t('Закрыть')" @click="emit('close')"><IconClose /></button>
    </div>
    <div class="stage" @pointerdown="down" @pointerup="up" @pointercancel="paused = false">
      <Transition name="slide" mode="out-in">
        <div v-if="s" :key="i" class="slide" :class="s.kind">
          <!-- Стена обложек периода -->
          <div v-if="s.kind === 'intro' && s.collage?.length" class="wall" aria-hidden="true">
            <div v-for="(t, n) in s.collage.slice(0, 12)" :key="t.key" class="tile" :style="{ '--d': n }">
              <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="m" radius="14px" />
            </div>
          </div>

          <!-- Обложка трека или веер открытий -->
          <div v-if="(s.kind === 'track' || s.kind === 'discover') && s.cover" class="hero" :class="{ fanned: fan.length }">
            <div v-for="(t, n) in fan" :key="t.key" class="side" :class="n ? 'r' : 'l'">
              <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="m" radius="18px" />
            </div>
            <CoverArt :art="s.cover.art" :seed="s.cover.title" :label="s.cover.title" size="l" radius="24px" class="main" />
          </div>

          <div class="text">
            <small class="kicker anim" style="--d: 0">{{ s.kicker }}</small>
            <h2 class="big display anim" style="--d: 1">
              <CountUp v-if="s.kind === 'stat' || s.kind === 'when' || s.kind === 'discover'" :text="s.big" />
              <template v-else>{{ s.big }}</template>
            </h2>
            <p v-if="s.title" class="stitle anim" style="--d: 2">{{ s.title }}</p>
            <p v-for="(l, n) in s.lines" :key="n" class="line anim" :style="{ '--d': 3 + n }">{{ l }}</p>
          </div>

          <!-- Часы суток -->
          <div v-if="s.kind === 'when' && s.hours" class="hours" aria-hidden="true">
            <div class="cols">
              <i
                v-for="(v, h) in s.hours"
                :key="h"
                :class="{ peak: h === peakHour }"
                :style="{ '--h': `${Math.max(3, (v / hourMax) * 100)}%`, '--d': h }"
              />
            </div>
            <div class="axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
          </div>

          <!-- Пьедестал и список -->
          <template v-if="s.list">
            <div v-if="podium" class="podium">
              <div v-for="n in [1, 0, 2]" :key="n" class="place" :class="`p${n}`" :style="{ '--d': n }">
                <CoverArt
                  :art="podium[n]!.track?.art ?? null"
                  :seed="podium[n]!.track?.title ?? podium[n]!.title"
                  :label="podium[n]!.title"
                  size="m"
                  radius="16px"
                />
                <b class="rank display">{{ n + 1 }}</b>
                <span class="pt ellipsis">{{ podium[n]!.title }}</span>
                <small class="pr">{{ podium[n]!.right }}</small>
              </div>
            </div>
            <ol class="list" :class="{ long: rows.length > 5 }">
              <li v-for="(it, n) in rows" :key="it.n" class="anim" :style="{ '--d': 4 + n }">
                <span class="n display">{{ it.n }}</span>
                <!-- Нет трека или картинки — буква и цвет, как у обложек в медиатеке -->
                <CoverArt
                  :art="it.track?.art ?? null"
                  :seed="it.track?.title ?? it.title"
                  :label="it.title"
                  size="s"
                  radius="8px"
                  class="th"
                />
                <span class="t"
                  ><b class="ellipsis">{{ it.title }}</b
                  ><small v-if="it.sub" class="ellipsis">{{ it.sub }}</small></span
                >
                <span class="r">{{ it.right }}</span>
              </li>
            </ol>
          </template>
        </div>
      </Transition>
    </div>
    <div class="actions">
      <button
        v-if="s?.list?.some((x) => x.track) || s?.cover || s?.collage?.length"
        type="button"
        class="btn light"
        @click="playTop"
      >
        <IconPlay />{{ $t('Слушать') }}
      </button>
      <button type="button" class="btn light" :disabled="saving" @click="save">
        <IconSave />{{ saving ? $t('Рисую…') : $t('Картинкой') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Краски перетекают между слайдами: переменные — цвета, а не строки */
@property --bg1 {
  syntax: '<color>';
  inherits: true;
  initial-value: #3a2410;
}
@property --bg2 {
  syntax: '<color>';
  inherits: true;
  initial-value: #120a05;
}
@property --g1 {
  syntax: '<color>';
  inherits: true;
  initial-value: #e09a40;
}
@property --g2 {
  syntax: '<color>';
  inherits: true;
  initial-value: #b0502a;
}
.story {
  position: fixed;
  inset: 0;
  z-index: 60;
  color: #fff;
  background: #111;
  display: flex;
  flex-direction: column;
  padding: calc(var(--safe-top) + 8px) var(--gutter) calc(var(--safe-bottom) + 16px);
  overflow: hidden;
  transition:
    --bg1 0.8s ease,
    --bg2 0.8s ease,
    --g1 0.8s ease,
    --g2 0.8s ease;
}

/* ---------- живой фон ---------- */
.bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(165deg, var(--bg1), var(--bg2) 85%);
  overflow: hidden;
}
/* Пятна — просто прозрачные градиенты, без смешивания слоёв (mix-blend на огромных слоях тормозил телефон) */
.blob {
  position: absolute;
  width: 85vmax;
  aspect-ratio: 1;
  border-radius: 50%;
  opacity: 0.45;
  will-change: transform;
  contain: strict;
}
.b1 {
  left: -45vmax;
  top: -45vmax;
  background: radial-gradient(circle, var(--g1) 0, transparent 62%);
  animation: drift1 19s ease-in-out infinite alternate;
}
.b2 {
  right: -50vmax;
  top: 10vmax;
  background: radial-gradient(circle, var(--g2) 0, transparent 60%);
  opacity: 0.4;
  animation: drift2 23s ease-in-out infinite alternate;
}
.b3 {
  left: -20vmax;
  bottom: -60vmax;
  background: radial-gradient(circle, var(--g1) 0, transparent 58%);
  opacity: 0.3;
  animation: drift3 27s ease-in-out infinite alternate;
}
@keyframes drift1 {
  to {
    transform: translate(22vmax, 18vmax) scale(1.15);
  }
}
@keyframes drift2 {
  to {
    transform: translate(-26vmax, 16vmax) scale(0.9);
  }
}
@keyframes drift3 {
  to {
    transform: translate(18vmax, -24vmax) scale(1.2);
  }
}
.grain {
  position: absolute;
  inset: 0;
  opacity: 0.08;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}
.paused .blob,
.paused .tile,
.paused .anim {
  animation-play-state: paused;
}

/* ---------- рамка ---------- */
.bars {
  position: relative;
  display: flex;
  gap: 4px;
}
.bars i {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.28);
  overflow: hidden;
}
.bars b {
  display: block;
  height: 100%;
  background: #fff;
  transform-origin: left;
}
.bars b.run {
  transform: scaleX(0);
  animation: fill var(--dur) linear forwards;
}
.paused .bars b.run {
  animation-play-state: paused;
}
@keyframes fill {
  to {
    transform: scaleX(1);
  }
}
.top {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
}
.brand {
  font: 600 12px/1 var(--f-body);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.75;
}
.icon-btn.light {
  color: #fff;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  touch-action: none;
  user-select: none;
}
.slide {
  width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ---------- текст ---------- */
.text {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.kicker {
  font: 600 12.5px/1 var(--f-body);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  opacity: 0.72;
}
.big {
  font-size: clamp(32px, 10vw, 52px);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.035em;
  text-wrap: balance;
  font-variant-numeric: tabular-nums;
}
/* Крупное число — главное на слайде */
.stat .big,
.when .big {
  font-size: clamp(64px, 23vw, 128px);
  line-height: 0.95;
  letter-spacing: -0.05em;
}
.intro .big {
  font-size: clamp(40px, 13vw, 72px);
}
.stitle {
  font-size: 19px;
  font-weight: 500;
  opacity: 0.85;
}
.line {
  font-size: 16.5px;
  line-height: 1.4;
  opacity: 0.9;
}
.stat .line:first-of-type {
  margin-top: 6px;
}

/* Появление по очереди */
.anim {
  opacity: 0;
  animation: rise 0.7s cubic-bezier(0.2, 0.75, 0.2, 1) forwards;
  animation-delay: calc(var(--d, 0) * 70ms + 120ms);
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* ---------- стена обложек ---------- */
.wall {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  /* Повёрнутая стена шире и выше себя: запас снизу, чтобы не наезжала на подпись */
  margin: 0 -8px 36px;
  transform: rotate(-6deg) scale(1.04);
}
.tile {
  opacity: 0;
  animation: pop 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  animation-delay: calc(var(--d) * 55ms);
  box-shadow: 0 14px 30px -14px rgba(0, 0, 0, 0.6);
  border-radius: 14px;
}
.tile :deep(*) {
  width: 100%;
}
@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.82) translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* ---------- обложка и веер ---------- */
.hero {
  position: relative;
  align-self: center;
  width: min(66vw, 36vh);
  aspect-ratio: 1;
  margin: 6px 0 4px;
}
.hero .main {
  position: relative;
  width: 100%;
  height: 100%;
  box-shadow: 0 30px 70px -20px rgba(0, 0, 0, 0.65);
  animation: cover 1s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes cover {
  from {
    opacity: 0;
    transform: scale(0.86) rotate(-3deg);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.side {
  position: absolute;
  top: 14%;
  width: 72%;
  aspect-ratio: 1;
  opacity: 0;
  box-shadow: 0 20px 40px -18px rgba(0, 0, 0, 0.6);
  border-radius: 18px;
}
.side :deep(*) {
  width: 100%;
  height: 100%;
}
.side.l {
  left: -30%;
  animation: fanL 1s 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}
.side.r {
  right: -30%;
  animation: fanR 1s 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}
@keyframes fanL {
  from {
    opacity: 0;
    transform: translateX(30%) rotate(0);
  }
  to {
    opacity: 0.85;
    transform: rotate(-12deg);
  }
}
@keyframes fanR {
  from {
    opacity: 0;
    transform: translateX(-30%) rotate(0);
  }
  to {
    opacity: 0.85;
    transform: rotate(12deg);
  }
}

/* ---------- часы суток ---------- */
.hours {
  margin-top: 6px;
}
.cols {
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  align-items: end;
  gap: 3px;
  height: 140px;
}
.cols i {
  display: block;
  height: var(--h);
  border-radius: 4px 4px 2px 2px;
  background: rgba(255, 255, 255, 0.38);
  transform-origin: bottom;
  transform: scaleY(0);
  animation: grow 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  animation-delay: calc(var(--d) * 25ms + 300ms);
}
.cols i.peak {
  background: #fff;
  box-shadow: 0 0 22px rgba(255, 255, 255, 0.45);
}
@keyframes grow {
  to {
    transform: scaleY(1);
  }
}
.axis {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.6;
}

/* ---------- пьедестал ---------- */
.podium {
  display: grid;
  grid-template-columns: 1fr 1.3fr 1fr;
  align-items: end;
  gap: 12px;
}
.place {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  opacity: 0;
  animation: rise 0.8s cubic-bezier(0.2, 0.75, 0.2, 1) forwards;
  animation-delay: calc(var(--d) * 110ms + 250ms);
}
.place :deep(.cover),
.place > :first-child {
  width: 100%;
  box-shadow: 0 18px 36px -16px rgba(0, 0, 0, 0.6);
}
.place.p0 {
  margin-bottom: 14px;
}
.rank {
  position: absolute;
  left: 8px;
  top: 6px;
  font-size: 22px;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
}
.p0 .rank {
  font-size: 30px;
}
.pt {
  font-size: 13px;
  font-weight: 600;
}
.pr {
  font-size: 11.5px;
  opacity: 0.75;
}

/* ---------- список ---------- */
.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.list li {
  display: grid;
  grid-template-columns: 26px 38px 1fr auto;
  gap: 10px;
  align-items: center;
}
.list .n {
  font-size: 17px;
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}
.list .th {
  width: 38px;
  height: 38px;
  box-shadow: 0 6px 14px -6px rgba(0, 0, 0, 0.5);
}
.list .t {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.list b {
  font-size: 15.5px;
  font-weight: 600;
}
.list small {
  opacity: 0.7;
  font-size: 12.5px;
}
.list .r {
  font-weight: 600;
  font-size: 14px;
  opacity: 0.85;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.list.long {
  gap: 7px;
}
.list.long .th {
  width: 32px;
  height: 32px;
}
.list.long li {
  grid-template-columns: 24px 32px 1fr auto;
}

/* ---------- кнопки ---------- */
.actions {
  position: relative;
  display: flex;
  gap: 10px;
  justify-content: center;
}
.btn.light {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.slide-enter-active {
  transition: opacity 280ms var(--ease);
}
.slide-leave-active {
  transition:
    opacity 200ms var(--ease),
    transform 200ms var(--ease);
}
.slide-enter-from {
  opacity: 0;
}
.slide-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

/* Компьютер: история — вертикальной картой посередине, как на телефоне */
:root.desktop .story {
  padding-left: max(var(--gutter), calc(50vw - 230px));
  padding-right: max(var(--gutter), calc(50vw - 230px));
}
/* Без лишнего движения: только смена слайдов */
@media (prefers-reduced-motion: reduce) {
  .blob,
  .tile,
  .anim,
  .place,
  .cols i,
  .hero .main,
  .side {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
</style>
