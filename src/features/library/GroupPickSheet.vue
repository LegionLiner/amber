<script setup lang="ts">
import IconFolder from '~icons/solar/folder-linear'
import IconOut from '~icons/solar/list-linear'
import IconAdd from '~icons/solar/add-folder-linear'
import IconCheck from '~icons/solar/check-circle-bold'
import NameSheet from '@/components/NameSheet.vue'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import type { PlaylistRow } from '@/data/repos/playlists'
import { $t } from '@/i18n'

/** «В группу…»: выбрать группу для плейлиста, убрать из группы или завести новую */
const props = defineProps<{ playlist: PlaylistRow }>()
const emit = defineEmits<{ close: [] }>()
const playlists = usePlaylists()
const ui = useUi()

const inNoGroup = () => props.playlist.groupAt == null || !playlists.groups.some((g) => g.createdAt === props.playlist.groupAt)

async function pick(groupAt: number | null) {
  emit('close')
  if (groupAt === props.playlist.groupAt) return
  await playlists.moveToGroup(props.playlist, groupAt)
  const g = playlists.groups.find((x) => x.createdAt === groupAt)
  ui.toast(g ? $t('«{0}» в группе «{1}»', props.playlist.name, g.name) : $t('«{0}» вне групп', props.playlist.name))
}

function create() {
  ui.openSheet(NameSheet, {
    title: $t('Новая группа'),
    initial: '',
    confirm: $t('Создать'),
    onDone: async (name: string) => {
      const at = await playlists.addGroup(name)
      await pick(at)
    },
  })
}
</script>

<template>
  <div class="body">
    <h3 class="head ellipsis">{{ $t('В группу: {0}', playlist.name) }}</h3>
    <button v-for="g in playlists.groups" :key="g.createdAt" type="button" class="act" @click="pick(g.createdAt)">
      <IconFolder /><span class="ellipsis">{{ g.name }}</span>
      <IconCheck v-if="g.createdAt === playlist.groupAt" class="on" />
    </button>
    <button type="button" class="act" @click="pick(null)">
      <IconOut /><span>{{ $t('Без группы') }}</span>
      <IconCheck v-if="inNoGroup()" class="on" />
    </button>
    <button type="button" class="act add" @click="create">
      <IconAdd /><span>{{ $t('Новая группа…') }}</span>
    </button>
  </div>
</template>

<style scoped>
.head {
  padding: 0 var(--gutter) 8px;
  font: 600 17px/1.2 var(--f-body);
}
.act {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 52px;
  padding: 0 var(--gutter);
  text-align: left;
  font: 500 15px/1.2 var(--f-body);
}
.act span {
  flex: 1;
  min-width: 0;
}
.act svg {
  width: 22px;
  height: 22px;
  flex: none;
  color: var(--ink-2);
}
.act .on {
  color: var(--amber);
}
.act.add,
.act.add svg {
  color: var(--amber-ink);
}
</style>
