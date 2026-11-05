import { $t } from '@/i18n'
/**
 * Оформление: акцентный цвет и фон, отдельно для тёмной и светлой темы.
 * Значения ложатся в те же CSS-переменные, что и в design/tokens.css, — компоненты ничего не знают о темах.
 * По умолчанию — янтарь на тёплом фоне: ровно то, что было до появления тем.
 */

export type AccentId = 'amber' | 'rose' | 'violet' | 'ocean' | 'mint' | 'graphite'
export type BackdropId = 'warm' | 'neutral' | 'cool' | 'tinted' | 'black'
export type Shade = 'dark' | 'light'

interface AccentShade {
  /** Основной цвет: кнопки, подсветка, полосы */
  amber: string
  /** Второй цвет градиентов */
  ember: string
  /** Цвет текста-акцента (ссылки, активные пункты): на светлом фоне темнее, чтобы читался */
  ink: string
  /** Текст на кнопке акцентного цвета */
  on: string
}

export interface Accent {
  id: AccentId
  label: string
  dark: AccentShade
  light: AccentShade
}

export const ACCENTS: Accent[] = [
  {
    id: 'amber',
    get label() {
      return $t('Янтарь')
    },
    dark: { amber: '#ffb23e', ember: '#ff7a2f', ink: '#ffb23e', on: '#1a1206' },
    light: { amber: '#ee9412', ember: '#e4602b', ink: '#9e5300', on: '#ffffff' },
  },
  {
    id: 'rose',
    get label() {
      return $t('Роза')
    },
    dark: { amber: '#ff7fa6', ember: '#ff4f7b', ink: '#ff8fb1', on: '#2a0714' },
    light: { amber: '#e0457a', ember: '#d02f5f', ink: '#a3164c', on: '#ffffff' },
  },
  {
    id: 'violet',
    get label() {
      return $t('Аметист')
    },
    dark: { amber: '#b49cff', ember: '#8a6cff', ink: '#bba6ff', on: '#160e33' },
    light: { amber: '#7c5cf0', ember: '#6a48e8', ink: '#5134c4', on: '#ffffff' },
  },
  {
    id: 'ocean',
    get label() {
      return $t('Океан')
    },
    dark: { amber: '#5cc8ff', ember: '#3a8dff', ink: '#6fd0ff', on: '#03172a' },
    light: { amber: '#1a8fd6', ember: '#1f6fe0', ink: '#0b5f99', on: '#ffffff' },
  },
  {
    id: 'mint',
    get label() {
      return $t('Мята')
    },
    dark: { amber: '#5fe0b0', ember: '#22b884', ink: '#6fe6b9', on: '#04261a' },
    light: { amber: '#1f9e72', ember: '#178a63', ink: '#0f6b4c', on: '#ffffff' },
  },
  {
    id: 'graphite',
    get label() {
      return $t('Графит')
    },
    dark: { amber: '#e9e5de', ember: '#a9a39a', ink: '#f1ede6', on: '#141311' },
    light: { amber: '#3b3833', ember: '#5a554e', ink: '#2a2724', on: '#ffffff' },
  },
]

interface Base {
  bg: string
  surface: string
  surface2: string
  surface3: string
  ink: string
  ink2: string
  ink3: string
  /** Цвет тонких линий (с прозрачностью 8% и 14%) — в тон фону */
  line: string
  /** Стекло панелей поверх содержимого */
  glass: string
}

export interface Backdrop {
  id: BackdropId
  label: string
  hint: string
  dark: Base
  /** Нет — у светлой темы такого фона нет (чёрный), берётся тёплый */
  light: Base | null
}

const WARM_DARK: Base = {
  bg: '#0e0d0c',
  surface: '#191714',
  surface2: '#23201b',
  surface3: '#2d2923',
  ink: '#f5f1ea',
  ink2: '#a89f92',
  ink3: '#726a5f',
  line: '255, 240, 220',
  glass: 'rgba(26, 23, 19, 0.62)',
}
const WARM_LIGHT: Base = {
  bg: '#f6f4f0',
  surface: '#ffffff',
  surface2: '#ece8e1',
  surface3: '#e2ddd4',
  ink: '#1a1714',
  ink2: '#6a6258',
  ink3: '#9c9387',
  line: '30, 20, 10',
  glass: 'rgba(255, 253, 249, 0.66)',
}
const NEUTRAL_DARK: Base = {
  bg: '#0d0d0e',
  surface: '#18181a',
  surface2: '#222225',
  surface3: '#2c2c30',
  ink: '#f2f2f3',
  ink2: '#a1a1a8',
  ink3: '#6d6d75',
  line: '240, 240, 255',
  glass: 'rgba(22, 22, 24, 0.62)',
}
const NEUTRAL_LIGHT: Base = {
  bg: '#f4f4f5',
  surface: '#ffffff',
  surface2: '#e9e9ec',
  surface3: '#dedee2',
  ink: '#18181b',
  ink2: '#63636b',
  ink3: '#95959e',
  line: '20, 20, 30',
  glass: 'rgba(255, 255, 255, 0.66)',
}

export const BACKDROPS: Backdrop[] = [
  {
    id: 'warm',
    get label() {
      return $t('Тёплый')
    },
    get hint() {
      return $t('как бумага и янтарь')
    },
    dark: WARM_DARK,
    light: WARM_LIGHT,
  },
  {
    id: 'neutral',
    get label() {
      return $t('Графит')
    },
    get hint() {
      return $t('чистый серый')
    },
    dark: NEUTRAL_DARK,
    light: NEUTRAL_LIGHT,
  },
  {
    id: 'cool',
    get label() {
      return $t('Ночь')
    },
    get hint() {
      return $t('с синевой')
    },
    dark: {
      bg: '#0b0d12',
      surface: '#141821',
      surface2: '#1d222d',
      surface3: '#262c39',
      ink: '#eef2f8',
      ink2: '#9aa3b2',
      ink3: '#677083',
      line: '220, 230, 255',
      glass: 'rgba(18, 22, 30, 0.62)',
    },
    light: {
      bg: '#f2f5f9',
      surface: '#ffffff',
      surface2: '#e5eaf1',
      surface3: '#d9e0ea',
      ink: '#141a24',
      ink2: '#5d6878',
      ink3: '#8e98a8',
      line: '10, 20, 40',
      glass: 'rgba(253, 254, 255, 0.66)',
    },
  },
  // Собирается из графита с каплей акцента — см. themeVars
  {
    id: 'tinted',
    get label() {
      return $t('В цвет акцента')
    },
    get hint() {
      return $t('фон подкрашен')
    },
    dark: NEUTRAL_DARK,
    light: NEUTRAL_LIGHT,
  },
  {
    id: 'black',
    get label() {
      return $t('Чёрный')
    },
    get hint() {
      return $t('для AMOLED, экономит заряд')
    },
    dark: {
      ...WARM_DARK,
      bg: '#000000',
      surface: '#100f0d',
      surface2: '#1a1815',
      surface3: '#24211c',
      glass: 'rgba(8, 7, 6, 0.72)',
    },
    light: null,
  },
]

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
/** a с долей k цвета b */
export const mix = (a: string, b: string, k: number) => {
  const x = hex(a)
  const y = hex(b)
  return toHex(x.map((v, i) => v + (y[i]! - v) * k))
}

export function accentOf(id: string | undefined): Accent {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]!
}
export function backdropOf(id: string | undefined): Backdrop {
  return BACKDROPS.find((b) => b.id === id) ?? BACKDROPS[0]!
}

/** Основа выбранного фона: у светлой темы без «чёрного» — тёплая; «в цвет акцента» — графит с каплей акцента */
export function baseOf(shade: Shade, backdrop: BackdropId, accent: AccentId): Base {
  const b = backdropOf(backdrop)
  const base = (shade === 'dark' ? b.dark : b.light) ?? WARM_LIGHT
  if (b.id !== 'tinted') return base
  const a = accentOf(accent)[shade].amber
  const k = shade === 'dark' ? 0.07 : 0.06
  return {
    ...base,
    bg: mix(base.bg, a, k * 0.8),
    surface: mix(base.surface, a, k),
    surface2: mix(base.surface2, a, k * 1.1),
    surface3: mix(base.surface3, a, k * 1.2),
    ink2: mix(base.ink2, a, 0.12),
    ink3: mix(base.ink3, a, 0.12),
    line: hex(mix(shade === 'dark' ? '#f0f0ff' : '#14141e', a, 0.3)).join(', '),
    glass: `rgba(${hex(mix(base.surface, a, k)).join(', ')}, ${shade === 'dark' ? 0.62 : 0.66})`,
  }
}

/** CSS-переменные выбранного оформления */
export function themeVars(shade: Shade, accent: AccentId, backdrop: BackdropId): Record<string, string> {
  const a = accentOf(accent)[shade]
  const b = baseOf(shade, backdrop, accent)
  return {
    '--bg': b.bg,
    '--surface': b.surface,
    '--surface-2': b.surface2,
    '--surface-3': b.surface3,
    '--ink': b.ink,
    '--ink-2': b.ink2,
    '--ink-3': b.ink3,
    '--line': `rgba(${b.line}, 0.08)`,
    '--line-strong': `rgba(${b.line}, 0.14)`,
    '--glass': b.glass,
    '--amber': a.amber,
    '--amber-ink': a.ink,
    '--ember': a.ember,
    '--amber-rgb': hex(a.amber).join(', '),
    '--on-amber': a.on,
  }
}
