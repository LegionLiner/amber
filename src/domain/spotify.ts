import type { EndReason } from '@/native/types'
import { normKey, splitArtists, stripJunk } from './names'

/**
 * История прослушиваний из Spotify («Скачать мои данные» на spotify.com → Конфиденциальность).
 * Понимает оба формата выгрузки:
 * - расширенная история (Streaming_History_Audio_*.json, раньше endsong_*.json): ts — момент конца,
 *   у каждого трека свой spotify:track:… и причина остановки;
 * - короткая история за год (StreamingHistory_music_*.json, StreamingHistory*.json): endTime, artistName, trackName.
 * Подкасты, аудиокниги и видео пропускаются: в статистику идёт только музыка.
 * Чистые функции, покрыты тестами (tests/spotify.test.ts).
 */

export interface SpotifyStream {
  /** spotify:track:… или собственный ключ для короткой истории, где ссылок нет. Всегда начинается со 'spotify:' */
  uri: string
  title: string
  artist: string
  album: string | null
  startedAt: number
  endedAt: number
  listenedMs: number
  endReason: EndReason
}

interface ExtendedRow {
  ts?: string
  ms_played?: number
  master_metadata_track_name?: string | null
  master_metadata_album_artist_name?: string | null
  master_metadata_album_album_name?: string | null
  spotify_track_uri?: string | null
  reason_end?: string | null
  skipped?: boolean | null
}

interface ShortRow {
  endTime?: string
  artistName?: string
  trackName?: string
  msPlayed?: number
}

/** Это файл с историей музыки? Видео, подкасты и прочие файлы выгрузки не нужны */
export function isHistoryFile(path: string): boolean {
  const name = path.split('/').pop() ?? path
  if (!/\.json$/i.test(name)) return false
  return /^(Streaming_History_Audio|endsong|StreamingHistory_music|StreamingHistory\d)/i.test(name)
}

function endReasonOf(r: ExtendedRow): EndReason {
  if (r.reason_end === 'trackdone') return 'completed'
  if (r.skipped || r.reason_end === 'fwdbtn' || r.reason_end === 'backbtn') return 'skipped'
  if (r.reason_end === 'trackerror') return 'error'
  return 'stopped'
}

/** Ключ трека в короткой истории: ссылок там нет, только исполнитель и название */
function shortUri(artist: string, title: string): string {
  return `spotify:short:${normKey(artist)}:${normKey(title)}`
}

/** Разбирает содержимое одного JSON-файла выгрузки. Непонятное молча пропускает */
export function parseStreamingHistory(data: unknown): SpotifyStream[] {
  if (!Array.isArray(data)) return []
  const out: SpotifyStream[] = []
  for (const raw of data as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    if ('ts' in raw) {
      const r = raw as ExtendedRow
      const title = r.master_metadata_track_name?.trim()
      const artist = r.master_metadata_album_artist_name?.trim()
      const ms = Number(r.ms_played)
      const end = Date.parse(r.ts ?? '')
      if (!title || !artist || !Number.isFinite(end) || !(ms > 0)) continue
      out.push({
        uri: r.spotify_track_uri?.startsWith('spotify:') ? r.spotify_track_uri : shortUri(artist, title),
        title,
        artist,
        album: r.master_metadata_album_album_name?.trim() || null,
        startedAt: end - ms,
        endedAt: end,
        listenedMs: ms,
        endReason: endReasonOf(r),
      })
    } else if ('endTime' in raw) {
      const r = raw as ShortRow
      const title = r.trackName?.trim()
      const artist = r.artistName?.trim()
      const ms = Number(r.msPlayed)
      // «2023-01-31 18:05» — время UTC
      const end = Date.parse(`${(r.endTime ?? '').replace(' ', 'T')}:00Z`)
      if (!title || !artist || !Number.isFinite(end) || !(ms > 0)) continue
      out.push({
        uri: shortUri(artist, title),
        title,
        artist,
        album: null,
        startedAt: end - ms,
        endedAt: end,
        listenedMs: ms,
        endReason: 'stopped',
      })
    }
  }
  return out
}

/**
 * Длительность трека по истории: самое долгое прослушивание, которое дошло до конца.
 * Если трек ни разу не дослушан, длительность неизвестна (0) — тогда правило подсчёта
 * работает как для трека без длительности.
 */
export function estimateDurations(streams: SpotifyStream[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of streams) {
    if (!out.has(s.uri)) out.set(s.uri, 0)
    if (s.endReason === 'completed' && s.listenedMs > out.get(s.uri)!) out.set(s.uri, s.listenedMs)
  }
  return out
}

/** Пометки версий, которые Spotify дописывает к названию, а в тегах файла их обычно нет */
const TITLE_NOISE: RegExp[] = [
  /\s*[([]\s*(?:feat|ft|featuring|with)\.?\s[^)\]]*[)\]]/gi,
  /\s*[([][^)\]]*\bremaster(?:ed)?\b[^)\]]*[)\]]/gi,
  /\s+[-–—]\s+(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?\s*$/gi,
  /\s*[([]\s*explicit\s*[)\]]/gi,
]

export function cleanTitle(title: string): string {
  let out = stripJunk(title)
  for (const re of TITLE_NOISE) out = out.replace(re, '')
  return out.trim()
}

export function matchKey(artist: string, title: string): string {
  return `${normKey(artist)}|${normKey(cleanTitle(title))}`
}

/** Что нужно от трека медиатеки для сопоставления */
export interface MatchableTrack {
  key: string
  title: string
  artist: string
  artists: string[]
  albumArtist?: string | null
}

/**
 * Сопоставление «исполнитель + название» из Spotify с файлами медиатеки.
 * У файла пробуем полного исполнителя, каждого соавтора отдельно и исполнителя альбома;
 * у Spotify — исполнителя альбома (так в выгрузке) и, если там несколько имён, каждое из них.
 */
export function buildMatcher(tracks: MatchableTrack[]): (artist: string, title: string) => string | null {
  const index = new Map<string, string>()
  for (const t of tracks) {
    if (!t.title) continue
    const names = new Set([t.artist, ...t.artists, t.albumArtist ?? ''].filter(Boolean))
    for (const a of names) {
      const k = matchKey(a, t.title)
      if (!index.has(k)) index.set(k, t.key)
    }
  }
  return (artist, title) => {
    const direct = index.get(matchKey(artist, title))
    if (direct) return direct
    for (const a of splitArtists(artist)) {
      const k = index.get(matchKey(a, title))
      if (k) return k
    }
    return null
  }
}
