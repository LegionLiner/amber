<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import IconAdd from '~icons/solar/add-circle-linear'
import IconList from '~icons/solar/playlist-linear'
import IconCheck from '~icons/solar/check-circle-bold'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { playlistsContaining } from '@/data/repos/playlists'
import { countLabel } from '@/domain/format'
import { $t, $tp } from '@/i18n'

const props = defineProps<{ keys: string[] }>()
const emit = defineEmits<{ close: [] }>()
const playlists = usePlaylists()
const ui = useUi()
const creating = ref(false)
const name = ref('')

const uniq = computed(() => [...new Set(props.keys)])
/** Сколько из добавляемых треков уже лежит в каждом плейлисте */
const have = ref(new Map<number, number>())
onMounted(async () => {
  await playlists.refresh()
  have.value = await playlistsContaining(uniq.value)
})
function state(id: number): 'all' | 'some' | 'none' {
  const n = have.value.get(id) ?? 0
  return n === 0 ? 'none' : n >= uniq.value.length ? 'all' : 'some'
}

async function add(id: number, title: string) {
  const keys = uniq.value
  if (state(id) === 'all' && keys.length === 1) {
    // Трек уже там: повторный выбор убирает его, с возможностью вернуть
    await playlists.removeTrack(id, keys[0]!)
    ui.toast($t('Убрано из «{0}»', title), { label: $t('Вернуть'), run: () => void playlists.add(id, keys) })
    emit('close')
    return
  }
  const n = await playlists.add(id, keys)
  ui.toast(
    !n
      ? $t('Уже есть в «{0}»', title)
      : n < keys.length
        ? $t('Добавлено в «{0}»: {1}, остальные там уже были', title, n)
        : $t('Добавлено в «{0}»', title),
  )
  emit('close')
}

async function create() {
  const v = name.value.trim()
  if (!v) return
  await playlists.create(v, props.keys)
  ui.toast($t('Создан плейлист «{0}»', v))
  emit('close')
}
</script>

<template>
  <div class="scroll body">
    <h3 class="head">{{ $t('Добавить в плейлист') }}</h3>
    <form v-if="creating" class="new" @submit.prevent="create">
      <input id="new-playlist-name" v-model="name" :placeholder="$t('Название плейлиста')" maxlength="80" autofocus />
      <button type="submit" class="btn primary" :disabled="!name.trim()">{{ $t('Создать') }}</button>
    </form>
    <button v-else type="button" class="row" @click="creating = true">
      <span class="ic add"><IconAdd /></span><span>{{ $t('Новый плейлист') }}</span>
    </button>
    <button
      v-for="p in playlists.list.filter((x) => x.kind !== 'smart')"
      :key="p.id"
      type="button"
      class="row"
      :class="state(p.id)"
      @click="add(p.id, p.name)"
    >
      <span class="ic"><IconList /></span>
      <span class="text">
        <span class="t ellipsis">{{ p.name }}</span>
        <span class="s">
          <b v-if="state(p.id) === 'all'" class="here">{{
            uniq.length === 1 ? $t('уже здесь · нажми, чтобы убрать') : $t('все уже здесь')
          }}</b>
          <b v-else-if="state(p.id) === 'some'" class="here">{{ $t('есть {0} из {1} ·', have.get(p.id), uniq.length) }} </b>
          <template v-if="state(p.id) !== 'all'">{{ countLabel(p.count, $tp('трек|трека|треков')) }}</template>
        </span>
      </span>
      <IconCheck v-if="state(p.id) === 'all'" class="check" />
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
  grid-template-columns: 44px 1fr auto;
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
.here {
  font-weight: 600;
  color: var(--amber-ink);
}
.check {
  width: 24px;
  height: 24px;
  color: var(--amber);
}
.row.all .ic {
  background: rgba(var(--amber-rgb), 0.14);
  color: var(--amber-ink);
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
