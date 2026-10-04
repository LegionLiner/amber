import { onBeforeUnmount, ref, type Ref } from 'vue'
import { haptic } from '@/native/haptics'

/**
 * Перетаскивание строк одинаковой высоты за ручку (плейлисты, уточнение рейтинга).
 * Строка едет за пальцем, соседи расступаются, у края списка он сам прокручивается.
 */
export function useDragList(opts: {
  rowH: number
  count: () => number
  scrollEl: Ref<HTMLElement | null>
  onMove: (from: number, to: number) => void | Promise<void>
}) {
  const from = ref<number | null>(null)
  const to = ref<number | null>(null)
  const dy = ref(0)
  let startY = 0
  let lastY = 0
  let startScroll = 0
  let raf = 0

  function offsetFor(i: number): number {
    const f = from.value
    const t = to.value
    if (f == null || t == null || i === f) return 0
    if (f < t && i > f && i <= t) return -opts.rowH
    if (f > t && i >= t && i < f) return opts.rowH
    return 0
  }

  function recompute() {
    if (from.value == null) return
    const scrolled = (opts.scrollEl.value?.scrollTop ?? 0) - startScroll
    dy.value = lastY - startY + scrolled
    const target = Math.max(0, Math.min(opts.count() - 1, from.value + Math.round(dy.value / opts.rowH)))
    if (target !== to.value) {
      to.value = target
      haptic.tick()
    }
  }

  function autoScroll() {
    const el = opts.scrollEl.value
    if (!el || from.value == null) return
    const r = el.getBoundingClientRect()
    const edge = 70
    let v = 0
    if (lastY < r.top + edge) v = -Math.ceil((r.top + edge - lastY) / 6)
    else if (lastY > r.bottom - edge) v = Math.ceil((lastY - (r.bottom - edge)) / 6)
    if (v) {
      el.scrollTop += v
      recompute()
    }
    raf = requestAnimationFrame(autoScroll)
  }

  /** Начать с нажатия на ручку или с точки, где палец взял строку (тогда указатель уже захвачен строкой) */
  function start(e: PointerEvent | { clientY: number }, i: number) {
    if ('pointerId' in e) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    from.value = i
    to.value = i
    dy.value = 0
    startY = lastY = e.clientY
    startScroll = opts.scrollEl.value?.scrollTop ?? 0
    haptic.press()
    raf = requestAnimationFrame(autoScroll)
  }

  function move(e: PointerEvent) {
    if (from.value == null) return
    lastY = e.clientY
    recompute()
  }

  async function end() {
    cancelAnimationFrame(raf)
    const f = from.value
    const t = to.value
    from.value = null
    to.value = null
    dy.value = 0
    if (f == null || t == null || f === t) return
    await opts.onMove(f, t)
  }

  onBeforeUnmount(() => cancelAnimationFrame(raf))

  function styleFor(i: number) {
    return { transform: `translateY(${from.value === i ? dy.value : offsetFor(i)}px)` }
  }

  return { from, to, dy, offsetFor, styleFor, start, move, end }
}
