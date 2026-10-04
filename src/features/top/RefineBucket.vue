<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import IconDrag from '~icons/solar/hamburger-menu-linear'
import CoverArt from '@/components/CoverArt.vue'
import { useDragList } from '@/composables/useDragList'
import { useLibrary } from '@/stores/library'
import { saveScores } from '@/data/repos/duels'
import { refinementsForOrder } from '@/domain/duels'
import { bucketBase, starsLabel } from '@/domain/rating'
import { displayArtist, type Track } from '@/domain/track'

/**
 * Одна группа звёзд в режиме уточнения: перетаскиваешь треки — меняется их порядок
 * внутри группы (звёзды остаются те же).
 */
const props = defineProps<{ rating: number; tracks: Track[]; startPos: number }>()
const library = useLibrary()
const ROW_H = 58
const list = shallowRef<Track[]>(props.tracks)
watch(
  () => props.tracks,
  (t) => (list.value = t),
)
const scrollEl = ref<HTMLElement | null>(null)

const drag = useDragList({
  rowH: ROW_H,
  count: () => list.value.length,
  scrollEl,
  onMove: async (from, to) => {
    const l = list.value.slice()
    const [t] = l.splice(from, 1)
    l.splice(to, 0, t!)
    list.value = l
    const refs = refinementsForOrder(l.length)
    const scores = l.map((t, i) => ({ key: t.key, rankScore: bucketBase(props.rating) + refs[i]! }))
    library.patchMany(new Map(scores.map((s) => [s.key, { rankScore: s.rankScore }])))
    await saveScores(scores)
  },
})

function findScroller(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null
  while (p && !p.classList.contains('scroll')) p = p.parentElement
  return p
}
const root = ref<HTMLElement | null>(null)
watch(root, (el) => (scrollEl.value = findScroller(el)))
</script>

<template>
  <section ref="root" class="bucket">
    <h3 class="bh">
      <span class="stars">{{ starsLabel(rating) }}</span
      ><small class="muted">{{ list.length }}</small>
    </h3>
    <div class="list" :style="{ height: `${list.length * ROW_H}px` }">
      <div
        v-for="(t, i) in list"
        :key="t.key"
        class="item"
        :class="{ dragging: drag.from.value === i }"
        :style="{ top: `${i * ROW_H}px`, height: `${ROW_H}px`, ...drag.styleFor(i) }"
      >
        <span class="pos num">{{ startPos + i }}</span>
        <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="s" class="cv" />
        <span class="text">
          <span class="t ellipsis">{{ t.title }}</span>
          <span class="s ellipsis">{{ displayArtist(t) }}</span>
        </span>
        <span
          class="handle"
          aria-label="Перетащить"
          @pointerdown="drag.start($event, i)"
          @pointermove="drag.move"
          @pointerup="drag.end"
          @pointercancel="drag.end"
        >
          <IconDrag />
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bucket {
  margin-bottom: 8px;
}
.bh {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 12px var(--gutter) 6px;
  font: 600 14px/1 var(--f-body);
}
.stars {
  color: var(--amber-ink);
}
.bh small {
  font-size: 12px;
}
.list {
  position: relative;
}
.item {
  position: absolute;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: 28px 40px 1fr 44px;
  gap: 10px;
  align-items: center;
  padding: 0 4px 0 var(--gutter);
  transition: transform 180ms var(--ease-out);
}
.item.dragging {
  transition: none;
  z-index: 2;
  background: var(--surface-2);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.pos {
  font-size: 12.5px;
  color: var(--ink-3);
  text-align: center;
}
.cv {
  width: 40px;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.t {
  font: 500 14.5px/1.25 var(--f-body);
}
.s {
  font-size: 12px;
  color: var(--ink-2);
}
.handle {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  color: var(--ink-3);
  touch-action: none;
  cursor: grab;
}
.handle svg {
  width: 20px;
  height: 20px;
}
</style>
