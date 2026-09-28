<script setup lang="ts">
/** Место под общий заголовок раздела (он лежит над лентой экранов, см. PageStrip) */
</script>

<template>
  <div class="head-space" aria-hidden="true" />
</template>

<style scoped>
.head-space {
  height: var(--head-h, 0px);
  flex: none;
}
</style>
