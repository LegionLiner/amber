import type { RowMeta } from '@/components/TrackRow.vue'
import type { Track } from '@/domain/track'
import { formatDuration, formatListen, relativeDay } from '@/domain/format'

/** Правая колонка строки показывает то, по чему сейчас отсортирован список */
export function metaFor(sortKey: string): (t: Track) => RowMeta {
  switch (sortKey) {
    case 'rating':
      return (t) => ({ kind: 'stars', rating: t.rating })
    case 'plays':
      return (t) => ({ kind: 'text', text: t.plays ? `${t.plays}×` : '' })
    case 'added':
      return (t) => ({ kind: 'text', text: relativeDay(t.addedAt) })
    case 'lastPlayed':
      return (t) => ({ kind: 'text', text: t.lastPlayedAt ? relativeDay(t.lastPlayedAt) : '' })
    case 'listened':
      return (t) => ({ kind: 'text', text: t.listenedMs ? formatListen(t.listenedMs) : '' })
    case 'skips':
      return (t) => ({ kind: 'text', text: t.skips ? String(t.skips) : '' })
    case 'year':
      return (t) => ({ kind: 'text', text: t.year ? String(t.year) : '' })
    default:
      return (t) => ({ kind: 'text', text: formatDuration(t.durationMs) })
  }
}
