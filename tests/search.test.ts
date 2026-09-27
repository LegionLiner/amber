import { describe, expect, it } from 'vitest'
import { LibrarySearch, latToRu, ruToLat, swapLayout } from '@/domain/search'
import type { Track } from '@/domain/track'

function track(key: string, title: string, artist: string): Track {
  return {
    key,
    title,
    artist,
    artists: [artist],
    album: '',
    albumArtist: artist,
    genre: '',
    fileName: `${title}.mp3`,
    folder: 'Music/',
    note: null,
    uri: '',
    path: '',
    size: 0,
    year: null,
    trackNo: null,
    discNo: null,
    durationMs: 1,
    bitrate: null,
    sampleRate: null,
    mime: null,
    art: null,
    hasCustomArt: false,
    color1: null,
    color2: null,
    hasLyrics: false,
    addedAt: 0,
    tags: { title, artist, album: null, genre: null },
    overrides: {},
    rating: null,
    favoriteAt: null,
    rankScore: null,
    noShuffle: false,
    gainOffsetDb: 0,
    trimStartMs: null,
    trimEndMs: null,
    plays: 0,
    skips: 0,
    listenedMs: 0,
    firstPlayedAt: null,
    lastPlayedAt: null,
    lastStartedAt: null,
    duels: 0,
    lufs: null,
    bpm: null,
    energy: null,
    analyzed: false,
  }
}

const lib = new LibrarySearch([
  track('1', 'Группа крови', 'Кино'),
  track('2', 'Midnight Avenue', 'Kosmos Radio'),
  track('3', 'Ночной проспект', 'Полночь'),
])

describe('транслит и раскладка', () => {
  it('преобразования', () => {
    expect(ruToLat('кино')).toBe('kino')
    expect(latToRu('kino')).toBe('кино')
    expect(swapLayout('rbyj')).toBe('кино')
    expect(swapLayout('кино')).toBe('rbyj')
  })
})

describe('LibrarySearch', () => {
  it('находит по началу слова', () => {
    expect(lib.search('груп')).toContain('1')
  })
  it('латиница находит кириллицу', () => {
    expect(lib.search('kino')).toContain('1')
  })
  it('кириллица находит латиницу', () => {
    expect(lib.search('космос')).toContain('2')
  })
  it('неверная раскладка', () => {
    expect(lib.search('rbyj')).toContain('1')
  })
  it('опечатка', () => {
    expect(lib.search('проспкет')).toContain('3')
  })
})
