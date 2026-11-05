<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import IconHome from '~icons/solar/home-2-linear'
import IconHomeOn from '~icons/solar/home-2-bold'
import IconLib from '~icons/solar/music-library-2-linear'
import IconLibOn from '~icons/solar/music-library-2-bold'
import IconSearch from '~icons/solar/magnifer-linear'
import IconTop from '~icons/solar/cup-star-linear'
import IconTopOn from '~icons/solar/cup-star-bold'
import IconChron from '~icons/solar/history-linear'
import IconChronOn from '~icons/solar/history-bold'
import type { TabId } from '@/app/router'
import { haptic } from '@/native/haptics'
import { $t } from '@/i18n'

const route = useRoute()
const router = useRouter()
const emit = defineEmits<{ reselect: [tab: TabId] }>()

const tabs: { id: TabId; to: string; label: string; icon: Component; on: Component }[] = [
  { id: 'home', to: '/', label: $t('Главная'), icon: IconHome, on: IconHomeOn },
  { id: 'library', to: '/library', label: $t('Медиатека'), icon: IconLib, on: IconLibOn },
  { id: 'search', to: '/search', label: $t('Поиск'), icon: IconSearch, on: IconSearch },
  { id: 'top', to: '/top', label: $t('Топ'), icon: IconTop, on: IconTopOn },
  { id: 'chronicle', to: '/chronicle', label: $t('Хроника'), icon: IconChron, on: IconChronOn },
]

const active = computed(() => route.meta.tab ?? 'home')
const activeIndex = computed(() =>
  Math.max(
    0,
    tabs.findIndex((t) => t.id === active.value),
  ),
)
/** Иконка «подпрыгивает», когда вкладка становится активной, но не при запуске приложения */
const ready = ref(false)
onMounted(() => requestAnimationFrame(() => (ready.value = true)))

function go(t: (typeof tabs)[number]) {
  haptic.tick()
  if (active.value === t.id && route.path === t.to) {
    emit('reselect', t.id)
    return
  }
  void router.push(t.to)
}
</script>

<template>
  <nav class="nav glass" :aria-label="$t('Разделы')" :style="{ '--i': activeIndex }">
    <i class="tab-mark" aria-hidden="true" />
    <button
      v-for="t in tabs"
      :key="t.id"
      type="button"
      class="item"
      :class="{ on: active === t.id }"
      :aria-current="active === t.id ? 'page' : undefined"
      @click="go(t)"
    >
      <component
        :is="active === t.id ? t.on : t.icon"
        :key="active === t.id ? 'on' : 'off'"
        class="ic"
        :class="{ pop: ready && active === t.id }"
      />
      <span>{{ t.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  height: calc(var(--nav-h) + var(--safe-bottom));
  padding: 6px 4px calc(var(--safe-bottom) + 6px);
  border-width: 1px 0 0;
  border-radius: 0;
}
/* Подложка под иконкой активной вкладки (не .pill: так называются кнопки-пилюли в forms.css): центр иконки = 6 (отступ) + 6.75 (центровка) + 12 */
.tab-mark {
  position: absolute;
  top: 10px;
  left: 4px;
  width: calc((100% - 8px) / 5);
  height: 30px;
  display: flex;
  justify-content: center;
  pointer-events: none;
  transform: translateX(calc(100% * var(--i)));
  transition: transform 360ms var(--ease-out);
}
.tab-mark::before {
  content: '';
  width: 58px;
  height: 100%;
  border-radius: 999px;
  background: rgba(var(--amber-rgb), 0.14);
}
.item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font: 500 10.5px/1 var(--f-body);
  color: var(--ink-3);
  transition: color var(--t-fast) var(--ease);
}
.item.on {
  color: var(--amber-ink);
}
.item:active .ic {
  transform: scale(0.86);
}
.ic {
  width: 24px;
  height: 24px;
  transition: transform var(--t-fast) var(--ease);
}
</style>
