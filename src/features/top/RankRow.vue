<script setup lang="ts">
import CoverArt from '@/components/CoverArt.vue'
import { displayArtist, type Track } from '@/domain/track'

/**
 * Строка рейтинга или чарта: место, движение (▲3, ▼2, NEW, RE), обложка, название,
 * справа — звёзды или число прослушиваний.
 */
defineProps<{
  pos: number
  track: Track
  /** >0 поднялся, <0 опустился, 'new' — впервые, 're' — вернулся */
  move?: number | 'new' | 're' | null
  right?: string
  sub?: string
  first?: boolean
  now?: boolean
}>()
defineEmits<{ tap: []; more: [] }>()
</script>

<template>
  <div class="rank" :class="{ first }" @click="$emit('tap')" @contextmenu.prevent="$emit('more')">
    <span class="pos display">{{ pos }}</span>
    <span class="mv num" :class="typeof move === 'number' ? (move > 0 ? 'up' : move < 0 ? 'down' : '') : move ? 'new' : ''">
      <template v-if="move === 'new'">NEW</template>
      <template v-else-if="move === 're'">RE</template>
      <template v-else-if="typeof move === 'number' && move !== 0">{{ move > 0 ? '▲' : '▼' }}{{ Math.abs(move) }}</template>
      <template v-else>–</template>
    </span>
    <CoverArt :art="track.art" :seed="track.title" :label="track.title" size="s" class="cv" />
    <span class="text">
      <span class="t ellipsis" :class="{ now }">{{ track.title }}</span>
      <span class="s ellipsis">{{ sub ?? displayArtist(track) }}</span>
    </span>
    <span class="right">{{ right }}</span>
  </div>
</template>

<style scoped>
.rank {
  display: grid;
  grid-template-columns: 30px 30px 44px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 8px var(--gutter) 8px 10px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  content-visibility: auto;
  contain-intrinsic-size: auto 60px;
}
.rank:active {
  background: var(--surface);
}
.rank.first {
  margin: 0 10px 4px;
  padding: 10px 6px;
  border-radius: 16px;
  background: var(--surface);
}
.rank.first::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.5;
  pointer-events: none;
  background: linear-gradient(
    115deg,
    transparent 20%,
    rgba(255, 200, 120, 0.32) 35%,
    rgba(140, 220, 210, 0.22) 45%,
    rgba(255, 150, 120, 0.26) 55%,
    transparent 70%
  );
  background-size: 250% 100%;
  animation: holo 7s linear infinite;
}
@keyframes holo {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -120% 0;
  }
}
.pos {
  text-align: center;
  font-size: 16px;
  font-weight: 600;
}
.first .pos {
  color: var(--amber-ink);
}
.mv {
  font: 600 10.5px/1 var(--f-body);
  text-align: center;
  color: var(--ink-3);
}
.mv.up {
  color: var(--good);
}
.mv.down {
  color: var(--bad);
}
.mv.new {
  color: var(--amber-ink);
}
.cv {
  width: 44px;
  margin-left: 4px;
}
.text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: 4px;
}
.t {
  font: 500 15px/1.25 var(--f-body);
}
.t.now {
  color: var(--amber-ink);
}
.s {
  font-size: 12.5px;
  color: var(--ink-2);
}
.right {
  font: 600 13px/1 var(--f-body);
  color: var(--amber-ink);
  white-space: nowrap;
}
</style>
