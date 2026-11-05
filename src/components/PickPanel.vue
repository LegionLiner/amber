<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useUi } from '@/stores/ui'
import { blockClicks } from '@/composables/tapGuard'
import { isDesktop } from '@/native/desktop/bridge'

/**
 * Панель выбора для SelectField и DateField.
 *  - Мышь и широкое окно (компьютер): всплывает под полем (не влезает — над ним), закрывается щелчком мимо и Esc.
 *  - Палец или узкий экран (телефон): выезжает снизу поверх всего, даже поверх шторки, с заголовком;
 *    закрывается тапом по фону и кнопкой «назад».
 */
const props = defineProps<{ open: boolean; anchor: HTMLElement | null; title?: string; minWidth?: number }>()
const emit = defineEmits<{ close: []; shown: [] }>()
const ui = useUi()

const panel = ref<HTMLElement | null>(null)
const popover = ref(false)
const pos = ref<Record<string, string>>({})

function close() {
  emit('close')
}

function place() {
  const a = props.anchor
  const p = panel.value
  if (!a || !p || !popover.value) return
  const r = a.getBoundingClientRect()
  const w = Math.min(innerWidth - 16, Math.max(r.width, props.minWidth ?? 200))
  const below = innerHeight - r.bottom - 12
  const above = r.top - 12
  const h = p.scrollHeight
  const up = h > below && above > below
  const room = Math.max(160, up ? above : below)
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8))
  pos.value = {
    left: `${left}px`,
    width: `${w}px`,
    maxHeight: `${room}px`,
    ...(up ? { bottom: `${innerHeight - r.top + 6}px` } : { top: `${r.bottom + 6}px` }),
  }
}

/** Нажатие мимо панели и поля закрывает её (на компьютере; на телефоне это делает фон) */
function outside(e: PointerEvent) {
  const t = e.target as Node | null
  if (!t || panel.value?.contains(t) || props.anchor?.contains(t)) return
  close()
}
const onResize = () => place()

watch(
  () => props.open,
  async (open) => {
    if (open) {
      popover.value = isDesktop || (matchMedia('(pointer: fine)').matches && innerWidth >= 640)
      ui.popup = close
      // Тап, открывший панель на телефоне, не должен тут же выбрать пункт под пальцем
      if (!popover.value) blockClicks(350)
      await nextTick()
      place()
      emit('shown')
      if (popover.value) {
        document.addEventListener('pointerdown', outside, true)
        addEventListener('resize', onResize)
        addEventListener('scroll', onResize, true)
      }
    } else {
      cleanup()
      // Фокус — обратно на поле, с которого открыли
      props.anchor?.focus({ preventScroll: true })
    }
  },
)
function cleanup() {
  if (ui.popup === close) ui.popup = null
  document.removeEventListener('pointerdown', outside, true)
  removeEventListener('resize', onResize)
  removeEventListener('scroll', onResize, true)
}
onBeforeUnmount(cleanup)

defineExpose({ place })
</script>

<template>
  <Teleport to="body">
    <template v-if="popover">
      <Transition name="pop" appear>
        <div v-if="open" ref="panel" class="pick-pop" :style="pos" @keydown.esc.stop.prevent="close">
          <slot />
        </div>
      </Transition>
    </template>
    <template v-else>
      <Transition name="scrim" appear>
        <div v-if="open" class="pick-scrim" @click="close" />
      </Transition>
      <Transition name="up" appear>
        <div v-if="open" ref="panel" class="pick-sheet" role="dialog" aria-modal="true" :aria-label="title">
          <h3 v-if="title" class="pick-title">{{ title }}</h3>
          <div class="pick-body"><slot /></div>
        </div>
      </Transition>
    </template>
  </Teleport>
</template>

<style scoped>
.pick-pop {
  position: fixed;
  z-index: 95;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow:
    0 18px 40px -12px rgba(0, 0, 0, 0.55),
    0 2px 8px rgba(0, 0, 0, 0.2);
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ink) 14%, transparent) transparent;
}
.pick-scrim {
  position: fixed;
  inset: 0;
  z-index: 94;
  background: var(--scrim);
}
.pick-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  /* Планшет или окно браузера пошире: не во всю ширину */
  width: min(100%, 520px);
  margin: 0 auto;
  z-index: 95;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  padding: 18px 12px calc(var(--safe-bottom) + 12px);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  background: var(--surface);
  box-shadow: var(--shadow-sheet);
}
.pick-title {
  flex: none;
  padding: 0 8px 10px;
  font: 600 16px/1.25 var(--f-body);
}
.pick-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.pop-enter-active,
.pop-leave-active {
  transition:
    opacity 0.14s var(--ease),
    transform 0.16s var(--ease-out);
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
.scrim-enter-active,
.scrim-leave-active {
  transition: opacity var(--t-mid) var(--ease);
}
.scrim-enter-from,
.scrim-leave-to {
  opacity: 0;
}
.up-enter-active,
.up-leave-active {
  transition: transform var(--t-mid) var(--ease-out);
}
.up-enter-from,
.up-leave-to {
  transform: translateY(100%);
}
</style>
