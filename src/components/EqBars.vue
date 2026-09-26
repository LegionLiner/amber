<script setup lang="ts">
/** Три прыгающих столбика: «этот трек играет». На паузе замирают. */
defineProps<{ playing?: boolean; light?: boolean }>()
</script>

<template>
  <span class="eq" :class="{ paused: !playing, light }" aria-hidden="true"><i /><i /><i /></span>
</template>

<style scoped>
.eq {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
}
.eq i {
  width: 3px;
  border-radius: 1px;
  background: var(--amber);
  animation: bounce 900ms ease-in-out infinite;
}
.light i {
  background: #fff;
}
.eq i:nth-child(1) {
  animation-delay: -300ms;
}
.eq i:nth-child(2) {
  animation-delay: -600ms;
}
.eq i:nth-child(3) {
  animation-delay: -150ms;
}
.paused i {
  animation-play-state: paused;
}
@keyframes bounce {
  0%,
  100% {
    height: 25%;
  }
  50% {
    height: 100%;
  }
}
</style>
