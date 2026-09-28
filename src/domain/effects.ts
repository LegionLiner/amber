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
  { id: 'echo', label: 'Эхо', hint: 'повтор через треть секунды', initial: 0.5 },
  { id: 'reverb', label: 'Зал', hint: 'реверберация, как в большом помещении', initial: 0.5 },
  { id: 'bass', label: 'Бас', hint: 'низы плотнее', initial: 0.5 },
  { id: 'wide', label: 'Шире', hint: 'стерео раздвигается', initial: 0.6 },
  { id: 'orbit', label: '8D', hint: 'звук ходит вокруг головы, в наушниках', initial: 0.8 },
  { id: 'wall', label: 'За стеной', hint: 'как музыка у соседей', initial: 0.7 },
  { id: 'radio', label: 'Радио', hint: 'старый приёмник', initial: 0.8 },
  { id: 'karaoke', label: 'Караоке', hint: 'голос тише — если он в центре микса', initial: 0.9 },
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
