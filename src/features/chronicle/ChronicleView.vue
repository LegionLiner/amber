<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import ChipTabs from '@/components/ChipTabs.vue'
import OverviewTab from './OverviewTab.vue'
import DiaryTab from './DiaryTab.vue'
import ErasTab from './ErasTab.vue'
import ContextsTab from './ContextsTab.vue'
import RecapTab from './RecapTab.vue'
import { useUi } from '@/stores/ui'

/** Хроника: обзор статистики, дневник, эпохи, контексты и итоги */
type ChronTab = 'overview' | 'diary' | 'eras' | 'contexts' | 'recap'
const TABS: { id: ChronTab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'diary', label: 'Дневник' },
  { id: 'eras', label: 'Эпохи' },
  { id: 'contexts', label: 'Контексты' },
  { id: 'recap', label: 'Итоги' },
]

const route = useViewRoute()
const router = useRouter()
const ui = useUi()
const scrollEl = ref<HTMLElement | null>(null)
/** Вкладка — это место экрана в ленте: у каждой вкладки свой экран, соседние отрисованы заранее */
const tab = computed(() => (route.query.tab as ChronTab) || 'overview')
function setTab(t: ChronTab) {
  void router.replace({ path: '/chronicle', query: { tab: t } })
}
watch(
  () => ui.reselect,
  (r) => r.tab === 'chronicle' && scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' }),
)
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <header class="hdr">
      <h1 class="display title">Хроника</h1>
    </header>
    <ChipTabs :items="TABS" :model-value="tab" @update:model-value="setTab" />
    <OverviewTab v-if="tab === 'overview'" />
    <DiaryTab v-else-if="tab === 'diary'" />
    <ErasTab v-else-if="tab === 'eras'" />
    <ContextsTab v-else-if="tab === 'contexts'" />
    <RecapTab v-else />
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.hdr {
  padding: calc(var(--safe-top) + 10px) var(--gutter) 6px;
}
.title {
  font-size: 26px;
  font-weight: 600;
  min-height: 48px;
  display: flex;
  align-items: center;
}
</style>
