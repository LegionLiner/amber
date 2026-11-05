<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDuration } from '@/domain/format'
import { haptic } from '@/native/haptics'
import { $t } from '@/i18n'

/**
 * Полоса перемотки: ведёшь пальцем, видишь время, отпускаешь и попадаешь туда.
 * Если трек проанализирован, вместо полосы — его волна: видно тихое вступление, припевы и концовку.
 */
const props = defineProps<{
  position: number
  duration: number
  marks?: { at: number; best?: boolean }[]
  /** 1000 значений 0…255 из анализа */
  wave?: Uint8Array | null
  /** Повтор отрезка: A и, если уже поставлена, B */
  ab?: { start: number; end: number | null } | null
}>()
const emit = defineEmits<{ seek: [ms: number] }>()

const BARS = 72
const el = ref<HTMLElement | null>(null)
const scrub = ref<number | null>(null)

const frac = computed(() => {
  if (scrub.value != null) return scrub.value
  return props.duration > 0 ? Math.min(1, props.position / props.duration) : 0
})
const shownPos = computed(() => frac.value * props.duration)

/**
 * Столбики волны. В данных амплитуда сжата корнем, а громко сведённый трек и так почти ровный — столбики
 * выходили одной высоты. Поэтому возвращаем энергию (квадрат), растягиваем её между тихими местами трека
 * (15-й процентиль) и самым громким и чуть подчёркиваем разницу: тихое вступление, куплет, припев и проигрыш видны сразу
 */
const bars = computed(() => {
  const w = props.wave
  if (!w || !w.length) return null
  const raw: number[] = []
  for (let i = 0; i < BARS; i++) {
    const from = Math.floor((i * w.length) / BARS)
    const to = Math.max(from + 1, Math.floor(((i + 1) * w.length) / BARS))
    let m = 0
    for (let j = from; j < Math.min(to, w.length); j++) if (w[j]! > m) m = w[j]!
    raw.push((m / 255) ** 2)
  }
  const sorted = [...raw].sort((a, b) => a - b)
  const lo = sorted[Math.floor(sorted.length * 0.15)]!
  const hi = sorted[sorted.length - 1]!
  // Совсем ровный звук (тон, белый шум) — просто средняя высота
  if (hi - lo < 0.02) return raw.map(() => 0.6)
  // Шкала — от самого громкого места вниз, но не уже 0,3: у плотно сведённого трека (громкость гуляет
  // в пределах 10%) столбики остаются высокими и спокойными, а не превращаются в «пилу» из мелких колебаний
  const span = Math.max(hi - lo, 0.3)
  return raw.map((v) => 0.1 + 0.9 * Math.min(1, Math.max(0, 1 - (hi - v) / span)) ** 1.3)
})

const abStyle = computed(() => {
  const ab = props.ab
  if (!ab || props.duration <= 0) return null
  const a = (ab.start / props.duration) * 100
  const b = ab.end != null ? (ab.end / props.duration) * 100 : a
  return { left: `${a}%`, width: `${Math.max(0.6, b - a)}%` }
})

function fracAt(x: number) {
  const r = el.value!.getBoundingClientRect()
  return Math.min(1, Math.max(0, (x - r.left) / r.width))
}
function down(e: PointerEvent) {
  el.value!.setPointerCapture(e.pointerId)
  scrub.value = fracAt(e.clientX)
  haptic.tick()
}
function move(e: PointerEvent) {
  if (scrub.value != null) scrub.value = fracAt(e.clientX)
}
function up() {
  if (scrub.value == null) return
  emit('seek', scrub.value * props.duration)
  scrub.value = null
}
</script>

<template>
  <div class="seek">
    <div
      ref="el"
      class="track"
      :class="{ active: scrub != null, waved: !!bars }"
      role="slider"
      :aria-label="$t('Перемотка')"
      :aria-valuenow="Math.round(shownPos / 1000)"
      :aria-valuemax="Math.round(duration / 1000)"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="scrub = null"
      @lostpointercapture.self="up"
    >
      <i v-if="abStyle" class="ab" :class="{ open: ab?.end == null }" :style="abStyle" />
      <template v-if="bars">
        <div class="wave dim" aria-hidden="true">
          <i v-for="(h, i) in bars" :key="i" :style="{ height: `${h * 100}%` }" />
        </div>
        <div class="wave lit" aria-hidden="true" :style="{ clipPath: `inset(0 ${(1 - frac) * 100}% 0 0)` }">
          <i v-for="(h, i) in bars" :key="i" :style="{ height: `${h * 100}%` }" />
        </div>
      </template>
      <div v-else class="bar">
        <i class="fill" :style="{ transform: `scaleX(${frac})` }" />
      </div>
      <i
        v-for="(m, i) in marks ?? []"
        :key="i"
        class="mark"
        :class="{ best: m.best }"
        :style="{ left: `${duration > 0 ? (m.at / duration) * 100 : 0}%` }"
      />
      <b class="thumb" :style="{ left: `${frac * 100}%` }" />
    </div>
    <div class="times num">
      <span>{{ formatDuration(shownPos) }}</span>
      <span>−{{ formatDuration(Math.max(0, duration - shownPos)) }}</span>
    </div>
  </div>
</template>

<style scoped>
.track {
  position: relative;
  height: 32px;
  display: flex;
  align-items: center;
  touch-action: none;
  cursor: pointer;
}
.track.waved {
  height: 48px;
}
.bar {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--line-strong);
  overflow: hidden;
  transition: height var(--t-fast) var(--ease);
}
.active .bar {
  height: 8px;
  border-radius: 4px;
}
.fill {
  position: absolute;
  inset: 0;
  transform-origin: left;
  background: linear-gradient(90deg, var(--amber), var(--ember));
}
.wave {
  position: absolute;
  inset: 4px 0;
  display: flex;
  align-items: center;
  gap: 2px;
}
.wave i {
  flex: 1;
  min-height: 3px;
  border-radius: 2px;
}
/* Непройденная часть — заметно, но спокойнее пройденной */
.wave.dim i {
  background: color-mix(in srgb, var(--ink) 24%, transparent);
}
.wave.lit i {
  background: linear-gradient(180deg, var(--amber), var(--ember));
}
.active .wave {
  inset: 0;
}
.ab {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 6px;
  background: rgba(var(--amber-rgb), 0.16);
  border-left: 2px solid var(--amber);
  border-right: 2px solid var(--amber);
  pointer-events: none;
}
.ab.open {
  border-right: 0;
}
.mark {
  position: absolute;
  top: 50%;
  width: 3px;
  height: 14px;
  margin: -7px 0 0 -1.5px;
  border-radius: 2px;
  background: var(--ink);
  opacity: 0.75;
  pointer-events: none;
}
.waved .mark {
  top: auto;
  bottom: -4px;
  height: 6px;
  margin-top: 0;
}
.mark.best {
  background: var(--amber);
  opacity: 1;
}
.thumb {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  background: var(--ink);
  box-shadow: 0 0 0 4px rgba(var(--amber-rgb), 0.22);
  transition: transform var(--t-fast) var(--ease);
}
.waved .thumb {
  width: 3px;
  height: 100%;
  top: 0;
  margin: 0 0 0 -1.5px;
  border-radius: 2px;
  box-shadow: none;
}
.active .thumb {
  transform: scale(1.3);
}
.waved.active .thumb {
  transform: scaleX(1.6);
}
.times {
  display: flex;
  justify-content: space-between;
  font: 500 12px/1 var(--f-body);
  color: var(--ink-2);
  margin-top: 2px;
}
</style>
