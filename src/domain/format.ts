/** Форматирование чисел, времени и русских окончаний */

const pr = new Intl.PluralRules('ru')

/** plural(5, ['трек', 'трека', 'треков']) → 'треков' */
export function plural(n: number, forms: [one: string, few: string, many: string]): string {
  const rule = pr.select(n)
  if (rule === 'one') return forms[0]
  if (rule === 'few') return forms[1]
  return forms[2]
}

export function countLabel(n: number, forms: [string, string, string]): string {
  return `${n.toLocaleString('ru-RU')} ${plural(n, forms)}`
}

/** 3:07, 1:02:45 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 41 ч 12 мин, 25 мин, 40 с */
export function formatListen(ms: number): string {
  const min = Math.round(ms / 60000)
  if (ms <= 0) return '0 мин'
  if (min < 1) return `${Math.round(ms / 1000)} с`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} мин`
  return m ? `${h} ч ${m} мин` : `${h} ч`
}

const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]
export const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** сегодня, вчера, 3 дня назад, 12 марта, 12 марта 2024 */
export function relativeDay(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'никогда'
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h >= 5 && h < 12) return 'Доброе утро'
  if (h >= 12 && h < 17) return 'Добрый день'
  if (h >= 17 && h < 23) return 'Добрый вечер'
  return 'Доброй ночи'
}
