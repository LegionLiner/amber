import { ref } from 'vue'
import { haptic } from '@/native/haptics'
import { touchStoppedScroll } from './tapGuard'
import { isDesktop } from '@/native/desktop/bridge'

export interface RowGestureOptions {
  onTap: () => void
  onLongPress?: () => void
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  /** Можно ли сейчас свайпать строку (в листаемых разделах — нет) */
  swipes?: () => boolean
  /**
   * Удержание берёт строку для перетаскивания (плейлисты) вместо меню: палец держит строку,
   * дальше его движения идут в onHoldMove, отпускание — onHoldEnd. Мышью строку тянут сразу, без ожидания.
   * Меню остаётся на «⋯» и правом клике.
   */
  onHold?: (y: number, el: HTMLElement) => void
  onHoldMove?: (e: PointerEvent) => void
  onHoldEnd?: () => void
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
  /** Мышью на компьютере строку не тянут: свайпы — для пальца, меню — по правому клику */
  let mouse = false
  /** Строка взята для перетаскивания */
  let held = false
  let el: HTMLElement | null = null
  let pointerId = 0
  let lastY = 0

  function hold(y: number) {
    held = true
    longFired = true
    try {
      el?.setPointerCapture(pointerId)
    } catch {}
    if (el) opts.onHold?.(y, el)
  }

  const reset = () => {
    clearTimeout(timer)
    held = false
    active = false
    lock = null
    dragging.value = false
    dx.value = 0
    armed = false
  }

  function onPointerdown(e: PointerEvent) {
    if (e.button !== 0) return
    mouse = isDesktop && e.pointerType === 'mouse'
    active = true
    sx = e.clientX
    sy = lastY = e.clientY
    el = e.currentTarget as HTMLElement
    pointerId = e.pointerId
    lock = null
    longFired = false
    armed = false
    // Касание остановило прокрутку по инерции: это не нажатие и не долгое нажатие
    if (touchStoppedScroll()) {
      active = false
      return
    }
    if (opts.onHold && !mouse) {
      timer = setTimeout(() => hold(lastY), 450)
    } else if (opts.onLongPress) {
      timer = setTimeout(() => {
        longFired = true
        haptic.press()
        opts.onLongPress?.()
      }, 450)
    }
  }

  function onPointermove(e: PointerEvent) {
    if (!active) return
    lastY = e.clientY
    if (held) {
      opts.onHoldMove?.(e)
      return
    }
    const mx = e.clientX - sx
    const my = e.clientY - sy
    // Мышь: потянул строку вверх или вниз — она поехала
    if (mouse && opts.onHold && !lock && Math.abs(my) > 6 && Math.abs(my) > Math.abs(mx)) {
      clearTimeout(timer)
      hold(sy)
      opts.onHoldMove?.(e)
      return
    }
    if (!lock && Math.hypot(mx, my) > 8) {
      clearTimeout(timer)
      const canSwipe = !mouse && (opts.swipes?.() ?? true) && ((mx > 0 && opts.onSwipeRight) || (mx < 0 && opts.onSwipeLeft))
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
    if (held) {
      opts.onHoldEnd?.()
      reset()
      return
    }
    if (lock === 'x') {
      if (dx.value >= THRESHOLD) opts.onSwipeRight?.()
      else if (dx.value <= -THRESHOLD) opts.onSwipeLeft?.()
    } else if (!lock && !longFired) {
      opts.onTap()
    }
    reset()
  }

  function onPointercancel() {
    if (held) opts.onHoldEnd?.()
    reset()
  }

  /** Пока строка в руке, палец не прокручивает список (слушатель не пассивный — иначе отменить нельзя) */
  function onTouchmove(e: TouchEvent) {
    if (held && e.cancelable) e.preventDefault()
  }

  function onContextmenu(e: Event) {
    // Правый клик — то же меню, что долгое нажатие; системное меню не нужно
    e.preventDefault()
    if (longFired) return
    reset()
    opts.onLongPress?.()
  }

  return { dx, dragging, onTouchmove, handlers: { onPointerdown, onPointermove, onPointerup, onPointercancel, onContextmenu } }
}
