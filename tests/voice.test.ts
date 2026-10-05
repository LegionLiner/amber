import { describe, expect, it } from 'vitest'
import { parseVoice, voiceGrammar } from '@/domain/voice'

describe('голосовые команды', () => {
  it('разбор фраз', () => {
    expect(parseVoice('эмбер следующий')).toEqual({ wake: true, command: 'next' })
    expect(parseVoice('амбер стоп')).toEqual({ wake: true, command: 'pause' })
    expect(parseVoice('эмбер')).toEqual({ wake: true, command: null })
    expect(parseVoice('назад')).toEqual({ wake: false, command: 'prev' })
    expect(parseVoice('эмбер включи музыку')).toEqual({ wake: true, command: 'play' })
    expect(parseVoice('[unk]')).toEqual({ wake: false, command: null })
    expect(parseVoice('')).toEqual({ wake: false, command: null })
  })

  it('фразы для распознавателя: с «Эмбер», без него и «всё остальное»', () => {
    const g = voiceGrammar()
    expect(g).toContain('эмбер следующий')
    expect(g).toContain('амбер тише')
    expect(g).toContain('эмбер следующий трек')
    expect(g).toContain('громче')
    expect(g).toContain('эмбер')
    expect(g.at(-1)).toBe('[unk]')
    expect(new Set(g).size).toBe(g.length)
  })
})
