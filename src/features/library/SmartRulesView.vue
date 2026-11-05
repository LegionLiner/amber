<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import IconTrash from '~icons/solar/trash-bin-minimalistic-linear'
import ScreenHeader from '@/components/ScreenHeader.vue'
import { useLibrary } from '@/stores/library'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { renamePlaylist, saveRules } from '@/data/repos/playlists'
import { applyRules, DEFAULT_RULES, FIELD_LABEL, parseRules, type Condition, type SmartRules } from '@/domain/smart'
import { TRACK_SORTS } from '@/domain/sort'
import { countLabel } from '@/domain/format'
import { $t, $tp } from '@/i18n'

/**
 * Условия умного плейлиста. Сверху — сколько треков подходит прямо сейчас,
 * чтобы видеть результат, пока крутишь условия.
 */
const route = useViewRoute()
const router = useRouter()
const library = useLibrary()
const playlists = usePlaylists()
const ui = useUi()
const id = computed(() => Number(route.params.id))

const name = ref('')
const rules = reactive<SmartRules>(structuredClone(DEFAULT_RULES))

onMounted(async () => {
  if (!playlists.loaded) await playlists.refresh()
  const p = playlists.list.find((x) => x.id === id.value)
  if (!p) return
  name.value = p.name
  Object.assign(rules, parseRules(p.rules))
})

const preview = computed(() => applyRules(library.tracks, rules))

type Kind = 'text' | 'num' | 'rating' | 'favorite' | 'date'
const FIELDS: { id: Condition['field']; kind: Kind }[] = [
  { id: 'rating', kind: 'rating' },
  { id: 'favorite', kind: 'favorite' },
  { id: 'plays', kind: 'num' },
  { id: 'skips', kind: 'num' },
  { id: 'lastPlayed', kind: 'date' },
  { id: 'added', kind: 'date' },
  { id: 'artist', kind: 'text' },
  { id: 'album', kind: 'text' },
  { id: 'genre', kind: 'text' },
  { id: 'title', kind: 'text' },
  { id: 'folder', kind: 'text' },
  { id: 'year', kind: 'num' },
  { id: 'duration', kind: 'num' },
  { id: 'bpm', kind: 'num' },
  { id: 'energy', kind: 'num' },
]
const kindOf = (f: Condition['field']) => FIELDS.find((x) => x.id === f)!.kind

function fresh(field: Condition['field']): Condition {
  switch (kindOf(field)) {
    case 'text':
      return { field: field as 'artist', op: 'contains', value: '' }
    case 'rating':
      return { field: 'rating', op: 'gte', value: 8 }
    case 'favorite':
      return { field: 'favorite', op: 'is' }
    case 'date':
      return { field: field as 'added', op: 'within', days: 30 }
    default:
      return {
        field: field as 'plays',
        op: 'gte',
        value: field === 'year' ? 2020 : field === 'bpm' ? 120 : field === 'energy' ? 60 : 5,
      }
  }
}

function setField(i: number, field: Condition['field']) {
  rules.conditions[i] = fresh(field)
}
function add() {
  rules.conditions.push(fresh('plays'))
}
function remove(i: number) {
  rules.conditions.splice(i, 1)
}
/** Операции для поля — подписи по-человечески */
function ops(c: Condition): { id: string; label: string }[] {
  switch (kindOf(c.field)) {
    case 'text':
      return [
        { id: 'contains', label: $t('содержит') },
        { id: 'is', label: $t('равно') },
        { id: 'not', label: $t('не содержит') },
      ]
    case 'rating':
      return [
        { id: 'gte', label: $t('от') },
        { id: 'lte', label: $t('до') },
        { id: 'eq', label: $t('ровно') },
        { id: 'unrated', label: $t('без оценки') },
      ]
    case 'favorite':
      return [
        { id: 'is', label: $t('в избранном') },
        { id: 'not', label: $t('не в избранном') },
      ]
    case 'date':
      return c.field === 'lastPlayed'
        ? [
            { id: 'within', label: $t('за последние') },
            { id: 'notWithin', label: $t('давно, больше') },
            { id: 'never', label: $t('никогда') },
          ]
        : [
            { id: 'within', label: $t('за последние') },
            { id: 'notWithin', label: $t('раньше, чем') },
          ]
    default:
      return [
        { id: 'gte', label: $t('от') },
        { id: 'lte', label: $t('до') },
        { id: 'eq', label: $t('ровно') },
      ]
  }
}
function setOp(i: number, op: string) {
  const c = rules.conditions[i]! as unknown as Record<string, unknown>
  c.op = op
  if ((op === 'gte' || op === 'lte' || op === 'eq') && c.value == null) c.value = c.field === 'rating' ? 8 : 5
  if ((op === 'within' || op === 'notWithin') && c.days == null) c.days = 30
}

const busy = ref(false)
async function save() {
  busy.value = true
  try {
    await saveRules(id.value, JSON.stringify(rules))
    if (name.value.trim()) await renamePlaylist(id.value, name.value.trim())
    await playlists.refresh()
    ui.toast($t('Сохранено: {0}', countLabel(preview.value.length, $tp('трек|трека|треков'))))
    router.back()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="scroll screen form">
    <ScreenHeader
      :title="$t('Условия')"
      :subtitle="$t('Подходит сейчас: {0}', countLabel(preview.length, $tp('трек|трека|треков')))"
      back
    />
    <section class="group">
      <input id="smart-name" v-model="name" class="field" :placeholder="$t('Название')" />
      <div class="seg">
        <button type="button" :class="{ on: rules.match === 'all' }" @click="rules.match = 'all'">{{ $t('Все условия') }}</button>
        <button type="button" :class="{ on: rules.match === 'any' }" @click="rules.match = 'any'">
          {{ $t('Любое из них') }}
        </button>
      </div>
    </section>

    <section v-for="(c, i) in rules.conditions" :key="i" class="group cond">
      <div class="line">
        <select
          :id="`cf-${i}`"
          class="select wide"
          :value="c.field"
          @change="setField(i, ($event.target as HTMLSelectElement).value as Condition['field'])"
        >
          <option v-for="f in FIELDS" :key="f.id" :value="f.id">{{ FIELD_LABEL[f.id] }}</option>
        </select>
        <button type="button" class="icon-btn" :aria-label="$t('Убрать условие')" @click="remove(i)"><IconTrash /></button>
      </div>
      <div class="line">
        <select :id="`co-${i}`" class="select wide" :value="c.op" @change="setOp(i, ($event.target as HTMLSelectElement).value)">
          <option v-for="o in ops(c)" :key="o.id" :value="o.id">{{ o.label }}</option>
        </select>
        <template v-if="'value' in c">
          <select v-if="c.field === 'rating'" :id="`cv-${i}`" v-model.number="c.value" class="select">
            <option v-for="r in 10" :key="r" :value="r">{{ r % 2 ? `${Math.floor(r / 2)}½★` : `${r / 2}★` }}</option>
          </select>
          <input
            v-else-if="typeof c.value === 'string'"
            :id="`cv-${i}`"
            v-model="c.value"
            class="field"
            :placeholder="$t('текст')"
          />
          <input v-else :id="`cv-${i}`" v-model.number="c.value" class="field num-in" inputmode="decimal" />
        </template>
        <template v-else-if="'days' in c">
          <input :id="`cd-${i}`" v-model.number="c.days" class="field num-in" inputmode="numeric" /><span class="unit">{{
            $t('дн.')
          }}</span>
        </template>
      </div>
    </section>

    <section class="group">
      <button type="button" class="btn block" @click="add">{{ $t('Добавить условие') }}</button>
      <label class="row">
        <span
          ><b>{{ $t('Сортировка') }}</b></span
        >
        <select
          id="smart-sort"
          class="select"
          :value="rules.sort.key"
          @change="
            rules.sort = {
              key: ($event.target as HTMLSelectElement).value as SmartRules['sort']['key'],
              dir: TRACK_SORTS.find((s) => s.key === ($event.target as HTMLSelectElement).value)!.dir,
            }
          "
        >
          <option v-for="s in TRACK_SORTS" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </label>
      <label class="row">
        <span
          ><b>{{ $t('Не больше') }}</b
          ><small>{{ $t('Пусто — без ограничения') }}</small></span
        >
        <select id="smart-limit" v-model="rules.limit" class="select">
          <option :value="null">{{ $t('все') }}</option>
          <option v-for="n in [25, 50, 100, 200, 500]" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
      <button type="button" class="btn primary block" :disabled="busy" @click="save">{{ $t('Сохранить') }}</button>
    </section>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.cond {
  gap: 8px;
}
.line {
  display: flex;
  gap: 8px;
  align-items: center;
}
.wide {
  flex: 1;
  max-width: none;
  height: 44px;
}
.num-in {
  width: 96px;
  flex: none;
}
.unit {
  color: var(--ink-2);
  font-size: 13px;
}
</style>
