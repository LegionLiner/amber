<script setup lang="ts">
import { useRouter } from 'vue-router'
import IconBack from '~icons/solar/alt-arrow-left-linear'

/** Шапка экрана: крупный заголовок Unbounded, справа действия, при необходимости стрелка назад */
defineProps<{ title: string; subtitle?: string; back?: boolean }>()
const router = useRouter()
</script>

<template>
  <header class="hdr">
    <div class="top">
      <button v-if="back" type="button" class="icon-btn" aria-label="Назад" @click="router.back()"><IconBack /></button>
      <span v-else />
      <div class="actions"><slot name="actions" /></div>
    </div>
    <h1 class="display title">{{ title }}</h1>
    <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
    <slot />
  </header>
</template>

<style scoped>
.hdr {
  padding: calc(var(--safe-top) + 6px) var(--gutter) 8px;
}
.top {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.actions {
  display: flex;
  gap: 4px;
}
.title {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.15;
  text-wrap: balance;
}
.subtitle {
  margin-top: 6px;
  color: var(--ink-2);
  font-size: 13.5px;
}
</style>
