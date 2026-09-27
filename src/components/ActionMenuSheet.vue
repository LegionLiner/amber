<script setup lang="ts">
import { ref, type Component } from 'vue'
import IconTrash from '~icons/solar/trash-bin-minimalistic-linear'

/**
 * Меню по удержанию: заголовок, пункты и «Удалить» с подтверждением.
 * Пункт закрывает меню сам, если сам не открывает следующую шторку.
 */
const props = defineProps<{
  title: string
  actions: { label: string; icon: Component; run: () => void }[]
  /** Удаление с подтверждением; текст — что именно пропадёт */
  onDelete?: () => void | Promise<void>
  deleteNote?: string
}>()
const emit = defineEmits<{ close: [] }>()
const confirmDelete = ref(false)

async function remove() {
  await props.onDelete?.()
  emit('close')
}
</script>

<template>
  <div class="body">
    <h3 class="head ellipsis">{{ title }}</h3>
    <button v-for="a in actions" :key="a.label" type="button" class="act" @click="a.run()">
      <component :is="a.icon" />{{ a.label }}
    </button>
    <template v-if="onDelete">
      <button v-if="!confirmDelete" type="button" class="act danger" @click="confirmDelete = true"><IconTrash />Удалить</button>
      <div v-else class="confirm">
        <p>
          Удалить «{{ title }}»?<template v-if="deleteNote"> {{ deleteNote }}</template>
        </p>
        <div class="btns">
          <button type="button" class="btn" @click="emit('close')">Отмена</button>
          <button type="button" class="btn danger-btn" @click="remove">Удалить</button>
        </div>
      </div>
    </template>
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
.act:active {
  background: var(--chip);
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
