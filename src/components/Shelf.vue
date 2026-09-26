<script setup lang="ts">
import CoverArt from './CoverArt.vue'
import type { Track } from '@/domain/track'
import { displayArtist } from '@/domain/track'

/** Горизонтальная полка обложек. Тап играет всю полку с этого трека. */
defineProps<{ title: string; hint?: string; tracks: Track[] }>()
const emit = defineEmits<{ play: [index: number]; more: [] }>()
</script>

<template>
  <section v-if="tracks.length" class="shelf">
    <div class="section-title">
      <span>{{ title }}</span>
      <button v-if="hint" type="button" class="more-link" @click="emit('more')">{{ hint }}</button>
    </div>
    <div class="row">
      <button v-for="(t, i) in tracks" :key="t.key" type="button" class="card" @click="emit('play', i)">
        <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="m" radius="var(--r-m)" />
        <span class="t ellipsis">{{ t.title }}</span>
        <span class="s ellipsis">{{ displayArtist(t) }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 0 var(--gutter) 4px;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
  scroll-padding-inline: var(--gutter);
}
.row::-webkit-scrollbar {
  display: none;
}
.card {
  flex: none;
  width: 128px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  scroll-snap-align: start;
}
.card :deep(.cover) {
  width: 128px;
  margin-bottom: 4px;
}
.t {
  font: 500 13.5px/1.25 var(--f-body);
}
.s {
  font: 400 12px/1.25 var(--f-body);
  color: var(--ink-2);
}
</style>
