import type { CountingRule } from '@/native/types'

/**
 * Правило «что считать прослушиванием». По умолчанию как у Last.fm:
 * трек длиннее 30 секунд и прослушана половина или 4 минуты (что наступит раньше).
 * Та же логика продублирована в Kotlin (tracking/PlayTracker.kt).
 */
export const DEFAULT_COUNTING: CountingRule = {
  minTrackMs: 30_000,
  minFraction: 0.5,
  minListenMs: 240_000,
}

export function requiredListenMs(rule: CountingRule, durationMs: number): number {
  if (durationMs <= 0) return rule.minListenMs
  return Math.min(durationMs * rule.minFraction, rule.minListenMs)
}

export function isCounted(rule: CountingRule, durationMs: number, listenedMs: number): boolean {
  if (durationMs > 0 && durationMs < rule.minTrackMs) return false
  return listenedMs >= requiredListenMs(rule, durationMs)
}

/**
 * То же правило в виде SQL-выражения: им пересчитывается вся история,
 * когда правило меняют в настройках (сырые события хранятся все).
 */
export function countedSqlExpr(rule: CountingRule): string {
  const minTrack = Math.round(rule.minTrackMs)
  const frac = Number(rule.minFraction)
  const minListen = Math.round(rule.minListenMs)
  return `CASE
    WHEN duration_ms > 0 AND duration_ms < ${minTrack} THEN 0
    WHEN listened_ms >= (CASE WHEN duration_ms > 0 THEN MIN(duration_ms * ${frac}, ${minListen}) ELSE ${minListen} END) THEN 1
    ELSE 0 END`
}

export interface LocalParts {
  /** Смещение часового пояса в минутах (Москва = 180) */
  tzOffset: number
  /** 'YYYY-MM-DD' по местному времени */
  localDay: string
  localHour: number
  /** 1 = понедельник … 7 = воскресенье */
  weekday: number
}

export function localParts(ts: number): LocalParts {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return {
    tzOffset: -d.getTimezoneOffset(),
    localDay: `${y}-${m}-${day}`,
    localHour: d.getHours(),
    weekday: ((d.getDay() + 6) % 7) + 1,
  }
}
