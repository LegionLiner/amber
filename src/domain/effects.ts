import { $t } from '@/i18n'
/**
 * Эффекты звука. На телефоне — процессор SoundEffects.kt в звуке каждой деки, в браузере — узлы Web Audio
 * (native/web/audio-effects.ts). Сила каждого эффекта 0..1, отсутствует или 0 — выключен.
 */
export type EffectId = 'echo' | 'reverb' | 'bass' | 'wide' | 'orbit' | 'wall' | 'radio' | 'karaoke'
export type Effects = Partial<Record<EffectId, number>>

export interface EffectDef {
  id: EffectId
  label: string
  hint: string
  /** Сила при включении */
  initial: number
}

export const EFFECTS: EffectDef[] = [
  { id: 'echo', label: $t('Эхо'), hint: $t('повтор через треть секунды'), initial: 0.5 },
  { id: 'reverb', label: $t('Зал'), hint: $t('реверберация, как в большом помещении'), initial: 0.5 },
  { id: 'bass', label: $t('Бас'), hint: $t('низы плотнее'), initial: 0.5 },
  { id: 'wide', label: $t('Шире'), hint: $t('стерео раздвигается'), initial: 0.6 },
  { id: 'orbit', label: '8D', hint: $t('звук ходит вокруг головы, в наушниках'), initial: 0.8 },
  { id: 'wall', label: $t('За стеной'), hint: $t('как музыка у соседей'), initial: 0.7 },
  { id: 'radio', label: $t('Радио'), hint: $t('старый приёмник'), initial: 0.8 },
  { id: 'karaoke', label: $t('Караоке'), hint: $t('голос тише — если он в центре микса'), initial: 0.9 },
]

/** Только включённые эффекты, сила округлена до сотых */
export function cleanEffects(fx: Effects): Effects {
  const out: Effects = {}
  for (const d of EFFECTS) {
    const v = fx[d.id]
    if (v != null && v > 0.001) out[d.id] = Math.round(Math.min(1, v) * 100) / 100
  }
  return out
}

export function effectsLabel(fx: Effects): string {
  return EFFECTS.filter((d) => (fx[d.id] ?? 0) > 0)
    .map((d) => d.label)
    .join(', ')
}

/** Свой пресет звука: скорость, тон и эффекты одной кнопкой */
export interface SoundPreset {
  id: string
  name: string
  speed: number
  pitch: number
  effects: Effects
}

export interface Sound {
  speed: number
  pitch: number
  effects: Effects
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.006

export function sameSound(a: Sound, b: Sound): boolean {
  if (!near(a.speed, b.speed) || !near(a.pitch, b.pitch)) return false
  return EFFECTS.every((d) => near(a.effects[d.id] ?? 0, b.effects[d.id] ?? 0))
}

/** Звук без изменений: обычная скорость, тон и ни одного эффекта */
export function plainSound(s: Sound): boolean {
  return sameSound(s, { speed: 1, pitch: 1, effects: {} })
}

/** Название по умолчанию для нового пресета: «0.85× с тоном · Зал» */
export function soundName(s: Sound): string {
  const parts: string[] = []
  if (!near(s.speed, 1) || !near(s.pitch, 1)) {
    const x = `${Number(s.speed.toFixed(2))}×`
    parts.push(near(s.pitch, s.speed) && !near(s.speed, 1) ? $t('{0} с тоном', x) : x)
  }
  const fx = effectsLabel(s.effects)
  if (fx) parts.push(fx)
  return parts.join(' · ') || $t('Как есть')
}
