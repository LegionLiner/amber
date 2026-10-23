import { defineStore } from 'pinia'
import { ref, shallowRef, watch, type Component } from 'vue'
import { blockClicks } from '@/composables/tapGuard'

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export interface SheetRequest {
  component: Component
  props?: Record<string, unknown>
}

export const useUi = defineStore('ui', () => {
  const fullPlayer = ref(false)
  /** Мини-плеер тянут вверх: насколько открыт полный плеер, 0..1 (null — не тянут) */
  const playerDrag = ref<number | null>(null)
  const queueOpen = ref(false)
  /** «Сцена»: только обложка на весь экран, вокруг — свет и цвет в такт музыке (ZenMode) */
  const zen = ref(false)
  const sheet = shallowRef<SheetRequest | null>(null)
  const toasts = ref<Toast[]>([])
  /** Повторный тап по активной вкладке: экран прокручивается наверх */
  const reselect = ref<{ tab: string; n: number }>({ tab: '', n: 0 })
  let toastId = 0

  // Новый слой открылся под пальцем: click от того же касания не должен нажать кнопку в нём
  watch([fullPlayer, queueOpen, () => sheet.value?.component], ([f, q, s], [pf, pq, ps]) => {
    if ((f && !pf) || (q && !pq) || (s && s !== ps)) blockClicks(400)
  })

  function tabReselected(tab: string) {
    reselect.value = { tab, n: reselect.value.n + 1 }
  }

  function openSheet(component: Component, props?: Record<string, unknown>) {
    sheet.value = { component, props }
  }

  function closeSheet() {
    sheet.value = null
  }

  function toast(text: string, action?: Toast['action'], ms = 3200) {
    const id = ++toastId
    toasts.value = [...toasts.value.slice(-2), { id, text, action }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, ms)
  }

  /** Системная кнопка «назад»: закрывает верхний слой. true, если что-то закрыли. */
  function back(): boolean {
    if (zen.value) {
      zen.value = false
      return true
    }
    if (sheet.value) {
      closeSheet()
      return true
    }
    if (queueOpen.value) {
      queueOpen.value = false
      return true
    }
    if (fullPlayer.value) {
      fullPlayer.value = false
      return true
    }
    return false
  }

  return { fullPlayer, playerDrag, queueOpen, zen, sheet, toasts, reselect, tabReselected, openSheet, closeSheet, toast, back }
})
