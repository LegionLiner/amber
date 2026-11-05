import { dayKey, parseDay } from './weeks'

/**
 * Календарь выбора даты (DateField): месяц сеткой 7×6 с понедельника. Даты — ключами «ГГГГ-ММ-ДД»
 * по местному времени, как везде в истории.
 */
export interface PickDay {
  key: string
  day: number
  /** Из соседнего месяца: показывается бледно, чтобы сетка была ровной */
  outside: boolean
  disabled: boolean
}

/** Шесть недель вокруг месяца: всегда 42 клетки, высота календаря не прыгает от месяца к месяцу */
export function monthDays(year: number, month: number, min?: string, max?: string): PickDay[] {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7
  const out: PickDay[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i)
    const key = dayKey(d)
    out.push({ key, day: d.getDate(), outside: d.getMonth() !== month, disabled: !!((min && key < min) || (max && key > max)) })
  }
  return out
}

/** Сдвиг даты на n дней (с ограничением min/max) */
export function shiftDay(key: string, n: number, min?: string, max?: string): string {
  const d = parseDay(key)
  const k = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
  return clampDay(k, min, max)
}

/** Тот же день через n месяцев; 31-е в коротком месяце — последний день месяца */
export function shiftMonth(key: string, n: number, min?: string, max?: string): string {
  const d = parseDay(key)
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()
  const k = dayKey(new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last)))
  return clampDay(k, min, max)
}

export function clampDay(key: string, min?: string, max?: string): string {
  if (min && key < min) return min
  if (max && key > max) return max
  return key
}

/** Месяц целиком вне границ — в выборе месяцев он недоступен */
export function monthOutside(year: number, month: number, min?: string, max?: string): boolean {
  const from = dayKey(new Date(year, month, 1))
  const to = dayKey(new Date(year, month + 1, 0))
  return !!((min && to < min) || (max && from > max))
}
