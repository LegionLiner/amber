<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import ChipTabs from '@/components/ChipTabs.vue'
import OverviewTab from './OverviewTab.vue'
import DiaryTab from './DiaryTab.vue'
import ErasTab from './ErasTab.vue'
import ContextsTab from './ContextsTab.vue'
import RecapTab from './RecapTab.vue'
import { useUi } from '@/stores/ui'
import { tabSlide } from '@/app/paging'

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
const tab = ref<ChronTab>((route.query.tab as ChronTab) || 'overview')
watch(
  () => route.query.tab,
  (t) => t && (tab.value = t as ChronTab),
)
/** Куда листается вкладка — для анимации: вправо по порядку чипсов или влево */
watch(tab, (n, o) => {
  const a = TABS.findIndex((x) => x.id === o)
  const b = TABS.findIndex((x) => x.id === n)
  if (a >= 0 && b >= 0 && a !== b) tabSlide.value = b > a ? 'next' : 'prev'
})
function setTab(t: ChronTab) {
  tab.value = t
  void router.replace({ query: { tab: t } })
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
    <!-- Новая вкладка въезжает с той стороны, куда листали (чипсы или свайп) -->
    <Transition :name="`tab-${tabSlide}`">
      <OverviewTab v-if="tab === 'overview'" />
      <DiaryTab v-else-if="tab === 'diary'" />
      <ErasTab v-else-if="tab === 'eras'" />
      <ContextsTab v-else-if="tab === 'contexts'" />
      <RecapTab v-else />
    </Transition>
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
