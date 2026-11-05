import type { PlaySource, SourceType } from '@/native/types'
import { $t } from '@/i18n'

const TYPE_LABEL: Record<SourceType, string> = {
  library: $t('Медиатека'),
  album: $t('Альбом'),
  artist: $t('Исполнитель'),
  folder: $t('Папка'),
  genre: $t('Жанр'),
  playlist: $t('Плейлист'),
  smart: $t('Подборка'),
  favorites: $t('Избранное'),
  top: $t('Рейтинг'),
  search: $t('Поиск'),
  radio: $t('Радио'),
  era: $t('Эпоха'),
  context: $t('Контекст'),
  track: $t('Трек'),
}

export function sourceLabel(s: PlaySource): string {
  return s.title || TYPE_LABEL[s.type]
}
