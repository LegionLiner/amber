import { inject, onActivated, onDeactivated, watch, type InjectionKey, type Ref } from 'vue'
import type { RouteLocationNormalizedLoaded, RouteLocationRaw } from 'vue-router'
import { dataRev } from './data-rev'

/**
 * Лента главных экранов: главная → разделы медиатеки → поиск → вкладки топа → вкладки хроники.
 * Лента живёт в PageStrip: текущий экран и соседи уже отрисованы и едут за пальцем.
 */
export const LIB_SECTIONS = ['tracks', 'playlists', 'albums', 'artists', 'folders', 'genres', 'favorites'] as const
export const TOP_TABS = ['rank', 'duels', 'charts', 'rate'] as const
export const CHRON_TABS = ['overview', 'diary', 'eras', 'contexts', 'recap'] as const

/** Разделы с подвкладками: заголовок и чипсы у них общие и стоят на месте, листаются экраны под ними */
export const TABBED = ['library', 'top', 'chronicle'] as const
export type TabbedSection = (typeof TABBED)[number]
export const SECTION_TITLES: Record<TabbedSection, string> = { library: 'Медиатека', top: 'Топ', chronicle: 'Хроника' }
export const TAB_LABELS: Record<string, string> = {
  tracks: 'Треки',
  playlists: 'Плейлисты',
  albums: 'Альбомы',
  artists: 'Исполнители',
  folders: 'Папки',
  genres: 'Жанры',
  favorites: 'Избранное',
  rank: 'Мой рейтинг',
  duels: 'Дуэли',
  charts: 'Чарты',
  rate: 'Оценить',
  overview: 'Обзор',
  diary: 'Дневник',
  eras: 'Эпохи',
  contexts: 'Контексты',
  recap: 'Итоги',
}
export const SECTION_TABS: Record<TabbedSection, readonly string[]> = {
  library: LIB_SECTIONS,
  top: TOP_TABS,
  chronicle: CHRON_TABS,
}

export type PageName = 'home' | 'library' | 'search' | 'top' | 'chronicle'
export interface Page {
  name: PageName
  tab?: string
}
export const PAGES: Page[] = [
  { name: 'home' },
  ...LIB_SECTIONS.map((tab) => ({ name: 'library' as const, tab })),
  { name: 'search' },
  ...TOP_TABS.map((tab) => ({ name: 'top' as const, tab })),
  ...CHRON_TABS.map((tab) => ({ name: 'chronicle' as const, tab })),
]

/** Место экрана в ленте, −1 — экран не листается (альбом, настройки…) */
export function pageIndex(r: Pick<RouteLocationNormalizedLoaded, 'name' | 'params' | 'query'>): number {
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

/** Адрес экрана ленты */
export function pageLocation(i: number): RouteLocationRaw {
  const p = PAGES[i]!
  if (p.name === 'home') return '/'
  if (p.name === 'search') return '/search'
  if (p.name === 'library') return `/library/${p.tab}`
  return { path: `/${p.name}`, query: { tab: p.tab } }
}

/** Строки треков в ленте не свайпаются сами: горизонтальный свайп листает ленту */
export const PAGE_SWIPES: InjectionKey<Ref<boolean>> = Symbol('pageSwipes')

/** Адрес, под которым экран лежит в ленте (соседи отрисованы заранее, у каждого свой адрес) */
export const VIEW_ROUTE: InjectionKey<RouteLocationNormalizedLoaded> = Symbol('viewRoute')

/** Экран ленты сейчас на месте (а не сосед, ждущий за краем) */
export const PAGE_SHOWN: InjectionKey<Ref<boolean>> = Symbol('pageShown')

/**
 * Экран стал виден: вернулись на него из глубины (KeepAlive) или долистали до него в ленте.
 * Замена onActivated для содержимого ленты: соседи смонтированы заранее, и «активирован» ещё не значит «виден».
 * preload — первый раз вызвать и для невидимого соседа, чтобы к моменту свайпа данные уже были.
 */
export function onPageShown(fn: () => void, opts: { preload?: boolean } = {}): void {
  const shown = inject(PAGE_SHOWN, null)
  let first = true
  onActivated(() => {
    if (!shown || shown.value || (first && opts.preload)) fn()
    first = false
  })
  if (shown) watch(shown, (v) => v && fn())
  // С другого устройства пришли изменения, а экран сейчас на глазах — перечитываем сразу
  let active = true
  onActivated(() => (active = true))
  onDeactivated(() => (active = false))
  watch(dataRev, () => active && (!shown || shown.value) && fn())
}

/** Экран ушёл с глаз: открыли что-то поверх или долистали дальше */
export function onPageHidden(fn: () => void): void {
  const shown = inject(PAGE_SHOWN, null)
  onDeactivated(fn)
  if (shown) watch(shown, (v) => !v && fn())
}

/** Эти элементы сами разбираются с горизонтальным движением пальца */
export const OWN_GESTURES = '.stars, .rs, .strip, .alpha, .rail, input, textarea, select, [data-no-page-swipe]'

export function scrollsSideways(el: Element | null, stop: Element): boolean {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}
