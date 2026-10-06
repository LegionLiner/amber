<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import IconBack from '~icons/solar/alt-arrow-left-linear'
import IconForward from '~icons/solar/alt-arrow-right-linear'
import IconSearch from '~icons/solar/magnifer-linear'
import IconPanel from '~icons/solar/sidebar-minimalistic-linear'
import IconClose from '~icons/solar/close-circle-bold'
import { GLOBAL_SEARCH_ID, searchQuery } from '@/app/search-query'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { usePlayer } from '@/stores/player'

/**
 * Строка заголовка окна на компьютере. За неё окно таскают (кнопки окна справа рисует Windows),
 * а место не пропадает: слева — имя приложения над меню, дальше «назад / вперёд» по экранам, поиск
 * и переключатель панели «Сейчас играет».
 *
 * Поиск здесь — настоящее поле: запрос общий с экраном поиска (app/search-query.ts), набираешь —
 * открывается раздел поиска с результатами. Второго поля на самом экране на компьютере нет.
 */
const route = useRoute()
const router = useRouter()
const settings = useSettings()
const ui = useUi()
const player = usePlayer()

// vue-router хранит в history.state соседей по истории: по ним видно, есть ли куда идти
const canBack = ref(false)
const canForward = ref(false)
watch(
  () => route.fullPath,
  () =>
    void nextTick(() => {
      const st = window.history.state as { back?: string | null; forward?: string | null } | null
      canBack.value = !!st?.back
      canForward.value = !!st?.forward
    }),
  { immediate: true },
)

const field = ref<HTMLInputElement | null>(null)
/** Начал искать (поставил курсор или набрал букву) — открывается раздел поиска, курсор остаётся в поле */
function toSearch() {
  ui.fullPlayer = false
  ui.queueOpen = false
  if (route.name !== 'search') void router.push('/search')
}
function clear() {
  searchQuery.value = ''
  field.value?.focus()
}
</script>

<template>
  <header class="tbar">
    <div class="brand display" aria-hidden="true">Amber</div>
    <div class="nav">
      <button type="button" class="tb" aria-label="Назад" title="Назад (Alt+←)" :disabled="!canBack" @click="router.back()">
        <IconBack />
      </button>
      <button
        type="button"
        class="tb"
        aria-label="Вперёд"
        title="Вперёд (Alt+→)"
        :disabled="!canForward"
        @click="router.forward()"
      >
        <IconForward />
      </button>
      <label class="find" :class="{ on: route.name === 'search' }">
        <IconSearch />
        <input
          :id="GLOBAL_SEARCH_ID"
          ref="field"
          v-model="searchQuery"
          type="search"
          enterkeyhint="search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="Трек, исполнитель, папка, заметка"
          aria-label="Поиск"
          @focus="toSearch"
          @input="toSearch"
          @keydown.esc.stop="field?.blur()"
        />
        <button v-if="searchQuery" type="button" class="clr" aria-label="Очистить" @click.prevent="clear"><IconClose /></button>
        <kbd v-else>Ctrl F</kbd>
      </label>
    </div>
    <div class="right">
      <button
        v-if="player.hasTrack"
        type="button"
        class="tb panel"
        :class="{ on: settings.s.nowPanel }"
        :aria-pressed="settings.s.nowPanel"
        aria-label="Панель «Сейчас играет»"
        title="Панель «Сейчас играет»"
        @click="settings.s.nowPanel = !settings.s.nowPanel"
      >
        <IconPanel />
      </button>
    </div>
  </header>
</template>

<style scoped>
.tbar {
  grid-column: 1 / -1;
  grid-row: 1;
  position: relative;
  z-index: 5;
  display: grid;
  grid-template-columns: var(--side-w) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--pane-gap);
  height: var(--title-h);
  /* Справа кнопки окна Windows: под них оставлено место */
  padding-right: 148px;
  -webkit-app-region: drag;
}
.brand {
  padding-left: 16px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--amber);
}
.nav {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tb,
.find {
  -webkit-app-region: no-drag;
}
.tb {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 9px;
  color: var(--ink-2);
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    transform var(--t-fast) var(--ease);
}
.tb svg {
  width: 18px;
  height: 18px;
}
.tb:hover:not(:disabled) {
  background: var(--chip);
  color: var(--ink);
}
.tb:active:not(:disabled) {
  transform: scale(0.92);
}
.tb:disabled {
  opacity: 0.32;
  cursor: default;
}
.tb.on {
  color: var(--amber-ink);
}
/* В узком окне панели «Сейчас играет» нет (ей не хватает места) — нет и её переключателя */
@media (max-width: 1299px) {
  .panel {
    display: none;
  }
}
.find {
  display: flex;
  align-items: center;
  gap: 9px;
  width: min(100%, 420px);
  height: 30px;
  margin-left: 8px;
  padding: 0 8px 0 11px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 6%, transparent);
  color: var(--ink-3);
  font: 400 13px/1 var(--f-body);
  text-align: left;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}
.find > svg {
  width: 15px;
  height: 15px;
  flex: none;
}
.find input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: none;
  color: var(--ink);
  font: 400 13px/1 var(--f-body);
}
.find input::placeholder {
  color: var(--ink-3);
}
.find input::-webkit-search-cancel-button {
  display: none;
}
.clr {
  width: 22px;
  height: 22px;
  flex: none;
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.clr svg {
  width: 16px;
  height: 16px;
}
.clr:hover {
  color: var(--ink);
}
.find kbd {
  flex: none;
  padding: 3px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ink) 8%, transparent);
  color: var(--ink-3);
  font: 500 10.5px/1 var(--f-body);
  letter-spacing: 0.02em;
}
.find {
  cursor: text;
}
.find:hover {
  background: color-mix(in srgb, var(--ink) 9%, transparent);
}
.find:focus-within {
  background: color-mix(in srgb, var(--ink) 11%, transparent);
  box-shadow: inset 0 0 0 1px rgba(var(--amber-rgb), 0.55);
  color: var(--ink-2);
}
</style>
