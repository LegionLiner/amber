import { describe, expect, it } from 'vitest'
import { ACCENTS, BACKDROPS, themeVars } from '@/domain/themes'
import { cleanTools, MAX_PLAYER_TOOLS } from '@/domain/player-tools'

describe('темы', () => {
  it('по умолчанию — ровно прежние цвета (янтарь на тёплом)', () => {
    const v = themeVars('dark', 'amber', 'warm')
    expect(v['--bg']).toBe('#0e0d0c')
    expect(v['--amber']).toBe('#ffb23e')
    expect(v['--amber-rgb']).toBe('255, 178, 62')
    expect(themeVars('light', 'amber', 'warm')['--amber-ink']).toBe('#9e5300')
  })

  it('каждое сочетание даёт полный набор цветов', () => {
    for (const shade of ['dark', 'light'] as const)
      for (const a of ACCENTS)
        for (const b of BACKDROPS) {
          const v = themeVars(shade, a.id, b.id)
          for (const k of ['--bg', '--surface', '--ink', '--amber', '--on-amber']) expect(v[k]).toMatch(/^#[0-9a-f]{6}$/)
          expect(v['--amber-rgb']).toMatch(/^\d+, \d+, \d+$/)
        }
  })

  it('чёрный фон только в тёмной теме, в светлой — тёплый', () => {
    expect(themeVars('dark', 'amber', 'black')['--bg']).toBe('#000000')
    expect(themeVars('light', 'amber', 'black')['--bg']).toBe(themeVars('light', 'amber', 'warm')['--bg'])
  })

  it('«в цвет акцента» подкрашивает фон в сторону акцента', () => {
    const rose = themeVars('dark', 'rose', 'tinted')['--bg']!
    const ocean = themeVars('dark', 'ocean', 'tinted')['--bg']!
    const red = (h: string) => parseInt(h.slice(1, 3), 16)
    const blue = (h: string) => parseInt(h.slice(5, 7), 16)
    expect(red(rose)).toBeGreaterThan(red(ocean))
    expect(blue(ocean)).toBeGreaterThan(blue(rose))
  })
})

describe('кнопки плеера', () => {
  it('из сохранённого — только известные, без повторов и не больше пяти', () => {
    expect(cleanTools(['card', 'sleep', 'card', 'unknown', 'queue', 'lyrics', 'sound', 'stage'])).toEqual([
      'card',
      'sleep',
      'queue',
      'lyrics',
      'sound',
    ])
    expect(cleanTools(['card', 'sleep', 'queue', 'lyrics', 'sound', 'stage'])).toHaveLength(MAX_PLAYER_TOOLS)
  })
})
