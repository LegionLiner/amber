<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { coverAccents, paletteOf, type Glow } from '@/app/cover-colors'

/**
 * Живой фон большого плеера из красок обложки — «жидкое стекло»:
 *  - пять мягких пятен (две основные краски обложки, её акценты) плывут по своим медленным петлям;
 *  - поверх — «сияние»: широкий конический перелив тех же красок, едва заметно поворачивается;
 *  - редкий проход света по стеклу и мелкое зерно — фон читается как матовое стекло, а не как заливка.
 * Никаких предметов на фоне — только свет и цвет.
 *
 * Всё движение — только transform и opacity: это делает видеокарта, без перерисовки и без filter: blur
 * (размытие при смене трека подвешивало интерфейс на полсекунды). Пятна — радиальные градиенты с мягким краем.
 * На паузе фон замирает, при «меньше движения» и при выключенном стекле — неподвижен.
 * Новый трек проявляет свои краски поверх старых.
 */
const props = defineProps<{ colors: Glow; art?: string | null; playing: boolean }>()

const accents = ref<string[]>([])
let token = 0
watch(
  () => props.art,
  async (art) => {
    const t = ++token
    const a = art ? await coverAccents(art).catch(() => []) : []
    if (t === token) accents.value = a
  },
  { immediate: true },
)

const palette = computed(() => paletteOf(props.colors, accents.value))
const vars = computed(() => Object.fromEntries(palette.value.map((c, i) => [`--p${i}`, c])))
</script>

<template>
  <div class="ambient" :class="{ paused: !playing }" aria-hidden="true">
    <Transition name="amb">
      <div :key="palette.join()" class="amb" :style="vars">
        <i class="blob b0" /><i class="blob b1" /><i class="blob b2" /><i class="blob b3" /><i class="blob b4" />
        <i class="aurora" />
      </div>
    </Transition>
    <i class="sheen" />
    <i class="grain" />
    <div class="veil" />
  </div>
</template>

<style scoped>
.ambient {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.amb {
  position: absolute;
  inset: 0;
}
.amb-enter-active,
.amb-leave-active {
  transition: opacity 1400ms var(--ease);
}
.amb-enter-from,
.amb-leave-to {
  opacity: 0;
}
/* На паузе всё замирает на месте, а не прыгает в начало */
.paused :is(.blob, .aurora, .sheen) {
  animation-play-state: paused;
}

/* ---- пятна: плотная середина, мягкий край, как размытый круг ---- */
.blob {
  position: absolute;
  border-radius: 50%;
  --c: var(--p0);
  background: radial-gradient(closest-side, var(--c) 22%, color-mix(in srgb, var(--c) 48%, transparent) 64%, transparent);
  will-change: transform;
}
.b0 {
  width: 125vmax;
  height: 125vmax;
  left: -55vmax;
  top: -50vmax;
  opacity: 0.95;
  animation: loop-a 26s ease-in-out infinite alternate;
}
.b1 {
  --c: var(--p1);
  width: 105vmax;
  height: 105vmax;
  right: -52vmax;
  top: -10vmax;
  opacity: 0.8;
  animation: loop-b 31s ease-in-out infinite alternate;
}
.b2 {
  --c: var(--p2);
  width: 80vmax;
  height: 80vmax;
  left: -10vmax;
  top: 10vmax;
  opacity: 0.6;
  animation: loop-c 23s ease-in-out infinite alternate-reverse;
}
.b3 {
  --c: var(--p3);
  width: 90vmax;
  height: 90vmax;
  right: -30vmax;
  bottom: -55vmax;
  opacity: 0.55;
  animation: loop-a 37s ease-in-out infinite alternate-reverse;
}
.b4 {
  --c: var(--p4);
  width: 70vmax;
  height: 70vmax;
  left: -30vmax;
  bottom: -40vmax;
  opacity: 0.5;
  animation: loop-b 29s ease-in-out infinite alternate;
}
@keyframes loop-a {
  0% {
    transform: translate(0, 0) scale(1) rotate(0deg);
  }
  33% {
    transform: translate(16vmax, 8vmax) scale(1.1) rotate(10deg);
  }
  66% {
    transform: translate(6vmax, 20vmax) scale(0.95) rotate(-6deg);
  }
  100% {
    transform: translate(24vmax, 12vmax) scale(1.18) rotate(4deg);
  }
}
@keyframes loop-b {
  0% {
    transform: translate(0, 0) scale(1);
  }
  40% {
    transform: translate(-18vmax, 10vmax) scale(0.9);
  }
  75% {
    transform: translate(-8vmax, 26vmax) scale(1.12);
  }
  100% {
    transform: translate(-26vmax, 6vmax) scale(1.04);
  }
}
@keyframes loop-c {
  0% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(22vmax, -14vmax) scale(1.2);
  }
  100% {
    transform: translate(8vmax, 10vmax) scale(0.92);
  }
}

/* ---- сияние: конический перелив красок, середина и края растворены ---- */
.aurora {
  position: absolute;
  width: 150vmax;
  height: 150vmax;
  left: calc(50% - 75vmax);
  top: calc(38% - 75vmax);
  border-radius: 50%;
  background: conic-gradient(from 0deg, var(--p0), var(--p2), var(--p1), var(--p3), var(--p4), var(--p0));
  -webkit-mask: radial-gradient(closest-side, transparent 8%, #000 34%, rgba(0, 0, 0, 0.5) 58%, transparent 74%);
  mask: radial-gradient(closest-side, transparent 8%, #000 34%, rgba(0, 0, 0, 0.5) 58%, transparent 74%);
  opacity: 0.42;
  mix-blend-mode: soft-light;
  will-change: transform;
  animation: swirl 90s linear infinite;
}
@keyframes swirl {
  to {
    transform: rotate(360deg);
  }
}

/* ---- проход света по стеклу: раз в 20 секунд, едва заметно ---- */
.sheen {
  position: absolute;
  inset: -20% -60%;
  background: linear-gradient(
    105deg,
    transparent 42%,
    rgba(255, 255, 255, 0.05) 48%,
    rgba(255, 255, 255, 0.09) 50%,
    rgba(255, 255, 255, 0.05) 52%,
    transparent 58%
  );
  will-change: transform;
  animation: sheen 20s ease-in-out infinite;
}
@keyframes sheen {
  0%,
  62% {
    transform: translateX(-60%);
  }
  100% {
    transform: translateX(60%);
  }
}

/* ---- зерно: матовое стекло, а не гладкая заливка ---- */
.grain {
  position: absolute;
  inset: 0;
  opacity: 0.06;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  pointer-events: none;
}

/* Затемнение к низу: под управлением текст читается на любой обложке */
.veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg) 10%, transparent) 0%,
    color-mix(in srgb, var(--bg) 25%, transparent) 40%,
    color-mix(in srgb, var(--bg) 70%, transparent) 68%,
    var(--bg) 94%
  );
}

/* ---- светлая тема: краски «умножаются» на фон ---- */
[data-theme='light'] .blob {
  mix-blend-mode: multiply;
}
[data-theme='light'] .b0 {
  opacity: 0.6;
}
[data-theme='light'] .b1 {
  opacity: 0.5;
}
[data-theme='light'] :is(.b2, .b3, .b4) {
  opacity: 0.35;
}
[data-theme='light'] .aurora {
  mix-blend-mode: multiply;
  opacity: 0.18;
}
[data-theme='light'] .grain {
  filter: invert(1);
  opacity: 0.05;
}

/* ---- меньше движения или стекло выключено: неподвижный фон ---- */
[data-motion='reduced'] :is(.blob, .aurora, .sheen),
[data-glass='low'] :is(.blob, .aurora, .sheen) {
  animation: none;
}
[data-motion='reduced'] .sheen,
[data-glass='low'] .sheen {
  display: none;
}
@media (prefers-reduced-motion: reduce) {
  .blob,
  .aurora {
    animation: none;
  }
  .sheen {
    display: none;
  }
}
</style>
