import type { FadeCurve, QueueItem, Transition, TransitionType } from '@/native/types'

/**
 * Миксы: плейлист, где у каждого стыка свой переход, как у диджея.
 * Переход хранится у трека, который ВХОДИТ (playlist_items.transition):
 *  - type/durationMs/curve/duckDb — как звучит стык;
 *  - outAtMs — где в предыдущем треке начинать переход (от начала трека);
 *  - cueMs — с какого места входит этот трек.
 */
export interface MixTransition {
  type: TransitionType
  durationMs: number
  curve: FadeCurve
  duckDb?: number
  outAtMs?: number
  cueMs?: number
}

export const DEFAULT_MIX_TRANSITION: MixTransition = { type: 'crossfade', durationMs: 8000, curve: 'equalPower' }

export const TRANSITION_LABEL: Record<TransitionType, string> = {
  gapless: 'Встык',
  crossfade: 'Кроссфейд',
  overlay: 'Наложение',
  fadeOutIn: 'Затухание',
  cut: 'Резко',
}

export function parseTransition(json: string | null): MixTransition | null {
  if (!json) return null
  try {
    return JSON.parse(json) as MixTransition
  } catch {
    return null
  }
}

/** Переход миксa → поля элемента очереди, которые понимает движок */
export function applyMixTransition(item: QueueItem, tx: MixTransition | null): QueueItem {
  if (!tx) return item
  const t: Transition = { type: tx.type, durationMs: tx.durationMs, curve: tx.curve, duckDb: tx.duckDb, outAtMs: tx.outAtMs }
  return { ...item, transitionIn: t, trimStartMs: tx.cueMs ?? item.trimStartMs }
}
