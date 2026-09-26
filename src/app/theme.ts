import { SystemBars, SystemBarsStyle } from '@capacitor/core'
import type { AppSettings } from '@/stores/settings'
import { isNative } from '@/native/paths'

const THEME_COLORS: Record<string, string> = { dark: '#0e0d0c', amoled: '#000000', light: '#f6f4f0' }

let media: MediaQueryList | null = null

/** Применяет тему, стекло и движение к <html>; следит за системной темой в режиме «как в системе» */
export function applyAppearance(s: Pick<AppSettings, 'theme' | 'glass' | 'motion'>) {
  const root = document.documentElement
  media ??= window.matchMedia('(prefers-color-scheme: light)')
  const resolved = s.theme === 'system' ? (media.matches ? 'light' : 'dark') : s.theme
  root.dataset.theme = resolved
  root.dataset.glass = s.glass
  root.dataset.motion = s.motion
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved] ?? '#0e0d0c')
  if (isNative) {
    // Dark = светлые значки на тёмном фоне
    void SystemBars.setStyle({ style: resolved === 'light' ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(
      () => undefined,
    )
  }
  media.onchange = s.theme === 'system' ? () => applyAppearance(s) : null
}
