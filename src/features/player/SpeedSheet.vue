<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayer } from '@/stores/player'
import { isNative } from '@/native/paths'
import RangeSlider from '@/components/RangeSlider.vue'

/**
 * Скорость и тон. «Slowed» и «Nightcore» — скорость и тон вместе, как на пластинке;
 * «Быстрее» и «Медленнее» — только темп, голос не меняется.
 */
const player = usePlayer()

const PRESETS: { id: string; label: string; hint: string; speed: number; pitch: number }[] = [
  { id: 'normal', label: 'Как есть', hint: '1×', speed: 1, pitch: 1 },
  { id: 'slowed', label: 'Slowed', hint: 'медленнее и ниже', speed: 0.85, pitch: 0.85 },
  { id: 'nightcore', label: 'Nightcore', hint: 'быстрее и выше', speed: 1.25, pitch: 1.25 },
  { id: 'slow', label: 'Медленнее', hint: 'тон тот же', speed: 0.85, pitch: 1 },
  { id: 'fast', label: 'Быстрее', hint: 'тон тот же', speed: 1.2, pitch: 1 },
]

const keepTone = computed(() => Math.abs(player.pitch - 1) < 0.001 || Math.abs(player.pitch - player.speed) > 0.001)
const current = computed(
  () => PRESETS.find((p) => Math.abs(p.speed - player.speed) < 0.001 && Math.abs(p.pitch - player.pitch) < 0.001)?.id,
)

function set(speed: number, pitch: number) {
  void player.setPlaybackParams(Math.round(speed * 100) / 100, Math.round(pitch * 100) / 100)
}
/** Пока палец на ползунке, меняется только цифра: применяем один раз, когда отпустили */
const draft = ref<number | null>(null)
const shownSpeed = computed(() => draft.value ?? player.speed)
function applySpeed(v: number) {
  draft.value = null
  if (Math.abs(v - player.speed) < 0.001) return
  set(v, keepTone.value ? 1 : v)
}
function toggleTone() {
  set(player.speed, keepTone.value ? player.speed : 1)
}
</script>

<template>
  <div class="sheet-body form">
    <h3 class="sheet-head">Скорость и тон</h3>
    <div class="pills">
      <button
        v-for="p in PRESETS"
        :key="p.id"
        type="button"
        class="pill"
        :class="{ on: current === p.id }"
        @click="set(p.speed, p.pitch)"
      >
        {{ p.label }}
      </button>
    </div>
    <div class="slider-row">
      <header>
        <span>Скорость</span><output>{{ shownSpeed.toFixed(2) }}×</output>
      </header>
      <RangeSlider
        :model-value="shownSpeed"
        :min="0.5"
        :max="2"
        :step="0.05"
        label="Скорость"
        @update:model-value="(v: number) => (draft = v)"
        @change="applySpeed"
      />
    </div>
    <label class="row">
      <span
        ><b>Сохранять тон</b><small>{{ keepTone ? 'Голос звучит как обычно' : 'Тон меняется вместе со скоростью' }}</small></span
      >
      <input id="keep-tone" type="checkbox" class="switch" :checked="keepTone" @change="toggleTone" />
    </label>
    <p v-if="!isNative" class="note">
      В браузере тон нельзя сдвинуть отдельно: он либо сохраняется, либо едет вместе со скоростью.
    </p>
    <p class="note">Прослушивание засчитывается по реальному времени: на ускорении трек засчитается быстрее.</p>
  </div>
</template>
