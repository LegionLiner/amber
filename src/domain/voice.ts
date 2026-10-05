/**
 * Голосовые команды компьютерной версии: «Эмбер, следующий», «Эмбер, тише».
 * Распознавание — офлайн (Vosk) по короткому списку фраз, а не по свободной речи: так оно не путает
 * команды с разговором и музыкой. Здесь — сами фразы и разбор услышанного.
 *
 * Команда без «Эмбер» срабатывает, только если «Эмбер» прозвучало только что (сказал «Эмбер»,
 * подождал, пока музыка притихнет, и сказал команду) — иначе случайное «назад» в разговоре не листает треки.
 */

export type VoiceCommand = 'pause' | 'play' | 'next' | 'prev' | 'quieter' | 'louder' | 'like'

/** Как модель слышит «Эмбер»: оба варианта есть в её словаре */
export const WAKE_WORDS = ['эмбер', 'амбер']

export const COMMAND_WORDS: Record<VoiceCommand, string[]> = {
  pause: ['стоп', 'пауза', 'хватит', 'останови'],
  play: ['продолжи', 'продолжай', 'играй', 'включи'],
  next: ['следующий', 'следующая', 'следующую', 'дальше'],
  prev: ['предыдущий', 'предыдущая', 'назад'],
  quieter: ['тише', 'потише'],
  louder: ['громче', 'погромче'],
  like: ['лайк', 'нравится'],
}

export const COMMAND_LABELS: Record<VoiceCommand, string> = {
  pause: 'Пауза',
  play: 'Играю',
  next: 'Следующий',
  prev: 'Предыдущий',
  quieter: 'Тише',
  louder: 'Громче',
  like: 'В избранное',
}

/** Слова, которые можно добавить после команды: «следующий трек», «включи музыку» */
const TAIL = ['трек', 'песню', 'музыку']

/** Фразы для распознавателя. «[unk]» — всё остальное: разговор, пение, шум */
export function voiceGrammar(): string[] {
  const commands = Object.values(COMMAND_WORDS).flat()
  const phrases = new Set<string>()
  for (const c of commands) {
    phrases.add(c)
    for (const t of TAIL) phrases.add(`${c} ${t}`)
  }
  for (const w of WAKE_WORDS) {
    phrases.add(w)
    for (const c of [...phrases]) if (!WAKE_WORDS.some((x) => c.startsWith(x))) phrases.add(`${w} ${c}`)
  }
  return [...phrases, '[unk]']
}

const byWord = new Map<string, VoiceCommand>(
  (Object.entries(COMMAND_WORDS) as [VoiceCommand, string[]][]).flatMap(([cmd, words]) => words.map((w) => [w, cmd])),
)

export interface Heard {
  /** Прозвучало «Эмбер» */
  wake: boolean
  /** Команда в этой же фразе (последняя, если их несколько) */
  command: VoiceCommand | null
}

export function parseVoice(text: string): Heard {
  const words = text.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean)
  let wake = false
  let command: VoiceCommand | null = null
  for (const w of words) {
    if (WAKE_WORDS.includes(w)) wake = true
    const c = byWord.get(w)
    if (c) command = c
  }
  return { wake, command }
}

/** Сколько после «Эмбер» ждём команду отдельной фразой */
export const ARMED_MS = 5000
