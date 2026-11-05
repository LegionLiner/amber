<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import IconRefresh from '~icons/solar/refresh-linear'
import ChipTabs from './ChipTabs.vue'
import { useLibrary } from '@/stores/library'
import { PAGES, SECTION_TABS, SECTION_TITLES, TAB_LABELS, pageLocation, type TabbedSection } from '@/app/paging'
import { $t } from '@/i18n'

/**
 * Общий заголовок раздела с подвкладками: название и чипсы. Стоит на месте, пока листаются вкладки
 * раздела, а подсветка чипса едет за пальцем (pos — дробный номер вкладки, ms — длительность доезда).
 * При переходе в другой раздел заголовок уезжает вместе с ним — это двигает лента (PageStrip).
 */
const props = defineProps<{ section: TabbedSection; pos: number; ms: number }>()
const router = useRouter()
const library = useLibrary()

const items = computed(() => SECTION_TABS[props.section].map((id) => ({ id, label: TAB_LABELS[id] ?? id })))
const active = computed(() => SECTION_TABS[props.section][Math.round(props.pos)] ?? SECTION_TABS[props.section][0]!)

function select(tab: string) {
  const i = PAGES.findIndex((p) => p.name === props.section && p.tab === tab)
  if (i >= 0) void router.replace(pageLocation(i))
}
</script>

<template>
  <div class="sec-head">
    <header class="hd-title">
      <div class="top">
        <h1 class="display title">{{ SECTION_TITLES[section] }}</h1>
        <button
          v-if="section === 'library'"
          type="button"
          class="icon-btn"
          :class="{ spin: library.scanning }"
          :aria-label="$t('Обновить библиотеку')"
          @click="library.scan(false)"
        >
          <IconRefresh />
        </button>
      </div>
      <p v-if="section === 'library' && library.scanning" class="scan muted">
        {{ $t('Ищу изменения{0}', library.progress ? $t(' · {0} из {1}', library.progress.done, library.progress.total) : '…') }}
      </p>
    </header>
    <ChipTabs :items="items" :model-value="active" :pos="pos" :ms="ms" @update:model-value="select" />
  </div>
</template>

<style scoped>
.sec-head {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  padding-bottom: 6px;
  background: var(--bg);
  will-change: transform;
}
.hd-title {
  padding: calc(var(--safe-top) + 18px) var(--gutter) 8px;
  transform-origin: left bottom;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
}
.title {
  font-size: 26px;
  font-weight: 600;
}
.scan {
  font-size: 12.5px;
  margin-top: 2px;
}
.spin :deep(svg) {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
