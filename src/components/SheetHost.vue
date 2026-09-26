<script setup lang="ts">
import { ref } from 'vue'
import { useUi } from '@/stores/ui'

/** Нижняя шторка. Закрывается тапом по фону, жестом вниз за ручку и кнопкой «назад». */
const ui = useUi()
const dy = ref(0)
let startY = 0
let dragging = false

function down(e: PointerEvent) {
  dragging = true
  startY = e.clientY
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function move(e: PointerEvent) {
  if (!dragging) return
  dy.value = Math.max(0, e.clientY - startY)
}
function up() {
  if (!dragging) return
  dragging = false
  if (dy.value > 90) ui.closeSheet()
  dy.value = 0
}
</script>

<template>
  <Transition name="scrim">
    <div v-if="ui.sheet" class="scrim" @click="ui.closeSheet()" />
  </Transition>
  <Transition name="sheet">
    <div
      v-if="ui.sheet"
      class="sheet"
      role="dialog"
      aria-modal="true"
      :style="dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined"
    >
      <div class="grab" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up"><i /></div>
      <component :is="ui.sheet.component" v-bind="ui.sheet.props" @close="ui.closeSheet()" />
    </div>
  </Transition>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: var(--scrim);
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 41;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  box-shadow: var(--shadow-sheet);
  padding-bottom: calc(var(--safe-bottom) + 10px);
  transition: transform var(--t-mid) var(--ease-out);
}
.grab {
  flex: none;
  height: 26px;
  display: grid;
  place-items: center;
  touch-action: none;
  cursor: grab;
}
.grab i {
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--line-strong);
}
.scrim-enter-active,
.scrim-leave-active {
  transition: opacity var(--t-mid) var(--ease);
}
.scrim-enter-from,
.scrim-leave-to {
  opacity: 0;
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%);
}
</style>
