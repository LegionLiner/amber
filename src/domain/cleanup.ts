import { parseFileName, stripJunk } from './names'
import type { Track } from './track'
import { $t } from '@/i18n'

/**
 * Уборка тегов: находит мусор и предлагает исправления, ничего не меняя без спроса.
 *  - водяные знаки сайтов («(zaycev.net)», «www.muzmo.ru»);
 *  - номер трека в названии («01. Название»);
 *  - КАПСЛОК;
 *  - пустые теги, которые можно взять из имени файла («Исполнитель - Название.mp3»);
 *  - лишние пробелы.
 */

export type FixField = 'title' | 'artist' | 'album'

export interface Fix {
  key: string
  field: FixField
  before: string
  after: string
  reason: 'junk' | 'number' | 'caps' | 'fromFile' | 'spaces'
}

export const REASON_LABEL: Record<Fix['reason'], string> = {
  get junk() {
    return $t('Мусор сайта')
  },
  get number() {
    return $t('Номер в названии')
  },
  get caps() {
    return $t('Капслок')
  },
  get fromFile() {
    return $t('Из имени файла')
  },
  get spaces() {
    return $t('Пробелы')
  },
}

const hasLetters = (s: string) => /\p{L}{3,}/u.test(s)

/** «ГРУППА КРОВИ» → «Группа крови», «MIDNIGHT AVENUE» → «Midnight Avenue» */
export function fixCaps(s: string): string {
  const latin = /[a-z]/i.test(s) && !/[а-яё]/i.test(s)
  const lower = s.toLocaleLowerCase('ru')
  if (latin) return lower.replace(/(^|[\s([{"'«-])(\p{L})/gu, (_, p: string, c: string) => p + c.toLocaleUpperCase('en'))
  return lower.replace(/^(\P{L}*)(\p{L})/u, (_, p: string, c: string) => p + c.toLocaleUpperCase('ru'))
}

function isShouting(s: string): boolean {
  const letters = s.match(/\p{L}/gu) ?? []
  if (letters.length < 4) return false
  const upper = letters.filter((c) => c === c.toLocaleUpperCase('ru') && c !== c.toLocaleLowerCase('ru')).length
  return upper / letters.length > 0.9
}

function suggest(key: string, field: FixField, value: string | null, out: Fix[]) {
  if (!value) return
  let v = value
  const push = (after: string, reason: Fix['reason']) => {
    if (after && after !== v && hasLetters(after)) {
      out.push({ key, field, before: value, after, reason })
      v = after
    }
  }
  push(stripJunk(v), 'junk')
  if (field === 'title') push(v.replace(/^\d{1,3}\s*[.)\-–—]\s*(?=\S)/, ''), 'number')
  if (isShouting(v)) push(fixCaps(v), 'caps')
  push(v.replace(/\s{2,}/g, ' ').trim(), 'spaces')
}

/** Все подсказки для библиотеки; на одно поле — одна итоговая правка (цепочка причин схлопывается) */
export function findFixes(tracks: Track[]): Fix[] {
  const raw: Fix[] = []
  for (const t of tracks) {
    const cur = {
      title: t.overrides.title ?? t.tags.title,
      artist: t.overrides.artist ?? t.tags.artist,
      album: t.overrides.album ?? t.tags.album,
    }
    suggest(t.key, 'title', cur.title, raw)
    suggest(t.key, 'artist', cur.artist, raw)
    suggest(t.key, 'album', cur.album, raw)
    if (!cur.title || !cur.artist) {
      const p = parseFileName(t.fileName)
      if (!cur.title && p.title) raw.push({ key: t.key, field: 'title', before: '', after: p.title, reason: 'fromFile' })
      if (!cur.artist && p.artist) raw.push({ key: t.key, field: 'artist', before: '', after: p.artist, reason: 'fromFile' })
    }
  }
  // Схлопываем цепочки: «01. ТРЕК (site.ru)» → одна правка с первой причиной и последним результатом
  const merged = new Map<string, Fix>()
  for (const f of raw) {
    const id = `${f.key}|${f.field}`
    const prev = merged.get(id)
    merged.set(id, prev ? { ...prev, after: f.after } : f)
  }
  return [...merged.values()]
}
