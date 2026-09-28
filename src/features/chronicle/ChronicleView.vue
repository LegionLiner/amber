<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useViewRoute } from '@/app/view-route'
import HeadSpace from '@/components/HeadSpace.vue'
import OverviewTab from './OverviewTab.vue'
import DiaryTab from './DiaryTab.vue'
import ErasTab from './ErasTab.vue'
import ContextsTab from './ContextsTab.vue'
import RecapTab from './RecapTab.vue'
import { useUi } from '@/stores/ui'

/** Хроника: обзор статистики, дневник, эпохи, контексты и итоги */
type ChronTab = 'overview' | 'diary' | 'eras' | 'contexts' | 'recap'

const route = useViewRoute()
const ui = useUi()
const scrollEl = ref<HTMLElement | null>(null)
/** Вкладка — это место экрана в ленте: у каждой вкладки свой экран, соседние отрисованы заранее */
const tab = computed(() => (route.query.tab as ChronTab) || 'overview')
watch(
  () => ui.reselect,
  (r) => r.tab === 'chronicle' && scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' }),
)
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <HeadSpace />
    <OverviewTab v-if="tab === 'overview'" />
    <DiaryTab v-else-if="tab === 'diary'" />
    <ErasTab v-else-if="tab === 'eras'" />
    <ContextsTab v-else-if="tab === 'contexts'" />
    <RecapTab v-else />
    <div class="bottom-space" />
  </div>
</template>

