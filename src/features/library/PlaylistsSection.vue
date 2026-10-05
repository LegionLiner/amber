<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import IconAdd from '~icons/solar/add-circle-linear'
import IconList from '~icons/solar/playlist-linear'
import IconSmart from '~icons/solar/filter-linear'
import IconMix from '~icons/solar/transfer-horizontal-linear'
import IconStar from '~icons/solar/star-shine-linear'
import IconFolderAdd from '~icons/solar/add-folder-linear'
import IconFolder from '~icons/solar/folder-linear'
import IconFolderOpen from '~icons/solar/folder-open-linear'
import IconChevron from '~icons/solar/alt-arrow-right-linear'
import IconPin from '~icons/solar/pin-bold'
import NewPlaylistSheet from './NewPlaylistSheet.vue'
import { useRadio } from '@/stores/radio'
import HeadSpace from '@/components/HeadSpace.vue'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { AUTO_PLAYLISTS } from '@/domain/auto'
import { coverGradient } from '@/domain/palette'
import { countLabel } from '@/domain/format'
import CoverArt from '@/components/CoverArt.vue'
import { useLongPress } from '@/composables/useLongPress'
import { createGroupDialog, openGroupMenu, openPlaylistMenu } from './playlistMenu'
import type { PlaylistRow } from '@/data/repos/playlists'
import { onPageShown } from '@/app/paging'

const playlists = usePlaylists()
const ui = useUi()
const router = useRouter()
const scrollEl = ref<HTMLElement | null>(null)

onMounted(() => void playlists.refresh())
onPageShown(() => void playlists.refresh())
watch(
  () => ui.reselect,
  (r) => r.tab === 'library' && scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' }),
)

const radio = useRadio()
/** Удержание на плейлисте — его меню (то же, что ⋯ на странице плейлиста) */
const hold = useLongPress()

function create() {
  ui.openSheet(NewPlaylistSheet)
}

const sub = (p: PlaylistRow) =>
  p.kind === 'smart'
    ? 'умный, собирается сам'
    : `${p.kind === 'mix' ? 'микс · ' : ''}${countLabel(p.count, ['трек', 'трека', 'треков'])}`

async function highlights() {
  const n = await radio.startHighlights()
  if (!n) ui.toast('Отметь в треках «лучшие моменты» (звезда в метках), и здесь они зазвучат подряд', undefined, 5000)
  else ui.fullPlayer = true
}
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <HeadSpace />

    <div class="section-title"><span>Мои плейлисты</span></div>
    <button type="button" class="row" @click="create">
      <span class="ic add"><IconAdd /></span><span class="t">Создать</span>
    </button>
    <button type="button" class="row" @click="createGroupDialog()">
      <span class="ic add"><IconFolderAdd /></span><span class="t">Новая группа</span>
    </button>

    <!-- Закреплённые: сверху, своим порядком. Порядок — «Выше» / «Ниже» в меню по удержанию -->
    <template v-if="playlists.tree.pinned.length">
      <div class="sub-head"><IconPin />Закреплённые</div>
      <button
        v-for="p in playlists.tree.pinned"
        :key="p.id"
        type="button"
        class="row"
        v-bind="hold(() => openPlaylistMenu(p, router))"
        @click="router.push(`/playlist/${p.id}`)"
      >
        <CoverArt v-if="p.cover" :art="p.cover" :seed="p.name" :label="p.name" size="s" radius="12px" class="pcv" />
        <span v-else class="ic"
          ><IconSmart v-if="p.kind === 'smart'" /><IconMix v-else-if="p.kind === 'mix'" /><IconList v-else
        /></span>
        <span class="text">
          <span class="t ellipsis">{{ p.name }}</span>
          <span class="s">{{ sub(p) }}</span>
        </span>
      </button>
      <div class="divider" />
    </template>

    <template v-for="n in playlists.tree.root" :key="n.key">
      <template v-if="n.type === 'group'">
        <button
          type="button"
          class="row grp"
          :class="{ open: !playlists.isCollapsed(n.group.createdAt) }"
          :aria-expanded="!playlists.isCollapsed(n.group.createdAt)"
          v-bind="hold(() => openGroupMenu(n.group, router))"
          @click="playlists.setCollapsed(n.group.createdAt, !playlists.isCollapsed(n.group.createdAt))"
        >
          <span class="ic folder"
            ><component :is="playlists.isCollapsed(n.group.createdAt) ? IconFolder : IconFolderOpen"
          /></span>
          <span class="text">
            <span class="t ellipsis">{{ n.group.name }}</span>
            <span class="s">{{ countLabel(n.items.length, ['плейлист', 'плейлиста', 'плейлистов']) }}</span>
          </span>
          <IconChevron class="chev" />
        </button>
        <div v-if="!playlists.isCollapsed(n.group.createdAt)" class="grp-items">
          <button
            v-for="p in n.items"
            :key="p.id"
            type="button"
            class="row"
            v-bind="hold(() => openPlaylistMenu(p, router))"
            @click="router.push(`/playlist/${p.id}`)"
          >
            <CoverArt v-if="p.cover" :art="p.cover" :seed="p.name" :label="p.name" size="s" radius="12px" class="pcv" />
            <span v-else class="ic"
              ><IconSmart v-if="p.kind === 'smart'" /><IconMix v-else-if="p.kind === 'mix'" /><IconList v-else
            /></span>
            <span class="text">
              <span class="t ellipsis">{{ p.name }}</span>
              <span class="s">{{ sub(p) }}</span>
            </span>
          </button>
          <p v-if="!n.items.length" class="note muted">Пусто: удержи плейлист → «В группу…»</p>
        </div>
      </template>
      <button
        v-else
        type="button"
        class="row"
        v-bind="hold(() => openPlaylistMenu(n.p, router))"
        @click="router.push(`/playlist/${n.p.id}`)"
      >
        <CoverArt v-if="n.p.cover" :art="n.p.cover" :seed="n.p.name" :label="n.p.name" size="s" radius="12px" class="pcv" />
        <span v-else class="ic"
          ><IconSmart v-if="n.p.kind === 'smart'" /><IconMix v-else-if="n.p.kind === 'mix'" /><IconList v-else
        /></span>
        <span class="text">
          <span class="t ellipsis">{{ n.p.name }}</span>
          <span class="s">{{ sub(n.p) }}</span>
        </span>
      </button>
    </template>
    <p v-if="playlists.loaded && !playlists.list.length" class="note muted">
      Плейлист можно собрать из любого списка: долгое нажатие на трек → «Добавить в плейлист».
    </p>

    <div class="section-title"><span>Подборки</span><span class="muted hint">собираются сами</span></div>
    <div class="autos">
      <button
        v-for="a in AUTO_PLAYLISTS"
        :key="a.id"
        type="button"
        class="auto"
        :style="{ background: coverGradient(a.title) }"
        @click="router.push(`/auto/${a.id}`)"
      >
        <b>{{ a.title }}</b>
        <small>{{ a.hint }}</small>
      </button>
    </div>

    <button type="button" class="row" @click="highlights">
      <span class="ic hl"><IconStar /></span>
      <span class="text">
        <span class="t">Лучшие моменты</span>
        <span class="s">Отмеченные отрывки подряд, с переходами</span>
      </span>
    </button>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.hint {
  font-size: 12.5px;
  font-weight: 500;
}
.autos {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 0 var(--gutter);
}
.auto {
  min-height: 84px;
  padding: 12px 14px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 3px;
  text-align: left;
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.auto b {
  font: 600 14.5px/1.2 var(--f-body);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.3);
}
.auto small {
  font-size: 11.5px;
  opacity: 0.85;
}
.row {
  width: 100%;
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 14px;
  align-items: center;
  padding: 7px var(--gutter);
  text-align: left;
}
.row:active {
  background: var(--surface);
}
.ic {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--surface-2);
  color: var(--ink-2);
}
.pcv {
  width: 48px;
}
.ic.add,
.ic.hl {
  color: var(--amber-ink);
}
.ic.hl {
  background: rgba(var(--amber-rgb), 0.14);
}
.ic svg {
  width: 24px;
  height: 24px;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.t {
  font: 500 15px/1.25 var(--f-body);
}
.s {
  font-size: 12.5px;
  color: var(--ink-2);
}
.sub-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px var(--gutter) 4px;
  color: var(--ink-3);
  font: 600 11.5px/1 var(--f-body);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.sub-head svg {
  width: 13px;
  height: 13px;
  color: var(--amber-ink);
}
.divider {
  height: 1px;
  margin: 6px var(--gutter);
  background: var(--line);
}
.grp {
  grid-template-columns: 48px 1fr 18px;
}
.ic.folder {
  color: var(--amber-ink);
  background: rgba(var(--amber-rgb), 0.12);
}
.chev {
  width: 18px;
  height: 18px;
  color: var(--ink-3);
  transition: transform var(--t-fast) var(--ease);
}
.grp.open .chev {
  transform: rotate(90deg);
}
.grp-items {
  margin-left: calc(var(--gutter) + 22px);
  border-left: 1px solid var(--line);
}
.grp-items .row {
  padding-left: 12px;
}
.grp-items .note {
  padding-left: 12px;
}
.note {
  padding: 8px var(--gutter);
  font-size: 13px;
  line-height: 1.45;
}
</style>
