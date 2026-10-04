<script setup lang="ts">
import { useRouter } from 'vue-router'
import IconBack from '~icons/solar/alt-arrow-left-linear'

/** Шапка экрана: стрелка назад (если нужна), крупный заголовок Unbounded и действия — в одну строку */
defineProps<{ title: string; subtitle?: string; back?: boolean }>()
const router = useRouter()
</script>

<template>
  <header class="hdr">
    <div class="top">
      <button v-if="back" type="button" class="icon-btn back" aria-label="Назад" @click="router.back()"><IconBack /></button>
      <h1 class="display title">{{ title }}</h1>
      <div class="actions"><slot name="actions" /></div>
    </div>
    <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
    <slot />
  </header>
</template>

<style scoped>
.hdr {
  padding: calc(var(--safe-top) + 16px) var(--gutter) 18px;
  margin-bottom: 10px;
}
.top {
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 6px;
}
/* Стрелка выровнена по краю текста: её значок начинается там же, где заголовки ниже */
.back {
  margin-left: -10px;
}
.actions {
  display: flex;
  gap: 4px;
}
.title {
  flex: 1;
  min-width: 0;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.15;
  text-wrap: balance;
}
.subtitle {
  margin-top: 8px;
  color: var(--ink-2);
  font-size: 13.5px;
}
</style>
