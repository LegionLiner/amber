<script setup lang="ts" generic="T extends string">
/** Подвкладки чипсами. Прокручиваются вбок, если не влезают. */
defineProps<{ items: { id: T; label: string }[]; modelValue: T }>()
const emit = defineEmits<{ 'update:modelValue': [id: T] }>()
</script>

<template>
  <div class="chips" role="tablist">
    <button
      v-for="it in items"
      :key="it.id"
      type="button"
      role="tab"
      class="chip"
      :class="{ on: it.id === modelValue }"
      :aria-selected="it.id === modelValue"
      @click="emit('update:modelValue', it.id)"
    >
      {{ it.label }}
    </button>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  gap: 8px;
  padding: 4px var(--gutter) 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.chips::-webkit-scrollbar {
  display: none;
}
.chip {
  flex: none;
  padding: 9px 14px;
  border-radius: 999px;
  background: var(--chip);
  color: var(--ink-2);
  font: 500 13.5px/1 var(--f-body);
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.chip.on {
  background: var(--ink);
  color: var(--bg);
}
</style>
