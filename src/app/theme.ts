import { SystemBars, SystemBarsStyle } from '@capacitor/core'
import type { AppSettings } from '@/stores/settings'
import { isNative } from '@/native/paths'
import { themeVars } from '@/domain/themes'

let media: MediaQueryList | null = null

/**
 * Применяет тему, акцент, фон, стекло и движение к <html>; следит за системной темой в режиме «как в системе».
 * Цвета темы — CSS-переменные прямо на <html> (domain/themes.ts), поверх значений из tokens.css
 */
export function applyAppearance(s: Pick<AppSettings, 'theme' | 'accent' | 'backdrop' | 'glass' | 'motion'>) {
  const root = document.documentElement
  media ??= window.matchMedia('(prefers-color-scheme: light)')
  const resolved = s.theme === 'system' ? (media.matches ? 'light' : 'dark') : s.theme === 'light' ? 'light' : 'dark'
  const vars = themeVars(resolved, s.accent, s.backdrop)
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.dataset.theme = resolved
  root.dataset.accent = s.accent
  root.dataset.backdrop = s.backdrop
  root.dataset.glass = s.glass
  root.dataset.motion = s.motion
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg']!)
  if (isNative) {
    // Dark = светлые значки на тёмном фоне
    void SystemBars.setStyle({ style: resolved === 'light' ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(
      () => undefined,
    )
  }
  media.onchange = s.theme === 'system' ? () => applyAppearance(s) : null
}
