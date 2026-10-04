<script setup lang="ts">
/** Место под общий заголовок раздела (он лежит над лентой экранов, см. PageStrip) */
</script>

<template>
  <div class="head-space" aria-hidden="true" />
</template>

<style scoped>
.head-space {
  /* Высота шапки раздела и просвет до первого блока под ней */
  height: calc(var(--head-h, 0px) + 14px);
  flex: none;
}
</style>
