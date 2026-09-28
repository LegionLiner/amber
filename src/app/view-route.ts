import { inject, shallowReactive, watch } from 'vue'
import { useRoute, type RouteLocationNormalizedLoaded } from 'vue-router'
import { VIEW_ROUTE } from './paging'

/**
 * Адрес «своего» экрана. Экраны живут в KeepAlive под своим путём (App.vue), а useRoute() всегда
 * отдаёт текущий адрес приложения. Без этой обёртки уходящий экран альбома на время анимации
 * перехода перерисовывался под чужой адрес («Альбом не найден»), а спрятанные в кеше — лишний раз.
 * Здесь адрес обновляется, только пока путь совпадает с путём экрана (query при этом меняется свободно).
 * Экраны ленты (PageStrip) получают свой постоянный адрес от ленты: соседи отрисованы заранее.
 */
export function useViewRoute(): RouteLocationNormalizedLoaded {
  const fixed = inject(VIEW_ROUTE, null)
  if (fixed) return fixed
  const route = useRoute()
  const own = route.path
  const snap = shallowReactive({ ...route })
  watch(
    () => route.fullPath,
    () => {
      if (route.path === own) Object.assign(snap, { ...route })
    },
  )
  return snap
}
