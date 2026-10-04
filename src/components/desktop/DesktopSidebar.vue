<script setup lang="ts">
import { computed, watch, type Component } from 'vue'
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
import IconSettings from '~icons/solar/settings-linear'
import IconAdd from '~icons/solar/add-circle-linear'
import IconHeart from '~icons/solar/heart-bold'
import CoverArt from '@/components/CoverArt.vue'
import NameSheet from '@/components/NameSheet.vue'
import type { TabId } from '@/app/router'
import { bootState } from '@/app/boot-state'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'

/**
 * Боковое меню компьютерной версии: разделы (как нижняя навигация на телефоне), плейлисты, настройки.
 * Повторное нажатие на открытый раздел — наверх и к началу, как повторный тап по вкладке.
 */
const route = useRoute()
const router = useRouter()
const ui = useUi()
const playlists = usePlaylists()

const tabs: { id: TabId; to: string; label: string; icon: Component; on: Component }[] = [
  { id: 'home', to: '/', label: 'Главная', icon: IconHome, on: IconHomeOn },
  { id: 'library', to: '/library', label: 'Медиатека', icon: IconLib, on: IconLibOn },
  { id: 'search', to: '/search', label: 'Поиск', icon: IconSearch, on: IconSearch },
  { id: 'top', to: '/top', label: 'Топ', icon: IconTop, on: IconTopOn },
  { id: 'chronicle', to: '/chronicle', label: 'Хроника', icon: IconChron, on: IconChronOn },
]

const active = computed(() =>
  route.name === 'settings' || String(route.name).startsWith('settings') ? null : (route.meta.tab ?? 'home'),
)
const openPlaylist = computed(() => (route.name === 'playlist' || route.name === 'mix' ? Number(route.params.id) : null))

function go(t: (typeof tabs)[number]) {
  if (active.value === t.id && route.path === t.to) {
    ui.tabReselected(t.id)
    return
  }
  void router.push(t.to)
}

// Список плейлистов — когда база готова: меню появляется раньше, чем запуск успевает создать таблицы
watch(
  () => bootState.ready,
  (ready) => ready && void playlists.refresh(),
  { immediate: true },
)

function create() {
  ui.openSheet(NameSheet, {
    title: 'Новый плейлист',
    initial: '',
    confirm: 'Создать',
    onDone: async (name: string) => {
      const id = await playlists.create(name, [])
      void router.push(`/playlist/${id}`)
    },
  })
}
</script>

<template>
  <aside class="side" aria-label="Разделы">
    <div class="brand display">Amber</div>
    <nav class="nav">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="item"
        :class="{ on: active === t.id }"
        :aria-current="active === t.id ? 'page' : undefined"
        @click="go(t)"
      >
        <component :is="active === t.id ? t.on : t.icon" class="ic" />
        <span>{{ t.label }}</span>
      </button>
    </nav>

    <div class="lists">
      <div class="lists-head">
        <span>Плейлисты</span>
        <button type="button" class="add" aria-label="Новый плейлист" title="Новый плейлист" @click="create"><IconAdd /></button>
      </div>
      <div class="scroll list">
        <button
          type="button"
          class="pl"
          :class="{ on: route.path === '/library/favorites' }"
          @click="router.push('/library/favorites')"
        >
          <span class="fav"><IconHeart /></span>
          <span class="ellipsis">Избранное</span>
        </button>
        <button
          v-for="p in playlists.list"
          :key="p.id"
          type="button"
          class="pl"
          :class="{ on: openPlaylist === p.id }"
          @click="router.push(`/playlist/${p.id}`)"
        >
          <CoverArt :art="p.cover" :seed="p.name" :label="p.name" size="s" radius="6px" class="cv" />
          <span class="text">
            <span class="ellipsis">{{ p.name }}</span>
            <small
              >{{ p.kind === 'mix' ? 'микс' : p.kind === 'smart' ? 'умный' : '' }}{{ p.kind !== 'manual' ? ' · ' : ''
              }}{{ p.count }}</small
            >
          </span>
        </button>
      </div>
    </div>

    <button
      type="button"
      class="item settings"
      :class="{
        on: String(route.name).startsWith('settings') || ['audio', 'cleanup', 'duplicates'].includes(String(route.name)),
      }"
      @click="router.push('/settings')"
    >
      <IconSettings class="ic" /><span>Настройки</span>
    </button>
  </aside>
</template>

<style scoped>
.side {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: calc(var(--safe-top) + 2px) 12px 12px;
  background: var(--surface);
  border-right: 1px solid var(--line);
}
.brand {
  font-size: 22px;
  font-weight: 700;
  color: var(--amber);
  padding: 4px 12px 14px;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
  color: var(--ink-2);
  font: 500 14.5px/1 var(--f-body);
  text-align: left;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.item:hover {
  background: var(--chip);
  color: var(--ink);
}
.item.on {
  background: rgba(var(--amber-rgb), 0.14);
  color: var(--amber-ink);
}
.ic {
  width: 22px;
  height: 22px;
  flex: none;
}
.lists {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 18px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.lists-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 6px 12px;
  color: var(--ink-3);
  font: 600 11.5px/1 var(--f-body);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.add {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--ink-2);
}
.add:hover {
  background: var(--chip);
  color: var(--ink);
}
.add svg {
  width: 18px;
  height: 18px;
}
.list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pl {
  display: grid;
  grid-template-columns: 34px 1fr;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 9px;
  text-align: left;
  font-size: 13.5px;
  color: var(--ink);
}
.pl:hover {
  background: var(--chip);
}
.pl.on {
  background: var(--chip-strong);
}
.cv {
  width: 34px;
  height: 34px;
}
.fav {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--heart), var(--ember));
  color: #fff;
}
.fav svg {
  width: 17px;
  height: 17px;
}
.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}
.text small {
  color: var(--ink-3);
  font-size: 11.5px;
}
.settings {
  margin-top: 8px;
}
</style>
