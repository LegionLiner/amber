import type { PlaySource, SourceType } from '@/native/types'
import { $t } from '@/i18n'

const TYPE_LABEL: Record<SourceType, string> = {
  get library() {
    return $t('Медиатека')
  },
  get album() {
    return $t('Альбом')
  },
  get artist() {
    return $t('Исполнитель')
  },
  get folder() {
    return $t('Папка')
  },
  get genre() {
    return $t('Жанр')
  },
  get playlist() {
    return $t('Плейлист')
  },
  get smart() {
    return $t('Подборка')
  },
  get favorites() {
    return $t('Избранное')
  },
  get top() {
    return $t('Рейтинг')
  },
  get search() {
    return $t('Поиск')
  },
  get radio() {
    return $t('Радио')
  },
  get era() {
    return $t('Эпоха')
  },
  get context() {
    return $t('Контекст')
  },
  get track() {
    return $t('Трек')
  },
}

export function sourceLabel(s: PlaySource): string {
  return s.title || TYPE_LABEL[s.type]
}
