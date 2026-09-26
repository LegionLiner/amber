<script setup lang="ts">
import { onMounted, ref } from 'vue'

/** Шторка с одним полем: имя плейлиста, название метки и т.п. */
const props = defineProps<{
  title: string
  initial?: string
  confirm?: string
  placeholder?: string
  onDone: (value: string) => void
}>()
const emit = defineEmits<{ close: [] }>()
const value = ref(props.initial ?? '')
const input = ref<HTMLInputElement | null>(null)

onMounted(() => setTimeout(() => input.value?.focus(), 250))

function done() {
  const v = value.value.trim()
  if (!v) return
  props.onDone(v)
  emit('close')
}
</script>

<template>
  <form class="body" @submit.prevent="done">
    <h3>{{ title }}</h3>
    <input
      id="name-sheet-input"
      ref="input"
      v-model="value"
      :placeholder="placeholder ?? 'Название'"
      maxlength="80"
      enterkeyhint="done"
    />
    <button type="submit" class="btn primary block" :disabled="!value.trim()">{{ confirm ?? 'Готово' }}</button>
  </form>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0 var(--gutter) 8px;
}
h3 {
  font: 600 17px/1.2 var(--f-body);
}
input {
  height: 50px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  font-size: 16px;
  outline: none;
}
input:focus {
  border-color: var(--amber);
}
</style>
