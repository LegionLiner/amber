import { EN } from './en'

/**
 * Языки интерфейса: русский и английский.
 *
 * Как в gettext: ключ — сама русская строка, t('Медиатека') на английском вернёт «Library». Нет перевода —
 * показывается русский текст, ничего не ломается (тест tests/i18n.test.ts следит, чтобы переводы были у всех строк).
 * Подстановки — по номерам: t('Слушаю через «{0}»', name).
 * Формы числа: tp('трек|трека|треков') → три формы для plural() (в английском — одна и две одинаковые «многие»).
 *
 * Язык при запуске — сохранённый выбор (настройки → язык), иначе язык системы. Сменить его можно на ходу,
 * без перезапуска (setLang): lang, isEn и LOCALE — живые привязки, тексты в постоянных модулей берутся при чтении
 * (геттеры), а интерфейс перерисовывается заново (main.ts слушает onLangChange).
 */
export type Lang = 'ru' | 'en'

const KEY = 'amber.lang'

function detect(): Lang {
  // Тесты проверяют русские строки.
  // Через process, а не import.meta: модуль попадает и в главный процесс компьютерной версии (CommonJS)
  if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITEST) return 'ru'
  try {
    const saved = globalThis.localStorage?.getItem(KEY)
    if (saved === 'ru' || saved === 'en') return saved
  } catch {
    /* хранилище недоступно — по системе */
  }
  const sys = globalThis.navigator?.language ?? 'ru'
  return /^ru\b/i.test(sys) ? 'ru' : 'en'
}

export let lang: Lang = detect()
export let isEn = lang === 'en'
/** Для toLocaleString / Intl */
export let LOCALE = isEn ? 'en-US' : 'ru-RU'

type Arg = string | number | null | undefined

function fill(s: string, args: readonly Arg[]): string {
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? '')) : s
}

/** Строка интерфейса на текущем языке */
export function t(ru: string, ...args: Arg[]): string {
  return fill(isEn ? (EN[ru] ?? ru) : ru, args)
}

/** Формы числа: 'трек|трека|треков' → ['трек', 'трека', 'треков'] (или английские) */
export function tp(forms: string): [string, string, string] {
  const s = isEn ? (EN[forms] ?? forms) : forms
  const [a = '', b = a, c = b] = s.split('|')
  return [a, b, c]
}

const listeners = new Set<(l: Lang) => void>()

/** Язык сменился: перерисовать интерфейс, сообщить движку телефона и окну компьютера */
export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Сменить язык: запоминается на этом устройстве и применяется сразу, без перезапуска */
export function setLang(l: Lang): void {
  try {
    globalThis.localStorage?.setItem(KEY, l)
  } catch {
    /* не сохранилось — после перезапуска язык вернётся к системному */
  }
  if (l === lang) return
  lang = l
  isEn = l === 'en'
  LOCALE = isEn ? 'en-US' : 'ru-RU'
  if (typeof document !== 'undefined') document.documentElement.lang = l
  for (const fn of listeners) fn(l)
}

/** Короткие имена для кода и шаблонов: t — частое имя переменной трека, поэтому с $ */
export const $t = t
export const $tp = tp
