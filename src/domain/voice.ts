import { $t } from '@/i18n'

/**
 * Голосовые команды компьютерной версии: «Эмбер, следующий» или «Amber, next».
 * Распознавание — офлайн (Vosk) по короткому списку фраз, а не по свободной речи: так оно не путает
 * команды с разговором и музыкой. Здесь — сами фразы на двух языках и разбор услышанного.
 * Язык команд — свой (настройка voiceLang), у каждого языка своя модель речи.
 *
 * Команда без «Эмбер» срабатывает, только если «Эмбер» прозвучало только что (сказал «Эмбер»,
 * подождал, пока музыка притихнет, и сказал команду) — иначе случайное «назад» в разговоре не листает треки.
 */

export type VoiceCommand = 'pause' | 'play' | 'next' | 'prev' | 'quieter' | 'louder' | 'like'
export type VoiceLang = 'ru' | 'en'

interface Lexicon {
  /** Как модель слышит «Эмбер» */
  wake: string[]
  /** Фразы команд: слово или несколько слов подряд */
  commands: Record<VoiceCommand, string[]>
  /** Слова, которые можно добавить после команды: «следующий трек», «next song» */
  tail: string[]
}

const LEXICONS: Record<VoiceLang, Lexicon> = {
  ru: {
    // Оба варианта есть в словаре русской модели
    wake: ['эмбер', 'амбер'],
    commands: {
      pause: ['стоп', 'пауза', 'хватит', 'останови'],
      play: ['продолжи', 'продолжай', 'играй', 'включи'],
      next: ['следующий', 'следующая', 'следующую', 'дальше'],
      prev: ['предыдущий', 'предыдущая', 'назад'],
      quieter: ['тише', 'потише'],
      louder: ['громче', 'погромче'],
      like: ['лайк', 'нравится'],
    },
    tail: ['трек', 'песню', 'музыку'],
  },
  en: {
    wake: ['amber', 'ember'],
    commands: {
      pause: ['stop', 'pause'],
      play: ['play', 'resume', 'continue'],
      next: ['next', 'skip'],
      prev: ['previous', 'back', 'go back'],
      quieter: ['quieter', 'volume down', 'turn it down'],
      louder: ['louder', 'volume up', 'turn it up'],
      like: ['like', 'favorite', 'love it'],
    },
    tail: ['track', 'song', 'music'],
  },
}

/** Подпись выполненной команды (в подсказке и в настройках) — на языке интерфейса */
export function commandLabel(cmd: VoiceCommand): string {
  const labels: Record<VoiceCommand, string> = {
    pause: $t('Пауза'),
    play: $t('Играю'),
    next: $t('Следующий'),
    prev: $t('Предыдущий'),
    quieter: $t('Тише'),
    louder: $t('Громче'),
    like: $t('В избранное'),
  }
  return labels[cmd]
}

/** Фразы для распознавателя. «[unk]» — всё остальное: разговор, пение, шум */
export function voiceGrammar(lang: VoiceLang = 'ru'): string[] {
  const lx = LEXICONS[lang]
  const phrases = new Set<string>()
  for (const c of Object.values(lx.commands).flat()) {
    phrases.add(c)
    for (const t of lx.tail) phrases.add(`${c} ${t}`)
  }
  for (const w of lx.wake) {
    phrases.add(w)
    for (const c of [...phrases]) if (!lx.wake.some((x) => c.startsWith(x))) phrases.add(`${w} ${c}`)
  }
  return [...phrases, '[unk]']
}

export interface Heard {
  /** Прозвучало «Эмбер» */
  wake: boolean
  /** Команда в этой же фразе (последняя, если их несколько) */
  command: VoiceCommand | null
}

export function parseVoice(text: string, lang: VoiceLang = 'ru'): Heard {
  const lx = LEXICONS[lang]
  const words = text.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean)
  const wake = words.some((w) => lx.wake.includes(w))
  // Ищем фразы команд по месту в тексте: побеждает та, что прозвучала последней («стоп… нет, дальше»)
  const line = ` ${words.join(' ')} `
  let command: VoiceCommand | null = null
  let at = -1
  for (const [cmd, phrases] of Object.entries(lx.commands) as [VoiceCommand, string[]][]) {
    for (const p of phrases) {
      const i = line.lastIndexOf(` ${p} `)
      if (i > at) {
        at = i
        command = cmd
      }
    }
  }
  return { wake, command }
}

/** Сколько после «Эмбер» ждём команду отдельной фразой */
export const ARMED_MS = 5000
