import { computed, ref, type InjectionKey, type Ref } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { nextRouteAnim } from './motion'
import { touchStoppedScroll } from '@/composables/tapGuard'
import { haptic } from '@/native/haptics'

/**
 * Листание разделов свайпом. Все главные экраны выстроены в одну ленту: главная → разделы медиатеки →
 * поиск → вкладки топа → вкладки хроники. Свайп влево — следующий, вправо — предыдущий; внутри раздела
 * листаются подвкладки, на краю — соседний раздел.
 */
export const LIB_SECTIONS = ['tracks', 'playlists', 'albums', 'artists', 'folders', 'genres', 'favorites'] as const
export const TOP_TABS = ['rank', 'duels', 'charts', 'rate'] as const
export const CHRON_TABS = ['overview', 'diary', 'eras', 'contexts', 'recap'] as const

interface Page {
  name: 'home' | 'library' | 'search' | 'top' | 'chronicle'
  tab?: string
}
const PAGES: Page[] = [
  { name: 'home' },
  ...LIB_SECTIONS.map((tab) => ({ name: 'library' as const, tab })),
  { name: 'search' },
  ...TOP_TABS.map((tab) => ({ name: 'top' as const, tab })),
  ...CHRON_TABS.map((tab) => ({ name: 'chronicle' as const, tab })),
]

/** Место экрана в ленте, −1 — экран не листается (альбом, настройки…) */
export function pageIndex(r: RouteLocationNormalizedLoaded): number {
  const name = String(r.name)
  const tab =
    name === 'library'
      ? (r.params.section as string) || 'tracks'
      : name === 'top'
        ? (r.query.tab as string) || 'rank'
        : name === 'chronicle'
          ? (r.query.tab as string) || 'overview'
          : undefined
  return PAGES.findIndex((p) => p.name === name && p.tab === tab)
}

/** Направление смены подвкладки — для анимации содержимого внутри топа и хроники */
export const tabSlide = ref<'next' | 'prev'>('next')

/** Строки треков в листаемых разделах не свайпаются сами: горизонтальный свайп листает раздел */
export const PAGE_SWIPES: InjectionKey<Ref<boolean>> = Symbol('pageSwipes')

export function pagingFor(route: RouteLocationNormalizedLoaded) {
  return computed(() => pageIndex(route) >= 0)
}

/** Перейти к соседнему экрану ленты. false — дальше некуда */
export function turnPage(router: Router, route: RouteLocationNormalizedLoaded, dir: 1 | -1): boolean {
  const i = pageIndex(route)
  const p = PAGES[i + dir]
  if (i < 0 || !p) return false
  const cur = PAGES[i]!
  tabSlide.value = dir > 0 ? 'next' : 'prev'
  const to =
    p.name === 'home'
      ? '/'
      : p.name === 'search'
        ? '/search'
        : p.name === 'library'
          ? `/library/${p.tab}`
          : { path: `/${p.name}`, query: { tab: p.tab } }
  if (cur.name === p.name && p.name !== 'library') {
    // Топ и хроника: тот же экран, меняется вкладка — содержимое уезжает внутри экрана
    void router.replace(to)
  } else {
    nextRouteAnim(dir > 0 ? 'slide-next' : 'slide-prev')
    void (cur.name === p.name ? router.replace(to) : router.push(to))
  }
  return true
}

/** Эти элементы сами разбираются с горизонтальным движением пальца */
const OWN_GESTURES = '.stars, .rs, .strip, .alpha, .rail, input, textarea, select, [data-no-page-swipe]'

function scrollsSideways(el: Element | null, stop: Element): boolean {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

/**
 * Жест листания на контейнере экранов. Экран слегка тянется за пальцем; отпустил дальше порога
 * (или быстро смахнул) — переход, иначе экран возвращается на место.
 */
export function usePageSwipe(router: Router, route: RouteLocationNormalizedLoaded) {
  let page: HTMLElement | null = null
  let sx = 0
  let sy = 0
  let lastX = 0
  let lastT = 0
  let vx = 0
  let lock: 'x' | 'y' | null = null
  let pid = -1

  const reset = (animate: boolean) => {
    const el = page
    page = null
    lock = null
    if (!el) return
    if (animate) {
      el.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
      el.style.transform = ''
      setTimeout(() => (el.style.transition = ''), 240)
    } else {
      el.style.transition = ''
      el.style.transform = ''
    }
  }

  function onPointerdown(e: PointerEvent) {
    reset(false)
    if (e.button !== 0 || pageIndex(route) < 0 || touchStoppedScroll()) return
    const root = e.currentTarget as HTMLElement
    const t = e.target as Element
    if (t.closest(OWN_GESTURES) || scrollsSideways(t, root)) return
    // Экран — прямой потомок контейнера (у каждого экрана свой корневой элемент)
    let el: Element | null = t
    while (el && el.parentElement !== root) el = el.parentElement
    if (!(el instanceof HTMLElement)) return
    page = el
    pid = e.pointerId
    sx = lastX = e.clientX
    sy = e.clientY
    lastT = e.timeStamp
    vx = 0
  }

  function onPointermove(e: PointerEvent) {
    if (!page || e.pointerId !== pid) return
    const dx = e.clientX - sx
    const dy = e.clientY - sy
    if (!lock) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        lock = 'y'
        return
      }
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.6) return
      lock = 'x'
    }
    if (lock !== 'x') return
    const dt = Math.max(1, e.timeStamp - lastT)
    vx = (e.clientX - lastX) / dt
    lastX = e.clientX
    lastT = e.timeStamp
    // Экран идёт за пальцем с сопротивлением: видно, что жест понят, но не выглядит как «уезжает»
    page.style.transition = 'none'
    page.style.transform = `translateX(${dx * 0.3}px)`
  }

  function onPointerup(e: PointerEvent) {
    if (!page || e.pointerId !== pid) return
    if (lock !== 'x') return reset(false)
    const dx = e.clientX - sx
    const flick = Math.abs(vx) > 0.5 && Math.sign(vx) === Math.sign(dx)
    if (Math.abs(dx) > 70 || flick) {
      const el = page
      // Уходящий экран начнёт анимацию с того места, где его отпустили
      el.style.setProperty('--drag', `${dx * 0.3}px`)
      el.style.transition = ''
      el.style.transform = ''
      page = null
      lock = null
      if (turnPage(router, route, dx < 0 ? 1 : -1)) haptic.tick()
      setTimeout(() => el.style.removeProperty('--drag'), 600)
      return
    }
    reset(true)
  }

  // Фаза перехвата: кнопки в строках («⋯», сердце) останавливают всплытие касания, а листать
  // должно и с них — правый край экрана как раз там, где лежит большой палец
  return {
    onPointerdownCapture: onPointerdown,
    onPointermoveCapture: onPointermove,
    onPointerupCapture: onPointerup,
    onPointercancelCapture: () => reset(true),
  }
}
