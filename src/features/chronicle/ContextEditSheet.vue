<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useUi } from '@/stores/ui'
import ColorPicker from '@/components/ColorPicker.vue'
import { TINTS } from '@/domain/palette'
import { usePlayer } from '@/stores/player'
import { deleteContext, saveContext, type ContextRow } from '@/data/repos/contexts'
import { outputLabel } from '@/domain/outputs'
import { CONTEXT_ICONS } from './contextIcons'

/**
 * Контекст: название, значок и (необязательно) правила — когда музыка сама к нему относится.
 * Без правил контекст включается вручную кнопкой «Начать».
 */
const props = defineProps<{ ctx?: ContextRow | null; onSaved?: () => void }>()
const emit = defineEmits<{ close: [] }>()
const ui = useUi()
const player = usePlayer()

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const form = reactive({
  title: props.ctx?.title ?? '',
  icon: props.ctx?.icon ?? 'run',
  color: props.ctx?.color ?? TINTS[0]!,
  useHours: !!props.ctx?.rules.hours,
  from: props.ctx?.rules.hours?.[0] ?? 7,
  to: props.ctx?.rules.hours?.[1] ?? 10,
  weekdays: [...(props.ctx?.rules.weekdays ?? [])],
  outputs: [...(props.ctx?.rules.outputs ?? [])],
})
const confirmDelete = ref(false)

onMounted(() => void player.refreshOutputs().catch(() => undefined))
const outputOptions = computed(() => {
  const set = new Set<string>(['bt:', 'wired', 'speaker'])
  for (const d of player.outputs?.devices ?? []) if (d.kind === 'bluetooth') set.add(`bt:${d.name}`)
  for (const o of form.outputs) set.add(o)
  return [...set]
})
const outLabel = (o: string) => (o === 'bt:' ? 'Любой Bluetooth' : outputLabel(o))

function toggle<T>(arr: T[], v: T) {
  const i = arr.indexOf(v)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(v)
}

async function save() {
  if (!form.title.trim()) return ui.toast('Дай контексту название')
  await saveContext({
    id: props.ctx?.id,
    title: form.title.trim(),
    icon: form.icon,
    color: form.color,
    rules: {
      hours: form.useHours ? [Number(form.from), Number(form.to)] : undefined,
      weekdays: form.weekdays.length ? [...form.weekdays].sort() : undefined,
      outputs: form.outputs.length ? form.outputs : undefined,
    },
  })
  props.onSaved?.()
  emit('close')
}
async function remove() {
  if (!props.ctx) return
  await deleteContext(props.ctx.id)
  props.onSaved?.()
  emit('close')
}
</script>

<template>
  <div class="sheet-body form">
    <h3 class="sheet-head">{{ ctx ? 'Контекст' : 'Новый контекст' }}</h3>
    <input id="ctx-title" v-model="form.title" class="field" placeholder="Например, «Дорога на работу»" maxlength="40" />
    <div class="icons">
      <button
        v-for="(ic, key) in CONTEXT_ICONS"
        :key="key"
        type="button"
        class="ic"
        :class="{ on: form.icon === key }"
        :style="{ '--cc': form.color }"
        @click="form.icon = String(key)"
      >
        <component :is="ic" />
      </button>
    </div>
    <ColorPicker v-model="form.color" />

    <h4 class="sub">Когда включать самому</h4>
    <label class="row">
      <span><b>По времени</b><small>Музыка в эти часы относится к контексту</small></span>
      <input id="ctx-hours" v-model="form.useHours" type="checkbox" class="switch" />
    </label>
    <div v-if="form.useHours" class="hours">
      <select id="ctx-from" v-model.number="form.from" class="select">
        <option v-for="h in 24" :key="h" :value="h - 1">с {{ h - 1 }}:00</option>
      </select>
      <select id="ctx-to" v-model.number="form.to" class="select">
        <option v-for="h in 24" :key="h" :value="h % 24">до {{ h % 24 }}:00</option>
      </select>
    </div>
    <div class="pills">
      <button
        v-for="(d, i) in WD"
        :key="d"
        type="button"
        class="pill"
        :class="{ on: form.weekdays.includes(i + 1) }"
        @click="toggle(form.weekdays, i + 1)"
      >
        {{ d }}
      </button>
    </div>
    <div class="pills">
      <button
        v-for="o in outputOptions"
        :key="o"
        type="button"
        class="pill"
        :class="{ on: form.outputs.includes(o) }"
        @click="toggle(form.outputs, o)"
      >
        {{ outLabel(o) }}
      </button>
    </div>
    <p class="note">Все выбранные условия должны совпасть. Без условий контекст запускается только вручную.</p>

    <div class="btns">
      <template v-if="ctx">
        <button v-if="!confirmDelete" type="button" class="btn" @click="confirmDelete = true">Удалить</button>
        <button v-else type="button" class="btn danger" @click="remove">Точно удалить</button>
      </template>
      <button type="button" class="btn primary" @click="save">Сохранить</button>
    </div>
  </div>
</template>

<style scoped>
.icons {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}
.ic {
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--surface-2);
  color: var(--ink-2);
}
.ic svg {
  width: 22px;
  height: 22px;
}
.ic.on {
  background: color-mix(in srgb, var(--cc) 22%, transparent);
  color: var(--cc);
}
.sub {
  font: 600 14px/1.2 var(--f-body);
  margin-top: 6px;
}
.hours {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.hours .select {
  max-width: none;
  height: 42px;
}
.danger {
  color: var(--bad);
}
</style>
