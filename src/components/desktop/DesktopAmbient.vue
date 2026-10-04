<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { usePlayer } from '@/stores/player'
import { useSettings } from '@/stores/settings'
import { useCoverGlow } from '@/app/cover-colors'
import { audioLevels } from '@/native/web/audio-graph'
import { motionReduced } from '@/app/motion'

/**
 * Фон окна на компьютере: мягкие пятна в цветах обложки того, что играет, и свечение снизу.
 * Через этот фон видно стекло бокового меню, панели плеера, заголовков и шторок.
 *
 * Подсветка в такт музыке (настройка desktopPulse): пятна и свечение снизу дышат по басам.
 * Уровень берётся из анализатора звукового графа после эффектов. Удар — это бас заметно выше своего
 * среднего за последнюю треть секунды: так вспышки видны и в тихих, и в громких треках, а ровный гул
 * не держит свечение на максимуме. К ударам добавляется спокойная подложка по общей громкости.
 * Всё считается по времени, а не по кадрам: в свёрнутом окне кадров меньше, а ритм тот же.
 * Каждый кадр меняется только переменная --pulse на этом слое: прозрачность и масштаб считает видеокарта.
 */
const player = usePlayer()
const settings = useSettings()

const colors = useCoverGlow(() => ({
  art: player.currentTrack?.art,
  seed: player.current?.title ?? 'amber',
  color1: player.currentTrack?.color1,
  color2: player.currentTrack?.color2,
}))

const el = ref<HTMLElement | null>(null)
const live = computed(() => settings.s.desktopPulse && player.playing && !motionReduced())

let raf = 0
let env = 0
let avg = 0
let loud = 0
let loudPeak = 0.1
let last = 0
function frame(now: number) {
  raf = requestAnimationFrame(frame)
  const dt = last ? Math.min(100, now - last) : 16
  last = now
  const l = audioLevels()
  const bass = l?.bass ?? 0
  // Среднее баса за ~0,35 с и удар над ним (подобрано на настоящих треках: заметно, но не мигает)
  avg += (bass - avg) * (1 - Math.exp(-dt / 350))
  const hit = Math.min(1, Math.max(0, bass - avg) / Math.max(0.03, avg * 0.22))
  // Удар — сразу вверх, спад — за ~0,2 с
  env = hit > env ? hit : env * Math.exp(-dt / 200)
  // Подложка: общая громкость относительно недавнего максимума
  loudPeak = Math.max(l?.level ?? 0, loudPeak * Math.exp(-dt / 8000), 0.05)
  loud += ((l?.level ?? 0) / loudPeak - loud) * (1 - Math.exp(-dt / 300))
  const pulse = Math.min(1, 0.25 * loud + 0.8 * env)
  el.value?.style.setProperty('--pulse', pulse.toFixed(3))
}
function stop() {
  cancelAnimationFrame(raf)
  raf = 0
  env = 0
  el.value?.style.setProperty('--pulse', '0')
}
watch(
  live,
  (on) => {
    if (on && !raf) {
      last = 0
      raf = requestAnimationFrame(frame)
    } else if (!on) stop()
  },
  { immediate: true },
)
onBeforeUnmount(stop)
</script>

<template>
  <div
    ref="el"
    class="amb-desk"
    :class="{ playing: player.playing, idle: !player.current, live }"
    :style="{ '--c1': colors[0], '--c2': colors[1] }"
    aria-hidden="true"
  >
    <i class="blob b1" />
    <i class="blob b2" />
    <i class="blob b3" />
    <i class="floor" />
  </div>
</template>

<style scoped>
.amb-desk {
  --pulse: 0;
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  transition:
    --c1 1.6s var(--ease),
    --c2 1.6s var(--ease);
}
.blob {
  position: absolute;
  border-radius: 50%;
  will-change: transform, opacity;
  transition: opacity 600ms var(--ease);
}
.b1 {
  width: 70vw;
  height: 70vw;
  left: -18vw;
  top: -30vw;
  background: radial-gradient(closest-side, var(--c1), transparent);
  opacity: calc(0.26 + var(--pulse) * 0.14);
  animation: drift-a 38s ease-in-out infinite alternate;
}
.b2 {
  width: 60vw;
  height: 60vw;
  right: -20vw;
  top: 20vh;
  background: radial-gradient(closest-side, var(--c2), transparent);
  opacity: calc(0.2 + var(--pulse) * 0.12);
  animation: drift-b 46s ease-in-out infinite alternate;
}
.b3 {
  width: 54vw;
  height: 40vw;
  left: 20vw;
  bottom: -14vw;
  background: radial-gradient(closest-side, var(--c1), transparent);
  opacity: calc(0.16 + var(--pulse) * 0.16);
  animation: drift-a 52s ease-in-out infinite alternate-reverse;
}
/* Свечение снизу, над панелью плеера: в такт басам поднимается и становится ярче */
.floor {
  position: absolute;
  left: 8vw;
  right: 8vw;
  bottom: 0;
  height: 300px;
  transform-origin: 50% 100%;
  background: radial-gradient(
    ellipse 50% 100% at 50% 100%,
    var(--c1),
    color-mix(in srgb, var(--c2) 50%, transparent) 45%,
    transparent 75%
  );
  opacity: 0;
  transform: scaleY(0.35);
  transition:
    opacity 900ms var(--ease),
    transform 900ms var(--ease);
}
.live .floor {
  opacity: calc(0.22 + var(--pulse) * 0.5);
  transform: scaleY(calc(0.55 + var(--pulse) * 0.6));
  transition: none;
}
.idle .blob {
  opacity: 0.1;
}
.amb-desk:not(.playing) .blob {
  animation-play-state: paused;
}
:global([data-theme='light']) .amb-desk .blob {
  mix-blend-mode: multiply;
}
:global([data-theme='light']) .b1 {
  opacity: calc(0.2 + var(--pulse) * 0.1);
}
:global([data-theme='light']) .b2,
:global([data-theme='light']) .b3 {
  opacity: calc(0.15 + var(--pulse) * 0.1);
}
@keyframes drift-a {
  to {
    transform: translate(8vw, 6vh) scale(1.12);
  }
}
@keyframes drift-b {
  to {
    transform: translate(-10vw, -8vh) scale(1.08);
  }
}
@media (prefers-reduced-motion: reduce) {
  .blob {
    animation: none;
  }
}
</style>
