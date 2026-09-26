import type { PlaySource, SourceType } from '@/native/types'

const TYPE_LABEL: Record<SourceType, string> = {
  library: 'Медиатека',
  album: 'Альбом',
  artist: 'Исполнитель',
  folder: 'Папка',
  genre: 'Жанр',
  playlist: 'Плейлист',
  smart: 'Подборка',
  favorites: 'Избранное',
  top: 'Рейтинг',
  search: 'Поиск',
  radio: 'Радио',
  era: 'Эпоха',
  context: 'Контекст',
  track: 'Трек',
}

export function sourceLabel(s: PlaySource): string {
  return s.title || TYPE_LABEL[s.type]
}
