<script setup lang="ts">
import { onMounted, ref } from 'vue'
import IconAdd from '~icons/solar/add-circle-linear'
import IconPen from '~icons/solar/pen-linear'
import IconTrash from '~icons/solar/trash-bin-minimalistic-linear'
import IconStar from '~icons/solar/star-bold'
import IconStarO from '~icons/solar/star-linear'
import NameSheet from '@/components/NameSheet.vue'
import { addBookmark, bookmarksFor, deleteBookmark, renameBookmark, setBookmarkKind, type Bookmark } from '@/data/repos/bookmarks'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { formatDuration } from '@/domain/format'
import { haptic } from '@/native/haptics'

/**
 * Метки внутри трека. Тап по метке перематывает к ней.
 * Звезда отмечает «лучший момент»: он звучит в дуэлях и в режиме «Хайлайты».
 */
const props = defineProps<{ trackKey: string; title: string; onChanged?: () => void }>()
const emit = defineEmits<{ close: [] }>()
const player = usePlayer()
const ui = useUi()
const list = ref<Bookmark[]>([])
const posAtOpen = ref(player.position)

async function reload() {
  list.value = await bookmarksFor(props.trackKey)
  props.onChanged?.()
}
onMounted(reload)

const isCurrent = () => player.current?.key === props.trackKey

async function add() {
  const pos = isCurrent() ? player.position : posAtOpen.value
  await addBookmark(props.trackKey, pos, `Метка ${formatDuration(pos)}`)
  haptic.success()
  await reload()
}

function jump(b: Bookmark) {
  if (!isCurrent()) return
  void player.seek(b.positionMs)
  emit('close')
}

function rename(b: Bookmark) {
  ui.openSheet(NameSheet, {
    title: 'Название метки',
    initial: b.title,
    confirm: 'Сохранить',
    onDone: async (v: string) => {
      await renameBookmark(b.id, v)
      props.onChanged?.()
    },
  })
}

async function toggleBest(b: Bookmark) {
  await setBookmarkKind(b.id, b.kind === 'best' ? 'mark' : 'best')
  await reload()
}

async function remove(b: Bookmark) {
  await deleteBookmark(b.id)
  await reload()
}
</script>

<template>
  <div class="scroll body">
    <h3 class="head ellipsis">Метки · {{ title }}</h3>
    <button type="button" class="add" @click="add">
      <IconAdd />Поставить метку на {{ formatDuration(isCurrent() ? player.position : posAtOpen) }}
    </button>
    <div v-for="b in list" :key="b.id" class="row">
      <button type="button" class="main" @click="jump(b)">
        <span class="time num">{{ formatDuration(b.positionMs) }}</span>
        <span class="t ellipsis">{{ b.title }}</span>
      </button>
      <button type="button" class="ic" :class="{ best: b.kind === 'best' }" aria-label="Лучший момент" @click="toggleBest(b)">
        <IconStar v-if="b.kind === 'best'" /><IconStarO v-else />
      </button>
      <button type="button" class="ic" aria-label="Переименовать" @click="rename(b)"><IconPen /></button>
      <button type="button" class="ic" aria-label="Удалить" @click="remove(b)"><IconTrash /></button>
    </div>
    <p v-if="!list.length" class="note muted">Меток пока нет. Отметь припев, соло или момент, ради которого включаешь трек.</p>
  </div>
</template>

<style scoped>
.head {
  padding: 0 var(--gutter) 8px;
  font: 600 17px/1.2 var(--f-body);
}
.add {
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% - 2 * var(--gutter));
  margin: 0 var(--gutter) 8px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(var(--amber-rgb), 0.12);
  color: var(--amber-ink);
  font: 600 14.5px/1.2 var(--f-body);
}
.add svg {
  width: 22px;
  height: 22px;
}
.row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: center;
  padding: 0 8px 0 var(--gutter);
  min-height: 52px;
}
.main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  text-align: left;
  height: 100%;
}
.time {
  font: 600 13px/1 var(--f-body);
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--surface-2);
}
.t {
  font: 500 15px/1.2 var(--f-body);
}
.ic {
  width: 40px;
  height: 44px;
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.ic svg {
  width: 20px;
  height: 20px;
}
.ic.best {
  color: var(--amber);
}
.note {
  padding: 8px var(--gutter);
  font-size: 13px;
  line-height: 1.45;
}
</style>
