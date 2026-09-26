<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import IconClose from '~icons/solar/close-circle-linear'
import IconSave from '~icons/solar/download-linear'
import IconPlay from '~icons/solar/play-bold'
import CoverArt from '@/components/CoverArt.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { buildRecap } from '@/data/repos/recap'
import { MusicCore } from '@/native/music-core'
import { coverSrc } from '@/native/paths'
import { buildSlides, renderSlide, type Slide } from './story'

/**
 * Итоги в виде историй: слайды на весь экран, тап справа — дальше, слева — назад,
 * удержание — пауза. Любой слайд можно сохранить картинкой 1080×1920.
 */
const props = defineProps<{ from: string; to: string; title: string }>()
const emit = defineEmits<{ close: [] }>()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()

const slides = shallowRef<Slide[]>([])
const i = ref(0)
const progress = ref(0)
const paused = ref(false)
const saving = ref(false)
const DURATION = 6500
let raf = 0
let last = 0

onMounted(async () => {
  const r = await buildRecap(props.from, props.to)
  slides.value = buildSlides(r, props.title, library.byKey)
  last = performance.now()
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

function tick(t: number) {
  const dt = t - last
  last = t
  if (!paused.value && slides.value.length) {
    progress.value += dt / DURATION
    if (progress.value >= 1) {
      if (i.value < slides.value.length - 1) {
        i.value++
        progress.value = 0
      } else progress.value = 1
    }
  }
  raf = requestAnimationFrame(tick)
}

const s = computed(() => slides.value[i.value])
function go(d: number) {
  const n = i.value + d
  if (n < 0) return
  if (n >= slides.value.length) return emit('close')
  i.value = n
  progress.value = 0
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
    const data = await renderSlide(slide, slide.cover ? coverSrc(slide.cover.art, 'l') : null, props.title)
    const name = `amber-${props.from.slice(0, 7)}-${i.value + 1}.png`
    await MusicCore.exportFile({ name, data, mime: 'image/png', base64: true })
    ui.toast('Картинка сохранена')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/cancel|отмен/i.test(msg)) ui.toast(`Не получилось: ${msg}`)
  } finally {
    saving.value = false
    paused.value = false
  }
}
function playTop() {
  const list = s.value?.list?.flatMap((x) => (x.track ? [x.track] : [])) ?? (s.value?.cover ? [s.value.cover] : [])
  if (list.length)
    void player.playTracks(
      list,
      0,
      { type: 'top', id: `recap-${props.from}`, title: `Итоги: ${props.title}` },
      { shuffle: false },
    )
}
</script>

<template>
  <div class="story" role="dialog" aria-label="Итоги">
    <div v-if="s" class="bg" :style="{ background: `linear-gradient(160deg, ${s.colors[0]}, ${s.colors[1]})` }" />
    <div class="sheen" aria-hidden="true" />
    <div class="bars">
      <i v-for="(_, n) in slides" :key="n"><b :style="{ transform: `scaleX(${n < i ? 1 : n === i ? progress : 0})` }" /></i>
    </div>
    <div class="top">
      <span class="brand display">Amber · {{ title }}</span>
      <button type="button" class="icon-btn light" aria-label="Закрыть" @click="emit('close')"><IconClose /></button>
    </div>
    <div class="stage" @pointerdown="down" @pointerup="up" @pointercancel="paused = false">
      <Transition name="slide" mode="out-in">
        <div v-if="s" :key="i" class="slide">
          <small class="kicker">{{ s.kicker }}</small>
          <CoverArt
            v-if="s.cover"
            :art="s.cover.art"
            :seed="s.cover.title"
            :label="s.cover.title"
            size="l"
            radius="22px"
            class="cover"
          />
          <h2 class="big display">{{ s.big }}</h2>
          <p v-if="s.title" class="stitle">{{ s.title }}</p>
          <p v-for="(l, n) in s.lines" :key="n" class="line">{{ l }}</p>
          <ol v-if="s.list" class="list">
            <li v-for="it in s.list" :key="it.n">
              <span class="n display">{{ it.n }}</span>
              <span class="t"
                ><b class="ellipsis">{{ it.title }}</b
                ><small v-if="it.sub" class="ellipsis">{{ it.sub }}</small></span
              >
              <span class="r">{{ it.right }}</span>
            </li>
          </ol>
        </div>
      </Transition>
    </div>
    <div class="actions">
      <button v-if="s?.list?.some((x) => x.track) || s?.cover" type="button" class="btn light" @click="playTop">
        <IconPlay />Слушать
      </button>
      <button type="button" class="btn light" :disabled="saving" @click="save">
        <IconSave />{{ saving ? 'Рисую…' : 'Картинкой' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.story {
  position: fixed;
  inset: 0;
  z-index: 60;
  color: #fff;
  background: #111;
  display: flex;
  flex-direction: column;
  padding: calc(var(--safe-top) + 8px) var(--gutter) calc(var(--safe-bottom) + 16px);
}
.bg {
  position: absolute;
  inset: 0;
  transition: background 600ms var(--ease);
}
.sheen {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    115deg,
    transparent 30%,
    rgba(255, 255, 255, 0.08) 45%,
    rgba(160, 230, 220, 0.08) 52%,
    transparent 65%
  );
  background-size: 250% 100%;
  animation: holo 9s linear infinite;
  pointer-events: none;
}
@keyframes holo {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -120% 0;
  }
}
.bars {
  position: relative;
  display: flex;
  gap: 4px;
}
.bars i {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.3);
  overflow: hidden;
}
.bars b {
  display: block;
  height: 100%;
  background: #fff;
  transform-origin: left;
}
.top {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
}
.brand {
  font-size: 13px;
  opacity: 0.85;
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
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.kicker {
  font: 600 13px/1 var(--f-body);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.75;
}
.cover {
  width: min(62vw, 38vh);
  align-self: center;
  margin: 10px 0;
  box-shadow: 0 24px 60px -18px rgba(0, 0, 0, 0.6);
}
.big {
  font-size: clamp(30px, 9vw, 46px);
  font-weight: 700;
  line-height: 1.1;
  text-wrap: balance;
}
.stitle {
  font-size: 18px;
  opacity: 0.85;
}
.line {
  font-size: 17px;
  line-height: 1.4;
  opacity: 0.92;
}
.list {
  list-style: none;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.list li {
  display: grid;
  grid-template-columns: 34px 1fr auto;
  gap: 10px;
  align-items: center;
}
.list .n {
  font-size: 22px;
  opacity: 0.6;
}
.list .t {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.list b {
  font-size: 17px;
  font-weight: 600;
}
.list small {
  opacity: 0.7;
  font-size: 13px;
}
.list .r {
  font-weight: 600;
  opacity: 0.85;
}
.actions {
  position: relative;
  display: flex;
  gap: 10px;
  justify-content: center;
}
.btn.light {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  backdrop-filter: blur(10px);
}
.slide-enter-active,
.slide-leave-active {
  transition:
    opacity 260ms var(--ease),
    transform 260ms var(--ease-out);
}
.slide-enter-from {
  opacity: 0;
  transform: translateY(16px);
}
.slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
