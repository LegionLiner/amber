<script setup lang="ts">
import { computed } from 'vue'
import IconPalette from '~icons/solar/palette-linear'
import { TINTS } from '@/domain/palette'

/** Цвет эпохи или контекста: готовые оттенки и «свой» — системный выбор любого цвета */
const model = defineModel<string>({ required: true })
const custom = computed(() => !TINTS.includes(model.value.toLowerCase()))
</script>

<template>
  <div class="colors" role="radiogroup" aria-label="Цвет">
    <button
      v-for="c in TINTS"
      :key="c"
      type="button"
      class="sw"
      role="radio"
      :aria-checked="model.toLowerCase() === c"
      :class="{ on: model.toLowerCase() === c }"
      :style="{ background: c }"
      :aria-label="c"
      @click="model = c"
    />
    <label class="sw own" :class="{ on: custom }" :style="custom ? { background: model } : undefined" aria-label="Свой цвет">
      <IconPalette v-if="!custom" />
      <input id="color-own" v-model="model" type="color" />
    </label>
  </div>
</template>

<style scoped>
.colors {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));
  gap: 10px;
  justify-items: center;
}
.sw {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  transition: transform var(--t-fast) var(--ease);
}
.sw:active {
  transform: scale(0.88);
}
.sw.on {
  box-shadow:
    0 0 0 3px var(--surface),
    0 0 0 5px var(--ink);
}
.own {
  display: grid;
  place-items: center;
  background: conic-gradient(#ff6b6b, #ffd93d, #6bcb77, #4d96ff, #b46cf0, #ff6b6b);
  color: #fff;
  cursor: pointer;
  overflow: hidden;
}
.own svg {
  width: 18px;
  height: 18px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}
.own input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
</style>
