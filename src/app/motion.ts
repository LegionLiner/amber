import { ref } from 'vue'
import type { RouteLocationNormalized, Router } from 'vue-router'

/**
 * Переходы между экранами.
 *
 * Направление берём из истории браузера: vue-router хранит в history.state номер записи (position).
 * Номер вырос — идём вглубь (новый экран въезжает справа), уменьшился — назад (уезжает вправо),
 * смена вкладки — «проявление» без сдвига, как в Material. Если экран открыли тапом по обложке,
 * обложка перелетает из карточки на место большой обложки новой страницы.
 */
export type RouteAnim = 'forward' | 'back' | 'tab' | 'morph' | 'fade' | 'none'

export const routeAnim = ref<RouteAnim>('none')

export function motionReduced(): boolean {
  return document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches
}

const TAB_ROOTS = new Set(['home', 'library', 'search', 'top', 'chronicle'])

function position(): number {
  const p = (window.history.state as { position?: unknown } | null)?.position
  return typeof p === 'number' ? p : 0
}

export function installRouteMotion(router: Router): void {
  let last = position()
  router.afterEach((to: RouteLocationNormalized, from: RouteLocationNormalized, failure) => {
    if (failure) return
    const pos = position()
    const dir = pos - last
    last = pos
    if (!from.matched.length || motionReduced()) routeAnim.value = 'none'
    else if (
      to.meta.tab !== from.meta.tab ||
      (TAB_ROOTS.has(String(to.name)) && TAB_ROOTS.has(String(from.name)) && to.name !== from.name)
    )
      routeAnim.value = 'tab'
    else if (dir < 0) routeAnim.value = 'back'
    else if (dir > 0) routeAnim.value = pendingMorph() ? 'morph' : 'forward'
    else routeAnim.value = 'fade'
  })
}

/* ---------------- полёт обложки ---------------- */

interface MorphSource {
  el: HTMLElement
  rect: DOMRect
  radius: string
  at: number
}
let morph: MorphSource | null = null

function pendingMorph(): boolean {
  return !!morph && performance.now() - morph.at < 700
}

/**
 * Запоминаем обложку в карточке, по которой только что тапнули. Ставится один раз на документ:
 * карточки альбомов, исполнителей и плейлистов разбросаны по многим экранам.
 */
export function installMorphTracking(): void {
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target
      if (!(t instanceof Element)) return
      const card = t.closest('[data-morph-card]')
      const cover = card?.querySelector<HTMLElement>('.cover')
      if (!cover) return
      const rect = cover.getBoundingClientRect()
      if (rect.width < 32) return
      morph = { el: cover, rect, radius: getComputedStyle(cover).borderRadius, at: performance.now() }
    },
    { capture: true, passive: true },
  )
}

/** Новая страница показала свою большую обложку: если её открыли из карточки, обложка прилетает оттуда */
export function flyCoverTo(target: HTMLElement | null | undefined): void {
  const src = morph
  morph = null
  if (!target || !src || performance.now() - src.at > 900 || motionReduced()) return
  const to = target.getBoundingClientRect()
  if (!to.width || to.bottom < 0 || to.top > window.innerHeight) return
  const clone = src.el.cloneNode(true) as HTMLElement
  const radius = getComputedStyle(target).borderRadius
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
    margin: '0',
    zIndex: '35',
    pointerEvents: 'none',
    transformOrigin: 'top left',
    boxShadow: 'var(--shadow-cover)',
  })
  document.body.appendChild(clone)
  target.style.visibility = 'hidden'
  const s = src.rect.width / to.width
  // Скругление задано до масштаба: маленькая обложка со скруглением 12 px в начале полёта должна выглядеть так же
  const fromRadius = src.radius.endsWith('px') ? `${parseFloat(src.radius) / s}px` : src.radius
  const anim = clone.animate(
    [
      { transform: `translate(${src.rect.left - to.left}px, ${src.rect.top - to.top}px) scale(${s})`, borderRadius: fromRadius },
      { transform: 'none', borderRadius: radius },
    ],
    { duration: 440, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  )
  const finish = () => {
    target.style.visibility = ''
    clone.remove()
  }
  anim.onfinish = finish
  anim.oncancel = finish
}

/* ---------------- прокрутка экранов ---------------- */

/**
 * Экраны живут в KeepAlive, но когда элемент вынимают из документа и вставляют обратно,
 * браузер сбрасывает прокрутку в ноль. Поэтому перед уходом запоминаем прокрутку всех
 * прокручиваемых блоков экрана (сам экран, списки внутри), а при возвращении ставим обратно.
 */
const scrolls = new WeakMap<Element, { top: number; left: number }>()

function scrollables(root: Element): Element[] {
  return [root, ...root.querySelectorAll('.scroll, .list, .chips')]
}

export function rememberScroll(el: Element): void {
  for (const n of scrollables(el)) {
    if (n.scrollTop || n.scrollLeft) scrolls.set(n, { top: n.scrollTop, left: n.scrollLeft })
    else scrolls.delete(n)
  }
}

export function restoreScroll(el: Element): void {
  for (const n of scrollables(el)) {
    const s = scrolls.get(n)
    if (!s) continue
    n.scrollTop = s.top
    n.scrollLeft = s.left
  }
}

/**
 * Дождаться, когда CSS-переход сдвига у элемента действительно закончится. Не «по часам»: если кадр
 * тяжёлый (перерисовка плеера под новый трек), переход стартует позже, и таймер срабатывал
 * посреди движения — лента прыгала на место.
 */
export function afterSlide(el: HTMLElement | null | undefined, fn: () => void, fallbackMs = 700): void {
  let done = false
  const finish = () => {
    if (done) return
    done = true
    el?.removeEventListener('transitionend', onEnd)
    clearTimeout(timer)
    fn()
  }
  const onEnd = (e: TransitionEvent) => {
    if (e.target === el && e.propertyName === 'transform') finish()
  }
  el?.addEventListener('transitionend', onEnd)
  const timer = window.setTimeout(finish, fallbackMs)
}
