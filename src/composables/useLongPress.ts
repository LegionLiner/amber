import { onBeforeUnmount } from 'vue'
import { haptic } from '@/native/haptics'
import { blockClicks, touchStoppedScroll } from './tapGuard'

/**
 * Долгое нажатие на карточке или строке, где обычный тап уже что-то делает (открывает экран).
 * Держишь 450 мс — открывается меню, а click от того же касания гасится, чтобы не сработал ещё и тап.
 * Сдвинул палец (прокрутка) — долгого нажатия нет.
 *
 *   const hold = useLongPress()
 *   <button v-bind="hold(() => openMenu(p))" @click="open(p)">
 */
export function useLongPress(ms = 450) {
  let timer = 0
  let sx = 0
  let sy = 0
  const stop = () => clearTimeout(timer)
  onBeforeUnmount(stop)

  return (fn: () => void) => ({
    onPointerdown(e: PointerEvent) {
      stop()
      if (e.button !== 0 || touchStoppedScroll()) return
      sx = e.clientX
      sy = e.clientY
      timer = window.setTimeout(() => {
        haptic.press()
        blockClicks(700)
        fn()
      }, ms)
    },
    onPointermove(e: PointerEvent) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) stop()
    },
    onPointerup: stop,
    onPointercancel: stop,
    // Правый клик мышью в веб-версии — то же меню; системное меню WebView не нужно
    onContextmenu(e: Event) {
      e.preventDefault()
      stop()
      fn()
    },
  })
}
