import { ref } from 'vue'
import { haptic } from '@/native/haptics'
import { touchStoppedScroll } from './tapGuard'

export interface RowGestureOptions {
  onTap: () => void
  onLongPress?: () => void
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  /** Можно ли сейчас свайпать строку (в листаемых разделах — нет) */
  swipes?: () => boolean
}

const THRESHOLD = 72

/**
 * Жесты строки списка: тап, долгое нажатие, свайп влево и вправо.
 * Вертикальную прокрутку отдаём браузеру (touch-action: pan-y у строки),
 * поэтому свайпы не мешают листать список.
 */
export function useRowGesture(opts: RowGestureOptions) {
  const dx = ref(0)
  const dragging = ref(false)
  let sx = 0
  let sy = 0
  let active = false
  let lock: 'x' | 'y' | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let longFired = false
  let armed = false

  const reset = () => {
    clearTimeout(timer)
    active = false
    lock = null
    dragging.value = false
    dx.value = 0
    armed = false
  }

  function onPointerdown(e: PointerEvent) {
    if (e.button !== 0) return
    active = true
    sx = e.clientX
    sy = e.clientY
    lock = null
    longFired = false
    armed = false
    // Касание остановило прокрутку по инерции: это не нажатие и не долгое нажатие
    if (touchStoppedScroll()) {
      active = false
      return
    }
    if (opts.onLongPress) {
      timer = setTimeout(() => {
        longFired = true
        haptic.press()
        opts.onLongPress?.()
      }, 450)
    }
  }

  function onPointermove(e: PointerEvent) {
    if (!active) return
    const mx = e.clientX - sx
    const my = e.clientY - sy
    if (!lock && Math.hypot(mx, my) > 8) {
      clearTimeout(timer)
      const canSwipe = (opts.swipes?.() ?? true) && ((mx > 0 && opts.onSwipeRight) || (mx < 0 && opts.onSwipeLeft))
      lock = Math.abs(mx) > Math.abs(my) * 1.3 && canSwipe ? 'x' : 'y'
      if (lock === 'x') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    if (lock === 'x') {
      dragging.value = true
      // Резиновое сопротивление после порога
      const sign = Math.sign(mx)
      const abs = Math.abs(mx)
      dx.value = sign * (abs < THRESHOLD ? abs : THRESHOLD + (abs - THRESHOLD) * 0.35)
      const nowArmed = abs >= THRESHOLD
      if (nowArmed !== armed) {
        armed = nowArmed
        if (armed) haptic.tick()
      }
    }
  }

  function onPointerup() {
    if (!active) return
    clearTimeout(timer)
    if (lock === 'x') {
      if (dx.value >= THRESHOLD) opts.onSwipeRight?.()
      else if (dx.value <= -THRESHOLD) opts.onSwipeLeft?.()
    } else if (!lock && !longFired) {
      opts.onTap()
    }
    reset()
  }

  function onPointercancel() {
    reset()
  }

  function onContextmenu(e: Event) {
    // Долгое нажатие мышью на компьютере
    e.preventDefault()
  }

  return { dx, dragging, handlers: { onPointerdown, onPointermove, onPointerup, onPointercancel, onContextmenu } }
}
