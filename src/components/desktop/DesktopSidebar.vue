<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
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
import IconFolderAdd from '~icons/solar/add-folder-linear'
import IconFolder from '~icons/solar/folder-linear'
import IconFolderOpen from '~icons/solar/folder-open-linear'
import IconChevron from '~icons/solar/alt-arrow-right-linear'
import IconPin from '~icons/solar/pin-linear'
import IconList from '~icons/solar/playlist-linear'
import NameSheet from '@/components/NameSheet.vue'
import SidePlaylist from './SidePlaylist.vue'
import { useTreeDrag, type Dragged } from './useTreeDrag'
import type { TabId } from '@/app/router'
import { bootState } from '@/app/boot-state'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { createGroupDialog, openGroupMenu, openPlaylistMenu } from '@/features/library/playlistMenu'
import { pKey } from '@/domain/playlist-tree'
import type { PlaylistGroupRow, PlaylistRow } from '@/data/repos/playlists'

/**
 * Боковое меню компьютерной версии: разделы (как нижняя навигация на телефоне), плейлисты, настройки.
 * Повторное нажатие на открытый раздел — наверх и к началу, как повторный тап по вкладке.
 *
 * Плейлисты: закреплённые сверху, ниже группы (сворачиваются) и плейлисты вне групп. Всё перетаскивается
 * мышью: между собой, в группу и из неё, в закреплённые и обратно. Правый клик — меню плейлиста или группы.
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

const listEl = ref<HTMLElement | null>(null)
const listsEl = ref<HTMLElement | null>(null)
const tree = computed(() => playlists.tree)
const { drag, down, markOf, swallowed } = useTreeDrag({
  listEl,
  rootEl: listsEl,
  firstInGroup: (at) => {
    const g = tree.value.root.find((n) => n.type === 'group' && n.group.createdAt === at)
    const first = g?.type === 'group' ? g.items[0] : undefined
    return first ? pKey(first.id) : null
  },
  onDrop: (item: Dragged, drop) =>
    item.kind === 'playlist' ? playlists.place(item.p, drop) : playlists.placeGroup(item.g, drop),
})
const dragLabel = computed(() => {
  const d = drag.value?.item
  return d ? (d.kind === 'playlist' ? d.p.name : d.g.name) : ''
})
const draggingPlaylist = computed(() => drag.value?.item.kind === 'playlist')

function open(p: PlaylistRow) {
  if (swallowed()) return
  void router.push(`/playlist/${p.id}`)
}
function toggle(g: PlaylistGroupRow) {
  if (swallowed()) return
  playlists.setCollapsed(g.createdAt, !playlists.isCollapsed(g.createdAt))
}

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

    <div ref="listsEl" class="lists">
      <div class="lists-head">
        <!-- Закреплённых нет: пока тянешь плейлист, на месте заголовка — зона «закрепить» (список не сдвигается) -->
        <div v-if="draggingPlaylist && !tree.pinned.length" class="pin-target" :class="markOf('pinzone')" data-drop="pinzone">
          <IconPin />Сюда — закрепить наверху
        </div>
        <span>Плейлисты</span>
        <span class="head-btns">
          <button type="button" class="add" aria-label="Новая группа" title="Новая группа" @click="createGroupDialog()">
            <IconFolderAdd />
          </button>
          <button type="button" class="add" aria-label="Новый плейлист" title="Новый плейлист" @click="create">
            <IconAdd />
          </button>
        </span>
      </div>
      <div ref="listEl" class="scroll list" :class="{ dragging: !!drag }">
        <button
          type="button"
          class="pl"
          :class="{ on: route.path === '/library/favorites' }"
          @click="router.push('/library/favorites')"
        >
          <span class="fav"><IconHeart /></span>
          <span class="ellipsis">Избранное</span>
        </button>

        <!-- закреплённые: пока тянешь плейлист, зона видна, даже если пустая -->
        <div v-if="tree.pinned.length" class="pinbox" :class="markOf('pinzone')" data-drop="pinzone">
          <div class="sub-head"><IconPin />Закреплённые</div>
          <button
            v-for="p in tree.pinned"
            :key="p.id"
            type="button"
            class="pl"
            :class="[{ on: openPlaylist === p.id }, markOf(`p:${p.id}`)]"
            data-drop="row"
            data-zone="pinned"
            :data-key="`p:${p.id}`"
            @pointerdown="down($event, { kind: 'playlist', p })"
            @click="open(p)"
            @contextmenu.prevent="openPlaylistMenu(p, router)"
          >
            <SidePlaylist :p="p" pinned />
          </button>
        </div>

        <template v-for="n in tree.root" :key="n.key">
          <template v-if="n.type === 'group'">
            <div
              class="grp"
              :class="[markOf(n.key), { open: !playlists.isCollapsed(n.group.createdAt) }]"
              role="button"
              tabindex="0"
              data-drop="group"
              :data-key="n.key"
              :data-group="n.group.createdAt"
              :aria-expanded="!playlists.isCollapsed(n.group.createdAt)"
              @pointerdown="down($event, { kind: 'group', g: n.group })"
              @click="toggle(n.group)"
              @keydown.enter="toggle(n.group)"
              @contextmenu.prevent="openGroupMenu(n.group, router)"
            >
              <IconChevron class="chev" />
              <component :is="playlists.isCollapsed(n.group.createdAt) ? IconFolder : IconFolderOpen" class="gic" />
              <span class="ellipsis gname">{{ n.group.name }}</span>
              <small>{{ n.items.length }}</small>
            </div>
            <div v-if="!playlists.isCollapsed(n.group.createdAt)" class="grp-items">
              <button
                v-for="p in n.items"
                :key="p.id"
                type="button"
                class="pl"
                :class="[{ on: openPlaylist === p.id }, markOf(`p:${p.id}`)]"
                data-drop="row"
                data-zone="group"
                :data-group="n.group.createdAt"
                :data-key="`p:${p.id}`"
                @pointerdown="down($event, { kind: 'playlist', p })"
                @click="open(p)"
                @contextmenu.prevent="openPlaylistMenu(p, router)"
              >
                <SidePlaylist :p="p" />
              </button>
              <div v-if="!n.items.length" class="grp-empty" data-drop="group-end" :data-group="n.group.createdAt">
                Перетащи сюда плейлисты
              </div>
            </div>
          </template>
          <button
            v-else
            type="button"
            class="pl"
            :class="[{ on: openPlaylist === n.p.id }, markOf(n.key)]"
            data-drop="row"
            data-zone="root"
            :data-key="n.key"
            @pointerdown="down($event, { kind: 'playlist', p: n.p })"
            @click="open(n.p)"
            @contextmenu.prevent="openPlaylistMenu(n.p, router)"
          >
            <SidePlaylist :p="n.p" />
          </button>
        </template>
        <div class="end" :class="markOf('end')" data-drop="end" />
      </div>
      <Teleport to="body">
        <div v-if="drag" class="tree-ghost" :style="{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }">
          <component :is="drag.item.kind === 'group' ? IconFolder : IconList" class="gh-ic" />{{ dragLabel }}
        </div>
      </Teleport>
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
.head-btns {
  display: flex;
  gap: 2px;
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
  position: relative;
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
.list.dragging .pl:hover:not(.on) {
  background: transparent;
}
/* ---- закреплённые ---- */
.pinbox {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 6px 0 4px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.sub-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 4px 12px;
  color: var(--ink-3);
  font: 600 11px/1 var(--f-body);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.sub-head svg {
  width: 13px;
  height: 13px;
}
.lists-head {
  position: relative;
}
.pin-target {
  position: absolute;
  inset: -6px 0 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1.5px dashed var(--line-strong);
  border-radius: 9px;
  background: var(--surface);
  color: var(--ink-2);
  font: 600 12px/1 var(--f-body);
  text-transform: none;
  letter-spacing: 0;
}
.pin-target svg {
  width: 14px;
  height: 14px;
}
.pin-target.drop-zone {
  border-color: var(--amber);
  color: var(--amber-ink);
  background: color-mix(in srgb, var(--amber) 12%, var(--surface));
}
.pinbox.drop-zone {
  border-radius: 10px;
  background: rgba(var(--amber-rgb), 0.08);
  box-shadow: inset 0 0 0 1.5px var(--amber);
}
.grp:focus:not(:focus-visible) {
  outline: none;
}
/* ---- группы ---- */
.grp {
  display: grid;
  grid-template-columns: 14px 20px 1fr auto;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px 0 6px;
  border-radius: 9px;
  color: var(--ink);
  font: 600 13.5px/1 var(--f-body);
  cursor: pointer;
  user-select: none;
}
.grp:hover {
  background: var(--chip);
}
.grp small {
  color: var(--ink-3);
  font: 500 11.5px/1 var(--f-body);
}
.chev {
  width: 14px;
  height: 14px;
  color: var(--ink-3);
  transition: transform var(--t-fast) var(--ease);
}
.grp.open .chev {
  transform: rotate(90deg);
}
.gic {
  width: 20px;
  height: 20px;
  color: var(--amber-ink);
}
.grp-items {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-left: 14px;
  padding-left: 6px;
  border-left: 1px solid var(--line);
}
.grp-empty {
  margin: 2px 0 4px;
  padding: 8px 10px;
  color: var(--ink-3);
  font-size: 12px;
}
.end {
  flex: 1;
  min-height: 48px;
  border-radius: 9px;
}
/* ---- перетаскивание ---- */
.lifted {
  opacity: 0.4;
}
.drop-before::before,
.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 2px;
  background: var(--amber);
  box-shadow: 0 0 8px rgba(var(--amber-rgb), 0.6);
  pointer-events: none;
}
.drop-before::before {
  top: -1.5px;
}
.drop-after::after {
  bottom: -1.5px;
}
.grp {
  position: relative;
}
.grp.drop-into {
  background: rgba(var(--amber-rgb), 0.16);
  box-shadow: inset 0 0 0 1.5px var(--amber);
}
.end.drop-zone {
  box-shadow: inset 0 2px 0 var(--amber);
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
.settings {
  margin-top: 8px;
}
</style>

<style>
/* Призрак перетаскиваемого плейлиста или группы — над всем окном */
.tree-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 240px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  color: var(--ink);
  font: 600 13px/1.2 var(--f-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
.tree-ghost .gh-ic {
  width: 16px;
  height: 16px;
  flex: none;
  color: var(--amber-ink);
}
:root.tree-dragging,
:root.tree-dragging * {
  cursor: grabbing !important;
  user-select: none !important;
}
</style>
