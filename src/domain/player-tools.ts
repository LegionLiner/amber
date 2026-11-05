import { $t } from '@/i18n'
/**
 * Быстрые кнопки внизу экрана плеера на телефоне: какие и в каком порядке — выбирается в настройках.
 * Всё остальное по-прежнему в меню «⋯» плеера.
 */
export type PlayerToolId = 'sound' | 'lyrics' | 'sleep' | 'queue' | 'marks' | 'playlist' | 'tags' | 'card' | 'radio' | 'stage'

export const PLAYER_TOOLS: { id: PlayerToolId; label: string }[] = [
  { id: 'sound', label: $t('Звук и эффекты') },
  { id: 'lyrics', label: $t('Текст песни') },
  { id: 'sleep', label: $t('Сон-таймер') },
  { id: 'queue', label: $t('Очередь') },
  { id: 'marks', label: $t('Метки и лучшие моменты') },
  { id: 'playlist', label: $t('В плейлист') },
  { id: 'tags', label: $t('Изменить теги') },
  { id: 'card', label: $t('Карточка трека') },
  { id: 'radio', label: $t('Радио по треку') },
  { id: 'stage', label: $t('Сцена') },
]

/** Как было до настройки */
export const DEFAULT_PLAYER_TOOLS: PlayerToolId[] = ['sound', 'lyrics', 'sleep', 'queue']

/** Больше не помещается в строку рядом с кнопкой вывода звука на узком телефоне */
export const MAX_PLAYER_TOOLS = 5

/** Сохранённый список без мусора: известные кнопки, без повторов, не больше пяти */
export function cleanTools(list: readonly string[]): PlayerToolId[] {
  const known = new Set(PLAYER_TOOLS.map((t) => t.id))
  const out: PlayerToolId[] = []
  for (const id of list) if (known.has(id as PlayerToolId) && !out.includes(id as PlayerToolId)) out.push(id as PlayerToolId)
  return out.slice(0, MAX_PLAYER_TOOLS)
}
