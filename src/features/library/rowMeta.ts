import type { RowDetail, RowMeta } from '@/components/TrackRow.vue'
import type { Track } from '@/domain/track'
import { formatDuration, formatListen, relativeDay } from '@/domain/format'
import { isDesktop } from '@/native/desktop/bridge'
import { $t } from '@/i18n'

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

/**
 * Таблица треков в окне компьютера: альбом, длительность и третья колонка — то, по чему список
 * отсортирован (по умолчанию — когда трек появился в медиатеке).
 */
export function detailFor(sortKey: string, album = true): { label: string; of: (t: Track) => RowDetail } {
  const row = (extra: (t: Track) => string) => (t: Track) => ({
    album: album ? (t.album ?? '') : null,
    added: extra(t),
    duration: formatDuration(t.durationMs),
  })
  switch (sortKey) {
    case 'plays':
      return { label: $t('Прослушиваний'), of: row((t) => (t.plays ? String(t.plays) : '—')) }
    case 'lastPlayed':
      return { label: $t('Слушал'), of: row((t) => (t.lastPlayedAt ? relativeDay(t.lastPlayedAt) : '—')) }
    case 'listened':
      return { label: $t('Наслушано'), of: row((t) => (t.listenedMs ? formatListen(t.listenedMs) : '—')) }
    case 'skips':
      return { label: $t('Пропусков'), of: row((t) => (t.skips ? String(t.skips) : '—')) }
    case 'year':
      return { label: $t('Год'), of: row((t) => (t.year ? String(t.year) : '—')) }
    default:
      return { label: $t('Добавлен'), of: row((t) => relativeDay(t.addedAt)) }
  }
}

/**
 * Таблица на страницах наборов (альбом, исполнитель, жанр, папка, подборка). Только в окне компьютера:
 * на телефоне строки остаются как были. album: false — без колонки альбома (страница самого альбома).
 */
export function tableFor(sortKey: string, album = true) {
  return isDesktop ? detailFor(sortKey, album) : null
}
