import { describe, expect, it } from 'vitest'
import { coverTones, glow, hexToLch } from '@/domain/cover-colors'
import { cleanEffects, effectsLabel } from '@/domain/effects'

/** Картинка из долей: [rgb, доля площади] */
function image(parts: [[number, number, number], number][], size = 1600): number[] {
  const px: number[] = []
  for (const [rgb, share] of parts) {
    for (let i = 0; i < Math.round(share * size); i++) px.push(rgb[0], rgb[1], rgb[2], 255)
  }
  return px
}
const hueDeg = (hex: string) => {
  const h = (hexToLch(hex)!.h * 180) / Math.PI
  return (h + 360) % 360
}
const chroma = (hex: string) => hexToLch(hex)!.C

describe('цвета фона по обложке', () => {
  it('чёрно-белое фото с лёгким оттенком плёнки остаётся серым', () => {
    const t = coverTones(
      image([
        [[40, 42, 46], 0.3],
        [[120, 122, 126], 0.4],
        [[200, 201, 204], 0.3],
      ]),
    )!
    expect(t.neutral).toBe(true)
    expect(chroma(glow(t.c1))).toBeLessThan(0.02)
    expect(chroma(glow(t.c2))).toBeLessThan(0.02)
  })

  it('белая рамка вокруг лавандового фото: фон лавандовый, а не рыжий от мелкой детали', () => {
    const t = coverTones(
      image([
        [[250, 250, 250], 0.6],
        [[190, 160, 215], 0.3],
        [[200, 60, 30], 0.04],
        [[110, 95, 90], 0.06],
      ]),
    )!
    expect(t.neutral).toBe(false)
    const h = hueDeg(glow(t.c1))
    expect(h).toBeGreaterThan(280)
    expect(h).toBeLessThan(345)
  })

  it('большое спокойное поле важнее маленькой яркой детали', () => {
    const t = coverTones(
      image([
        [[40, 70, 110], 0.9],
        [[255, 40, 40], 0.05],
        [[0, 0, 0], 0.05],
      ]),
    )!
    const h = hueDeg(glow(t.c1))
    expect(h).toBeGreaterThan(220)
    expect(h).toBeLessThan(275)
  })

  it('два заметных цвета — два разных тона', () => {
    const t = coverTones(
      image([
        [[30, 90, 60], 0.5],
        [[230, 180, 60], 0.5],
      ]),
    )!
    expect(Math.abs(hueDeg(glow(t.c1)) - hueDeg(glow(t.c2)))).toBeGreaterThan(40)
  })

  it('однотонная обложка — второй цвет того же тона, но другой яркости', () => {
    const t = coverTones(
      image([
        [[150, 40, 60], 0.5],
        [[90, 20, 35], 0.5],
      ]),
    )!
    expect(Math.abs(hueDeg(glow(t.c1)) - hueDeg(glow(t.c2)))).toBeLessThan(20)
    expect(Math.abs(t.c1.L - t.c2.L)).toBeGreaterThan(0.08)
  })

  it('пятно видно на обеих темах: яркость в середине', () => {
    const dark = coverTones(image([[[20, 10, 40], 1]]))!
    const L = hexToLch(glow(dark.c1))!.L
    expect(L).toBeGreaterThanOrEqual(0.55)
    expect(L).toBeLessThanOrEqual(0.75)
  })
})

describe('эффекты', () => {
  it('выключенные убираются, сила округляется', () => {
    expect(cleanEffects({ echo: 0.456, reverb: 0, bass: 1.4 })).toEqual({ echo: 0.46, bass: 1 })
    expect(effectsLabel({ reverb: 0.5, echo: 0.2 })).toBe('Эхо, Зал')
    expect(effectsLabel({})).toBe('')
  })
})
