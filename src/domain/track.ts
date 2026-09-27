import { parseFileName, splitArtists } from './names'

/** Строка из запроса библиотеки (см. data/repos/library.ts) */
export interface TrackRow {
  key: string
  uri: string
  path: string
  folder: string
  fileName: string
  size: number
  title: string | null
  artist: string | null
  album: string | null
  albumArtist: string | null
  genre: string | null
  year: number | null
  trackNo: number | null
  discNo: number | null
  durationMs: number
  bitrate: number | null
  sampleRate: number | null
  mime: string | null
  art: string | null
  color1: string | null
  color2: string | null
  hasLyrics: number
  rgTrackDb: number | null
  addedAt: number
  rating: number | null
  favoriteAt: number | null
  rankScore: number | null
  duels: number | null
  note: string | null
  overrides: string | null
  noShuffle: number | null
  gainOffsetDb: number | null
  trimStartMs: number | null
  trimEndMs: number | null
  customArt: string | null
  plays: number | null
  skips: number | null
  listenedMs: number | null
  firstPlayedAt: number | null
  lastPlayedAt: number | null
  lastStartedAt: number | null
  lufs: number | null
  bpm: number | null
  energy: number | null
  analyzedAt: number | null
}

export interface TagOverrides {
  title?: string
  artist?: string
  album?: string
  genre?: string
  year?: number
}

/** Трек, каким его видит интерфейс: теги, твои правки и статистика вместе */
export interface Track {
  key: string
  uri: string
  path: string
  folder: string
  fileName: string
  size: number
  title: string
  artist: string
  artists: string[]
  album: string
  albumArtist: string
  genre: string
  year: number | null
  trackNo: number | null
  discNo: number | null
  durationMs: number
  bitrate: number | null
  sampleRate: number | null
  mime: string | null
  art: string | null
  /** Обложка своя, заданная в приложении (не из файла) */
  hasCustomArt: boolean
  color1: string | null
  color2: string | null
  hasLyrics: boolean
  addedAt: number
  /** Теги так, как они записаны в файле */
  tags: { title: string | null; artist: string | null; album: string | null; genre: string | null }
  overrides: TagOverrides
  rating: number | null
  favoriteAt: number | null
  rankScore: number | null
  /** Сколько дуэлей провёл трек: от этого зависит, насколько сильно двигает место новая */
  duels: number
  note: string | null
  noShuffle: boolean
  gainOffsetDb: number
  trimStartMs: number | null
  trimEndMs: number | null
  plays: number
  skips: number
  listenedMs: number
  firstPlayedAt: number | null
  lastPlayedAt: number | null
  lastStartedAt: number | null
  /** Громкость по анализу (LUFS), темп и энергия 0…1; null — ещё не анализировали */
  lufs: number | null
  bpm: number | null
  energy: number | null
  analyzed: boolean
}

function parseOverrides(json: string | null): TagOverrides {
  if (!json) return {}
  try {
    return JSON.parse(json) as TagOverrides
  } catch {
    return {}
  }
}

function lastFolderName(folder: string): string {
  const parts = folder.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

export interface TrackOptions {
  /** Если тег альбома пуст, считать альбомом папку */
  albumFromFolder: boolean
}

export function toTrack(r: TrackRow, opts: TrackOptions): Track {
  const ov = parseOverrides(r.overrides)
  const parsed = !r.title || !r.artist ? parseFileName(r.fileName) : null
  const title = ov.title || r.title || parsed?.title || r.fileName
  const artist = ov.artist || r.artist || parsed?.artist || ''
  const album = ov.album || r.album || (opts.albumFromFolder ? lastFolderName(r.folder) : '')
  return {
    key: r.key,
    uri: r.uri,
    path: r.path,
    folder: r.folder,
    fileName: r.fileName,
    size: r.size,
    title,
    artist,
    artists: splitArtists(artist),
    album,
    albumArtist: r.albumArtist || artist,
    genre: ov.genre || r.genre || '',
    year: ov.year ?? r.year,
    trackNo: r.trackNo ?? parsed?.trackNo ?? null,
    discNo: r.discNo,
    durationMs: r.durationMs,
    bitrate: r.bitrate,
    sampleRate: r.sampleRate,
    mime: r.mime,
    art: r.customArt || r.art,
    hasCustomArt: !!r.customArt,
    color1: r.color1,
    color2: r.color2,
    hasLyrics: !!r.hasLyrics,
    addedAt: r.addedAt,
    tags: { title: r.title, artist: r.artist, album: r.album, genre: r.genre },
    overrides: ov,
    rating: r.rating,
    favoriteAt: r.favoriteAt,
    rankScore: r.rankScore,
    duels: r.duels ?? 0,
    note: r.note,
    noShuffle: !!r.noShuffle,
    gainOffsetDb: r.gainOffsetDb ?? 0,
    trimStartMs: r.trimStartMs,
    trimEndMs: r.trimEndMs,
    plays: r.plays ?? 0,
    skips: r.skips ?? 0,
    listenedMs: r.listenedMs ?? 0,
    firstPlayedAt: r.firstPlayedAt,
    lastPlayedAt: r.lastPlayedAt,
    lastStartedAt: r.lastStartedAt,
    lufs: r.lufs,
    bpm: r.bpm,
    energy: r.energy,
    analyzed: r.analyzedAt != null,
  }
}

export const UNKNOWN_ARTIST = 'Неизвестный исполнитель'

export function displayArtist(t: Pick<Track, 'artist'>): string {
  return t.artist || UNKNOWN_ARTIST
}
