/**
 * Язык главного процесса: трей, кнопки на панели задач, системные диалоги и ошибки загрузчиков.
 * Пока окно не сообщило язык интерфейса, берётся сохранённый или системный.
 */
export type Lang = 'ru' | 'en'

let current: Lang = 'ru'

export function setMainLang(l: Lang): void {
  current = l
}

export function mainLang(): Lang {
  return current
}

/** Строка на языке интерфейса */
export function tr(ru: string, en: string): string {
  return current === 'en' ? en : ru
}
