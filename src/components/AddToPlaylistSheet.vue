<script setup lang="ts">
import { onMounted, ref } from 'vue'
import IconAdd from '~icons/solar/add-circle-linear'
import IconList from '~icons/solar/playlist-linear'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { countLabel } from '@/domain/format'

const props = defineProps<{ keys: string[] }>()
const emit = defineEmits<{ close: [] }>()
const playlists = usePlaylists()
const ui = useUi()
const creating = ref(false)
const name = ref('')

onMounted(() => void playlists.refresh())

async function add(id: number, title: string) {
  const n = await playlists.add(id, props.keys)
  ui.toast(n ? `Добавлено в «${title}»` : `Уже есть в «${title}»`)
  emit('close')
}

async function create() {
  const v = name.value.trim()
  if (!v) return
  await playlists.create(v, props.keys)
  ui.toast(`Создан плейлист «${v}»`)
  emit('close')
}
</script>

<template>
  <div class="scroll body">
    <h3 class="head">Добавить в плейлист</h3>
    <form v-if="creating" class="new" @submit.prevent="create">
      <input id="new-playlist-name" v-model="name" placeholder="Название плейлиста" maxlength="80" autofocus />
      <button type="submit" class="btn primary" :disabled="!name.trim()">Создать</button>
    </form>
    <button v-else type="button" class="row" @click="creating = true">
      <span class="ic add"><IconAdd /></span><span>Новый плейлист</span>
    </button>
    <button
      v-for="p in playlists.list.filter((x) => x.kind !== 'smart')"
      :key="p.id"
      type="button"
      class="row"
      @click="add(p.id, p.name)"
    >
      <span class="ic"><IconList /></span>
      <span class="text">
        <span class="t ellipsis">{{ p.name }}</span>
        <span class="s">{{ countLabel(p.count, ['трек', 'трека', 'треков']) }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.head {
  padding: 0 var(--gutter) 8px;
  font: 600 17px/1.2 var(--f-body);
}
.row {
  width: 100%;
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 14px;
  align-items: center;
  min-height: 60px;
  padding: 6px var(--gutter);
  text-align: left;
  font: 500 15px/1.2 var(--f-body);
}
.row:active {
  background: var(--chip);
}
.ic {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--surface-2);
  color: var(--ink-2);
}
.ic.add {
  color: var(--amber-ink);
}
.ic svg {
  width: 22px;
  height: 22px;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.s {
  font-size: 12.5px;
  color: var(--ink-2);
  font-weight: 400;
}
.new {
  display: flex;
  gap: 8px;
  padding: 4px var(--gutter) 10px;
}
.new input {
  flex: 1;
  min-width: 0;
  height: 46px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  font-size: 15px;
}
</style>
