<script setup lang="ts">
import { ref, type Component } from 'vue'
import IconPen from '~icons/solar/pen-linear'
import IconTrash from '~icons/solar/trash-bin-minimalistic-linear'

const props = defineProps<{
  name: string
  onRename: () => void
  onDelete: () => void
  /** Дополнительные пункты: порядок, правила, редактор микса */
  actions?: { label: string; icon: Component; run: () => void }[]
}>()
const emit = defineEmits<{ close: [] }>()
const confirmDelete = ref(false)

function remove() {
  props.onDelete()
  emit('close')
}
</script>

<template>
  <div class="body">
    <h3 class="head ellipsis">{{ name }}</h3>
    <button v-for="a in actions ?? []" :key="a.label" type="button" class="act" @click="a.run()">
      <component :is="a.icon" />{{ a.label }}
    </button>
    <button type="button" class="act" @click="props.onRename()"><IconPen />Переименовать</button>
    <button v-if="!confirmDelete" type="button" class="act danger" @click="confirmDelete = true"><IconTrash />Удалить</button>
    <div v-else class="confirm">
      <p>Удалить «{{ name }}»? Треки останутся в библиотеке.</p>
      <div class="btns">
        <button type="button" class="btn" @click="emit('close')">Отмена</button>
        <button type="button" class="btn danger-btn" @click="remove">Удалить</button>
      </div>
    </div>
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
.act svg {
  width: 22px;
  height: 22px;
  color: var(--ink-2);
}
.act.danger,
.act.danger svg {
  color: var(--bad);
}
.confirm {
  padding: 8px var(--gutter) 4px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 14px;
  line-height: 1.45;
}
.btns {
  display: flex;
  gap: 10px;
}
.btns .btn {
  flex: 1;
}
.danger-btn {
  background: color-mix(in srgb, var(--bad) 22%, transparent);
  color: var(--bad);
}
</style>
