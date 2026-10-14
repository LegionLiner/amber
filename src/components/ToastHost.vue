<script setup lang="ts">
import { computed } from 'vue'
import { useUi } from '@/stores/ui'
import { usePlayer } from '@/stores/player'
import { useRemote } from '@/stores/remote'

const ui = useUi()
const player = usePlayer()
const remote = useRemote()
/** Полоска «играет на …» (RemoteStrip) висит над плеером: сообщения — над ней */
const strip = computed(() => (remote.strip?.state && !ui.fullPlayer ? 58 : 0))
const bottom = computed(() =>
  player.hasTrack
    ? `calc(var(--nav-h) + var(--mini-h) + var(--safe-bottom) + ${18 + strip.value}px)`
    : `calc(var(--nav-h) + var(--safe-bottom) + ${12 + strip.value}px)`,
)
</script>

<template>
  <div class="toasts" :style="{ bottom, '--strip': `${strip}px` }" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in ui.toasts" :key="t.id" class="toast">
        <span>{{ t.text }}</span>
        <button v-if="t.action" type="button" @click="t.action.run()">{{ t.action.label }}</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 12px;
  right: 12px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--ink);
  color: var(--bg);
  font: 500 14px/1.3 var(--f-body);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
.toast button {
  font-weight: 600;
  color: var(--amber);
}
[data-theme='light'] .toast button {
  color: var(--amber);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 200ms var(--ease),
    transform 260ms var(--ease-out);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
