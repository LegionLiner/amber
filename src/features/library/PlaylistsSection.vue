<script setup lang="ts">
import { onActivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import IconAdd from '~icons/solar/add-circle-linear'
import IconList from '~icons/solar/playlist-linear'
import IconSmart from '~icons/solar/filter-linear'
import IconMix from '~icons/solar/transfer-horizontal-linear'
import IconStar from '~icons/solar/star-shine-linear'
import NewPlaylistSheet from './NewPlaylistSheet.vue'
import { useRadio } from '@/stores/radio'
import LibraryHeader from './LibraryHeader.vue'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { AUTO_PLAYLISTS } from '@/domain/auto'
import { coverGradient } from '@/domain/palette'
import { countLabel } from '@/domain/format'

const playlists = usePlaylists()
const ui = useUi()
const router = useRouter()
const scrollEl = ref<HTMLElement | null>(null)

onMounted(() => void playlists.refresh())
onActivated(() => void playlists.refresh())
watch(
  () => ui.reselect,
  (r) => r.tab === 'library' && scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' }),
)

const radio = useRadio()

function create() {
  ui.openSheet(NewPlaylistSheet)
}

async function highlights() {
  const n = await radio.startHighlights()
  if (!n) ui.toast('Отметь в треках «лучшие моменты» (звезда в метках), и здесь они зазвучат подряд', undefined, 5000)
  else ui.fullPlayer = true
}
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <LibraryHeader section="playlists" />

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

    <div class="section-title"><span>Мои плейлисты</span></div>
    <button type="button" class="row" @click="create">
      <span class="ic add"><IconAdd /></span><span class="t">Создать</span>
    </button>
    <button v-for="p in playlists.list" :key="p.id" type="button" class="row" @click="router.push(`/playlist/${p.id}`)">
      <span class="ic"><IconSmart v-if="p.kind === 'smart'" /><IconMix v-else-if="p.kind === 'mix'" /><IconList v-else /></span>
      <span class="text">
        <span class="t ellipsis">{{ p.name }}</span>
        <span class="s">{{
          p.kind === 'smart'
            ? 'умный, собирается сам'
            : `${p.kind === 'mix' ? 'микс · ' : ''}${countLabel(p.count, ['трек', 'трека', 'треков'])}`
        }}</span>
      </span>
    </button>
    <p v-if="playlists.loaded && !playlists.list.length" class="note muted">
      Плейлист можно собрать из любого списка: долгое нажатие на трек → «Добавить в плейлист».
    </p>
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
.note {
  padding: 8px var(--gutter);
  font-size: 13px;
  line-height: 1.45;
}
</style>
