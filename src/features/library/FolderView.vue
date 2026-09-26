<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import IconFolder from '~icons/solar/folder-2-linear'
import CollectionPage from '@/components/CollectionPage.vue'
import { useLibrary } from '@/stores/library'
import { allTracksIn, findFolder } from '@/domain/groups'
import { countLabel } from '@/domain/format'

const route = useViewRoute()
const router = useRouter()
const library = useLibrary()
const path = computed(() => String(route.query.path ?? ''))
const node = computed(() => findFolder(library.folderTree, path.value))
/** Играем папку целиком, вместе с вложенными */
const tracks = computed(() => (node.value ? allTracksIn(node.value) : []))
</script>

<template>
  <CollectionPage
    v-if="node"
    kind="Папка"
    :title="node.name"
    :subtitle="`${node.path || '/'} · ${countLabel(node.total, ['трек', 'трека', 'треков'])}`"
    :tracks="tracks"
    :source="{ type: 'folder', id: node.path, title: node.name }"
  >
    <template #extra>
      <div v-if="node.children.length" class="subs">
        <button
          v-for="c in node.children"
          :key="c.path"
          type="button"
          class="sub"
          @click="router.push({ path: '/folder', query: { path: c.path } })"
        >
          <IconFolder />
          <span class="ellipsis">{{ c.name }}</span>
          <span class="n">{{ c.total }}</span>
        </button>
      </div>
    </template>
  </CollectionPage>
  <div v-else class="empty"><h3>Папка не найдена</h3></div>
</template>

<style scoped>
.subs {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  justify-content: center;
}
.sub {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 9px 12px;
  border-radius: 12px;
  background: var(--surface);
  font: 500 13.5px/1 var(--f-body);
}
.sub svg {
  width: 18px;
  height: 18px;
  color: var(--amber-ink);
  flex: none;
}
.n {
  color: var(--ink-3);
  font-size: 12px;
}
</style>
