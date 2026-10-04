import { describe, expect, it } from 'vitest'
import { splitYoutubeTitle } from '@/domain/youtube'

describe('название ролика YouTube', () => {
  it('«Исполнитель — Название» с пометками в скобках', () => {
    expect(splitYoutubeTitle('Кино - Группа крови (Official Video)', 'Kino Official')).toEqual(['Кино', 'Группа крови'])
    expect(splitYoutubeTitle('Сплин — Выхода нет [HD]', 'x')).toEqual(['Сплин', 'Выхода нет'])
  })
  it('без тире исполнитель — канал без « - Topic»', () => {
    expect(splitYoutubeTitle('Me at the zoo', 'jawed')).toEqual(['jawed', 'Me at the zoo'])
    expect(splitYoutubeTitle('Ночной проспект', 'Полночь - Topic')).toEqual(['Полночь', 'Ночной проспект'])
    expect(splitYoutubeTitle('Трек', '')).toEqual(['YouTube', 'Трек'])
  })
})
