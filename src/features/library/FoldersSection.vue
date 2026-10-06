<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import IconFolder from '~icons/solar/folder-2-linear'
import HeadSpace from '@/components/HeadSpace.vue'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { countLabel } from '@/domain/format'
import type { FolderNode } from '@/domain/groups'

const library = useLibrary()
const ui = useUi()
const router = useRouter()
const scrollEl = ref<HTMLElement | null>(null)

/** Корень телефона почти всегда содержит одну-две папки: сразу раскрываем их верхний уровень */
const top = computed<FolderNode[]>(() => {
  const root = library.folderTree
  const out: FolderNode[] = []
  for (const c of root.children) {
    if (c.tracks.length === 0 && c.children.length > 0 && c.children.length <= 12) out.push(...c.children)
    else out.push(c)
  }
  return out.sort((a, b) => b.total - a.total)
})

watch(
  () => ui.reselect,
  (r) => r.tab === 'library' && scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' }),
)
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <HeadSpace />
    <div class="tile-grid">
      <button
        v-for="f in top"
        :key="f.path"
        type="button"
        class="row"
        @click="router.push({ path: '/folder', query: { path: f.path } })"
      >
        <span class="ic"><IconFolder /></span>
        <span class="text">
          <span class="t ellipsis">{{ f.name }}</span>
          <span class="s ellipsis">{{ f.path }} · {{ countLabel(f.total, ['трек', 'трека', 'треков']) }}</span>
        </span>
      </button>
    </div>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.row {
  width: 100%;
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 14px;
  align-items: center;
  padding: 8px var(--gutter);
  text-align: left;
}
.row:active {
  background: var(--surface);
}
.ic {
  width: 48px;
  height: 48px;
  border-radius: var(--r-m);
  display: grid;
  place-items: center;
  background: var(--surface-2);
  color: var(--amber-ink);
}
.ic svg {
  width: 24px;
  height: 24px;
}
.text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.t {
  font: 500 15px/1.25 var(--f-body);
}
.s {
  font-size: 12.5px;
  color: var(--ink-2);
}
</style>
