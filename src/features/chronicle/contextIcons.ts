import type { Component } from 'vue'
import IconRun from '~icons/solar/running-linear'
import IconHome from '~icons/solar/home-2-linear'
import IconWork from '~icons/solar/case-linear'
import IconBus from '~icons/solar/bus-linear'
import IconMoon from '~icons/solar/moon-linear'
import IconSun from '~icons/solar/sun-linear'
import IconCoffee from '~icons/solar/cup-hot-linear'
import IconBook from '~icons/solar/book-linear'
import IconGame from '~icons/solar/gamepad-linear'
import IconWalk from '~icons/solar/walking-linear'
import IconBike from '~icons/solar/bicycling-linear'
import IconLaptop from '~icons/solar/laptop-linear'

/** Значки контекстов: хранится ключ, в интерфейсе — компонент */
export const CONTEXT_ICONS: Record<string, Component> = {
  run: IconRun,
  walk: IconWalk,
  bike: IconBike,
  bus: IconBus,
  home: IconHome,
  work: IconWork,
  laptop: IconLaptop,
  book: IconBook,
  coffee: IconCoffee,
  game: IconGame,
  sun: IconSun,
  moon: IconMoon,
}

export function contextIcon(key: string | null): Component {
  return CONTEXT_ICONS[key ?? ''] ?? IconSun
}
