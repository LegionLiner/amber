import { describe, expect, it } from 'vitest'
import { normKey, parseFileName, splitArtists, stripJunk } from '@/domain/names'
import { DEFAULT_COUNTING, isCounted } from '@/domain/counting'

describe('stripJunk', () => {
  it('убирает водяные знаки сайтов', () => {
    expect(stripJunk('Трек (zaycev.net)')).toBe('Трек')
    expect(stripJunk('Трек [muzmo.ru]')).toBe('Трек')
    expect(stripJunk('Song (musify.club)')).toBe('Song')
    expect(stripJunk('Кино - Звезда - www.muzofon.com')).toBe('Кино - Звезда')
    expect(stripJunk('Песня скачать бесплатно mp3')).toBe('Песня')
  })
  it('не трогает обычные скобки', () => {
    expect(stripJunk('Лето (live)')).toBe('Лето (live)')
  })
})

describe('parseFileName', () => {
  it('номер, исполнитель и название', () => {
    expect(parseFileName('01. Кино - Группа крови.mp3')).toEqual({ trackNo: 1, artist: 'Кино', title: 'Группа крови' })
  })
  it('только название', () => {
    expect(parseFileName('Группа крови.mp3')).toEqual({ trackNo: null, artist: null, title: 'Группа крови' })
  })
  it('мусор и длинное тире', () => {
    expect(parseFileName('Полночь — Неон (zaycev.net).mp3')).toEqual({ trackNo: null, artist: 'Полночь', title: 'Неон' })
  })
  it('год в начале не считается номером трека', () => {
    expect(parseFileName('1984 - Stuff.mp3')).toEqual({ trackNo: null, artist: '1984', title: 'Stuff' })
  })
  it('номер без точки', () => {
    expect(parseFileName('07 Blue Hours.mp3')).toEqual({ trackNo: 7, artist: null, title: 'Blue Hours' })
  })
})

describe('splitArtists', () => {
  it('feat. и перечисления', () => {
    expect(splitArtists('Скриптонит feat. 104')).toEqual(['Скриптонит', '104'])
    expect(splitArtists('A & B, C')).toEqual(['A', 'B', 'C'])
    expect(splitArtists('Кино')).toEqual(['Кино'])
    expect(splitArtists(null)).toEqual([])
  })
})

describe('normKey', () => {
  it('регистр, ё и пунктуация', () => {
    expect(normKey('Ёлка — Прованс!')).toBe('елка прованс')
  })
})

describe('isCounted (правило Last.fm)', () => {
  const r = DEFAULT_COUNTING
  it('половина трека', () => {
    expect(isCounted(r, 200_000, 100_000)).toBe(true)
    expect(isCounted(r, 200_000, 99_000)).toBe(false)
  })
  it('4 минуты для длинных треков', () => {
    expect(isCounted(r, 600_000, 240_000)).toBe(true)
    expect(isCounted(r, 600_000, 239_000)).toBe(false)
  })
  it('короткие треки не считаются', () => {
    expect(isCounted(r, 20_000, 20_000)).toBe(false)
  })
})
