/** Форматирование чисел, времени, дат и окончаний — на языке интерфейса (i18n) */
import { isEn, LOCALE, onLangChange, t, tp } from '@/i18n'

// Правила форм числа — на каждый язык одни; язык могут сменить на ходу
const rules = new Map<string, Intl.PluralRules>()
const pluralRules = () => {
  const l = isEn ? 'en' : 'ru'
  let r = rules.get(l)
  if (!r) rules.set(l, (r = new Intl.PluralRules(l)))
  return r
}

/**
 * plural(5, ['трек', 'трека', 'треков']) → 'треков'. Формы — как в русском (одна, несколько, много);
 * в английском «одна» — для 1, остальные числа берут последнюю форму
 */
export function plural(n: number, forms: [one: string, few: string, many: string]): string {
  const rule = pluralRules().select(n)
  if (rule === 'one') return forms[0]
  if (rule === 'few') return forms[1]
  return forms[2]
}

export function countLabel(n: number, forms: [string, string, string]): string {
  return `${n.toLocaleString(LOCALE)} ${plural(n, forms)}`
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

const unit = () => (isEn ? { h: 'h', min: 'min', sec: 's' } : { h: 'ч', min: 'мин', sec: 'с' })

/** 41 ч 12 мин, 25 мин, 40 с (41 h 12 min) */
export function formatListen(ms: number): string {
  const min = Math.round(ms / 60000)
  if (ms <= 0) return `0 ${unit().min}`
  if (min < 1) return `${Math.round(ms / 1000)} ${unit().sec}`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} ${unit().min}`
  return m ? `${h} ${unit().h} ${m} ${unit().min}` : `${h} ${unit().h}`
}

/* ---------------- месяцы и даты ---------------- */

const MONTHS_GEN_RU = [
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
const MONTHS_RU = [
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
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const SHORT_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const SHORT_GEN_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Названия месяцев с большой буквы: «Октябрь», «October» (массив тот же, содержимое — на текущем языке) */
export const MONTHS: string[] = []
/** Короткие: «окт», «Oct» */
export const MONTHS_SHORT: string[] = []
function fillMonths() {
  MONTHS.splice(0, 12, ...(isEn ? MONTHS_EN : MONTHS_RU))
  MONTHS_SHORT.splice(0, 12, ...(isEn ? SHORT_EN : SHORT_RU))
}
fillMonths()
onLangChange(fillMonths)

/** «12 октября» / «October 12» (с годом — «12 октября 2026» / «October 12, 2026») */
export function dayMonth(d: Date, withYear = false): string {
  if (isEn) return `${MONTHS_EN[d.getMonth()]} ${d.getDate()}${withYear ? `, ${d.getFullYear()}` : ''}`
  return `${d.getDate()} ${MONTHS_GEN_RU[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`
}

/** Коротко: «12 окт» / «Oct 12» */
export function dayMonthShort(d: Date): string {
  return isEn ? `${SHORT_EN[d.getMonth()]} ${d.getDate()}` : `${d.getDate()} ${SHORT_GEN_RU[d.getMonth()]}`
}

/** Отрезок дней: «6–12 октября», «29 сентября – 5 октября» / «Oct 6–12», «Sep 29 – Oct 5» (с годом в конце) */
export function dayRange(a: Date, b: Date, withYear = false): string {
  const year = withYear ? (isEn ? `, ${b.getFullYear()}` : ` ${b.getFullYear()}`) : ''
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return isEn
      ? `${MONTHS_EN[a.getMonth()]} ${a.getDate()}–${b.getDate()}${year}`
      : `${a.getDate()}–${b.getDate()} ${MONTHS_GEN_RU[b.getMonth()]}${year}`
  }
  return isEn
    ? `${MONTHS_EN[a.getMonth()]} ${a.getDate()} – ${MONTHS_EN[b.getMonth()]} ${b.getDate()}${year}`
    : `${a.getDate()} ${MONTHS_GEN_RU[a.getMonth()]} – ${b.getDate()} ${MONTHS_GEN_RU[b.getMonth()]}${year}`
}

/** «Октябрь 2026» / «October 2026» */
export function monthYear(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** сегодня, вчера, 3 дня назад, 12 марта, 12 марта 2024 */
export function relativeDay(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return t('никогда')
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000)
  if (days <= 0) return t('сегодня')
  if (days === 1) return t('вчера')
  if (days < 7) return t('{0} назад', `${days} ${plural(days, tp('день|дня|дней'))}`)
  const d = new Date(ts)
  return dayMonth(d, d.getFullYear() !== new Date(now).getFullYear())
}

export function formatDate(ts: number): string {
  return dayMonth(new Date(ts), true)
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} ${isEn ? 'KB' : 'КБ'}`
  const mb = (n / 1024 / 1024).toFixed(1)
  return isEn ? `${mb} MB` : `${mb.replace('.', ',')} МБ`
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h >= 5 && h < 12) return t('Доброе утро')
  if (h >= 12 && h < 17) return t('Добрый день')
  if (h >= 17 && h < 23) return t('Добрый вечер')
  return t('Доброй ночи')
}
