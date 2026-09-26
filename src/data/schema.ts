import type { Generated } from 'kysely'

/**
 * Типы таблиц для Kysely. Имена в camelCase: CamelCasePlugin сам переводит их
 * в snake_case из migrations.ts (trackUser → track_user, durationMs → duration_ms).
 */

export interface TracksTable {
  key: string
  mediaId: number | null
  uri: string
  path: string
  folder: string
  fileName: string
  size: number
  mtime: number
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
  rgAlbumDb: number | null
  popm: number | null
  addedAt: number
  updatedAt: number
  missingSince: number | null
}

export interface TrackUserTable {
  key: string
  rating: number | null
  ratedAt: number | null
  rankScore: number | null
  duels: number
  favoriteAt: number | null
  note: string | null
  overrides: string | null
  trimStartMs: number | null
  trimEndMs: number | null
  gainOffsetDb: number
  noShuffle: number
  customArt: string | null
  updatedAt: number
}

export interface RatingHistoryTable {
  id: Generated<number>
  key: string
  rating: number | null
  at: number
}

export interface PlayEventsTable {
  id: Generated<number>
  trackKey: string
  startedAt: number
  endedAt: number | null
  tzOffset: number
  localDay: string
  localHour: number
  weekday: number
  listenedMs: number
  posStartMs: number | null
  posEndMs: number | null
  durationMs: number
  endReason: string | null
  counted: number
  sourceType: string | null
  sourceId: string | null
  output: string | null
  sessionId: number | null
}

export interface PlaylistsTable {
  id: Generated<number>
  name: string
  kind: 'manual' | 'smart' | 'mix'
  rules: string | null
  sort: string | null
  cover: string | null
  note: string | null
  createdAt: number
  updatedAt: number
}

export interface PlaylistItemsTable {
  id: Generated<number>
  playlistId: number
  pos: number
  trackKey: string
  transition: string | null
  addedAt: number
}

export interface BookmarksTable {
  id: Generated<number>
  trackKey: string
  positionMs: number
  endMs: number | null
  title: string
  color: string | null
  kind: 'mark' | 'best'
  note: string | null
  createdAt: number
}

export interface TagsTable {
  id: Generated<number>
  name: string
  color: string | null
  createdAt: number
}

export interface TrackTagsTable {
  trackKey: string
  tagId: number
}

export interface ErasTable {
  id: Generated<number>
  title: string
  kind: 'season' | 'custom'
  startDay: string
  endDay: string
  color: string | null
  note: string | null
  createdAt: number
}

export interface ContextsTable {
  id: Generated<number>
  title: string
  icon: string | null
  color: string | null
  rules: string | null
  createdAt: number
}

export interface ContextIntervalsTable {
  id: Generated<number>
  contextId: number
  startAt: number
  endAt: number | null
}

export interface DiaryTable {
  day: string
  mood: number | null
  note: string | null
  updatedAt: number
}

export interface DuelsTable {
  id: Generated<number>
  aKey: string
  bKey: string
  result: number
  at: number
}

export interface RankSnapshotsTable {
  week: string
  trackKey: string
  position: number
}

export interface WeeklyChartsTable {
  week: string
  position: number
  trackKey: string
  plays: number
  listenedMs: number
}

export interface AnalysisTable {
  key: string
  lufs: number | null
  truePeakDb: number | null
  introSilenceMs: number | null
  outroSilenceMs: number | null
  waveform: string | null
  energy: number | null
  bpm: number | null
  analyzedAt: number
}

export interface TrackNeighborsTable {
  key: string
  other: string
  score: number
}

export interface SettingsTable {
  key: string
  value: string
}

export interface DeviceProfilesTable {
  device: string
  eq: string | null
  gainDb: number | null
  crossfade: string | null
  updatedAt: number
}

export interface LyricsTable {
  key: string
  text: string
  updatedAt: number
}

export interface DismissedTable {
  kind: string
  key: string
  at: number
}

export interface DB {
  tracks: TracksTable
  trackUser: TrackUserTable
  ratingHistory: RatingHistoryTable
  playEvents: PlayEventsTable
  playlists: PlaylistsTable
  playlistItems: PlaylistItemsTable
  bookmarks: BookmarksTable
  tags: TagsTable
  trackTags: TrackTagsTable
  eras: ErasTable
  contexts: ContextsTable
  contextIntervals: ContextIntervalsTable
  diary: DiaryTable
  duels: DuelsTable
  rankSnapshots: RankSnapshotsTable
  weeklyCharts: WeeklyChartsTable
  analysis: AnalysisTable
  trackNeighbors: TrackNeighborsTable
  settings: SettingsTable
  deviceProfiles: DeviceProfilesTable
  lyrics: LyricsTable
  dismissed: DismissedTable
}
