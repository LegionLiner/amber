<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useUi } from '@/stores/ui'
import ColorPicker from '@/components/ColorPicker.vue'
import { TINTS } from '@/domain/palette'
import { deleteEra, saveEra, type EraRow } from '@/data/repos/eras'
import { todayKey } from '@/domain/streaks'

/** Своя эпоха: название и даты. Цвет — для карточки и историй. */
const props = defineProps<{ era?: EraRow | null; onSaved?: (id: number | null) => void }>()
const emit = defineEmits<{ close: [] }>()
const ui = useUi()

const form = reactive({
  title: props.era?.title ?? '',
  startDay: props.era?.startDay ?? todayKey(new Date(Date.now() - 30 * 86_400_000)),
  endDay: props.era?.endDay ?? todayKey(),
  color: props.era?.color ?? TINTS[0]!,
  note: props.era?.note ?? '',
})
const confirmDelete = ref(false)

async function save() {
  if (!form.title.trim()) return ui.toast('Дай эпохе название')
  if (form.endDay < form.startDay) return ui.toast('Конец раньше начала')
  const id = await saveEra({
    id: props.era?.id,
    title: form.title.trim(),
    startDay: form.startDay,
    endDay: form.endDay,
    color: form.color,
    note: form.note.trim() || null,
  })
  props.onSaved?.(id)
  emit('close')
}
async function remove() {
  if (!props.era) return
  await deleteEra(props.era.id)
  props.onSaved?.(null)
  emit('close')
}
</script>

<template>
  <div class="sheet-body form">
    <h3 class="sheet-head">{{ era ? 'Эпоха' : 'Новая эпоха' }}</h3>
    <input id="era-title" v-model="form.title" class="field" placeholder="Например, «Переезд в Питер»" maxlength="60" />
    <div class="dates">
      <label><span>С</span><input id="era-from" v-model="form.startDay" type="date" class="field" /></label>
      <label><span>По</span><input id="era-to" v-model="form.endDay" type="date" class="field" /></label>
    </div>
    <ColorPicker v-model="form.color" />
    <textarea id="era-note" v-model="form.note" class="field" placeholder="Пара слов о том времени" />
    <div class="btns">
      <template v-if="era">
        <button v-if="!confirmDelete" type="button" class="btn" @click="confirmDelete = true">Удалить</button>
        <button v-else type="button" class="btn danger" @click="remove">Точно удалить</button>
      </template>
      <button type="button" class="btn primary" @click="save">Сохранить</button>
    </div>
  </div>
</template>

<style scoped>
.dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.dates label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.danger {
  color: var(--bad);
}
</style>
