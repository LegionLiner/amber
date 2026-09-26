<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { coverSrc, type CoverSize } from '@/native/paths'
import { initialOf } from '@/domain/names'
import { coverGradient } from '@/domain/palette'

/**
 * Обложка. Если картинки нет или она не загрузилась, рисуем генеративную:
 * градиент из восьми подобранных пар, пара выбирается по хешу названия,
 * поэтому один и тот же трек всегда получает одну и ту же обложку.
 */
const props = withDefaults(
  defineProps<{
    art?: string | null
    seed: string
    label?: string
    size?: CoverSize
    radius?: string
  }>(),
  { art: null, label: '', size: 's', radius: 'var(--r-s)' },
)

const failed = ref(false)
watch(
  () => props.art,
  () => (failed.value = false),
)

const src = computed(() => (failed.value ? null : coverSrc(props.art, props.size)))
const gradient = computed(() => coverGradient(props.seed))
const letter = computed(() => initialOf(props.label || props.seed))
</script>

<template>
  <div class="cover" :style="{ borderRadius: radius, background: src ? 'var(--surface-2)' : gradient }">
    <img v-if="src" :src="src" alt="" loading="lazy" decoding="async" draggable="false" @error="failed = true" />
    <span v-else class="letter" aria-hidden="true">{{ letter }}</span>
  </div>
</template>

<style scoped>
.cover {
  position: relative;
  overflow: hidden;
  aspect-ratio: 1;
  flex: none;
  container-type: inline-size;
}
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.letter {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font: 600 38cqi / 1 var(--f-display);
  color: rgba(255, 255, 255, 0.86);
  text-shadow: 0 1px 12px rgba(0, 0, 0, 0.25);
}
</style>
