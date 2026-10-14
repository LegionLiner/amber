import IconPhone from '~icons/solar/smartphone-2-linear'
import IconMonitor from '~icons/solar/monitor-linear'
import IconBrowser from '~icons/solar/display-linear'
import type { Component } from 'vue'

/** Значок устройства по платформе, которую оно назвало при входе */
export function deviceIcon(platform: string): Component {
  if (platform === 'android') return IconPhone
  if (platform === 'desktop') return IconMonitor
  return IconBrowser
}
