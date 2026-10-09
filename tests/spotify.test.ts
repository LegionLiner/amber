import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildMatcher, cleanTitle, estimateDurations, isHistoryFile, parseStreamingHistory } from '@/domain/spotify'
import { listZip, readZipEntry } from '@/domain/zip'

const ext = (over: Record<string, unknown> = {}) => ({
  ts: '2025-01-01T14:36:22Z',
  platform: 'windows',
  ms_played: 210_469,
  master_metadata_track_name: 'Sleepwalker',
  master_metadata_album_artist_name: 'akiaura',
  master_metadata_album_album_name: 'Ketamine Girl',
  spotify_track_uri: 'spotify:track:1IPHnu3hVkawJMzkP97tcm',
  episode_name: null,
  reason_start: 'appload',
  reason_end: 'trackdone',
  skipped: false,
  ...over,
})

describe('история Spotify', () => {
  it('узнаёт файлы с музыкой и пропускает видео', () => {
    expect(isHistoryFile('Spotify Extended Streaming History/Streaming_History_Audio_2025.json')).toBe(true)
    expect(isHistoryFile('Spotify Extended Streaming History/Streaming_History_Video_2025.json')).toBe(false)
    expect(isHistoryFile('MyData/StreamingHistory_music_0.json')).toBe(true)
    expect(isHistoryFile('MyData/StreamingHistory0.json')).toBe(true)
    expect(isHistoryFile('MyData/StreamingHistory_podcast_0.json')).toBe(false)
    expect(isHistoryFile('ReadMeFirst_ExtendedStreamingHistory.pdf')).toBe(false)
  })

  it('разбирает расширенную историю: ts — конец прослушивания', () => {
    const [s] = parseStreamingHistory([ext()])
    expect(s).toMatchObject({
      uri: 'spotify:track:1IPHnu3hVkawJMzkP97tcm',
      title: 'Sleepwalker',
      artist: 'akiaura',
      album: 'Ketamine Girl',
      listenedMs: 210_469,
      endReason: 'completed',
    })
    expect(s!.endedAt).toBe(Date.parse('2025-01-01T14:36:22Z'))
    expect(s!.startedAt).toBe(s!.endedAt - 210_469)
  })

  it('пропускает подкасты и пустые прослушивания, понимает пропуски', () => {
    const out = parseStreamingHistory([
      ext({ master_metadata_track_name: null, episode_name: 'Подкаст' }),
      ext({ ms_played: 0 }),
      ext({ reason_end: 'fwdbtn', ms_played: 5000 }),
      ext({ reason_end: 'endplay', skipped: true, ms_played: 5000 }),
      ext({ reason_end: 'endplay' }),
    ])
    expect(out.map((s) => s.endReason)).toEqual(['skipped', 'skipped', 'stopped'])
  })

  it('разбирает короткую историю за год', () => {
    const [s] = parseStreamingHistory([
      { endTime: '2023-01-31 18:05', artistName: 'Кино', trackName: 'Группа крови', msPlayed: 60_000 },
    ])
    expect(s!.endedAt).toBe(Date.parse('2023-01-31T18:05:00Z'))
    expect(s!.uri).toBe('spotify:short:кино:группа крови')
  })

  it('длительность — по самому долгому дослушанному прослушиванию', () => {
    const d = estimateDurations(
      parseStreamingHistory([
        ext({ ms_played: 200_000 }),
        ext({ ms_played: 210_000 }),
        ext({ ms_played: 500_000, reason_end: 'endplay' }),
        ext({ spotify_track_uri: 'spotify:track:other', reason_end: 'fwdbtn', ms_played: 1000 }),
      ]),
    )
    expect(d.get('spotify:track:1IPHnu3hVkawJMzkP97tcm')).toBe(210_000)
    expect(d.get('spotify:track:other')).toBe(0)
  })

  it('чистит пометки Spotify в названии', () => {
    expect(cleanTitle('Let It Be - Remastered 2009')).toBe('Let It Be')
    expect(cleanTitle('Bohemian Rhapsody - 2011 Remaster')).toBe('Bohemian Rhapsody')
    expect(cleanTitle('Song (feat. Someone)')).toBe('Song')
    expect(cleanTitle('Song (Remix)')).toBe('Song (Remix)')
  })

  it('находит треки медиатеки по исполнителю и названию', () => {
    const match = buildMatcher([
      { key: 'a', title: 'Группа крови', artist: 'Кино', artists: ['Кино'] },
      { key: 'b', title: 'Song', artist: 'X feat. Y', artists: ['X', 'Y'] },
      { key: 'c', title: 'Let It Be', artist: 'The Beatles', artists: ['The Beatles'] },
    ])
    expect(match('КИНО', 'Группа Крови')).toBe('a')
    expect(match('Y', 'Song (feat. X)')).toBe('b')
    expect(match('The Beatles', 'Let It Be - Remastered 2009')).toBe('c')
    expect(match('Кино', 'Звезда по имени Солнце')).toBeNull()
  })
})

/** ZIP из двух файлов: один сжат deflate, другой без сжатия */
function makeZip(files: { name: string; data: Uint8Array; deflate: boolean }[]): ArrayBuffer {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const body = f.deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data
    const local = new Uint8Array(30 + name.length + body.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, f.deflate ? 8 : 0, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(body, 30 + name.length)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, f.deflate ? 8 : 0, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const all = [...locals, ...centrals, end]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let p = 0
  for (const part of all) {
    out.set(part, p)
    p += part.length
  }
  return out.buffer
}

describe('zip', () => {
  it('читает сжатые и несжатые файлы', async () => {
    const enc = new TextEncoder()
    const json = JSON.stringify([ext()])
    const buf = makeZip([
      { name: 'Spotify Extended Streaming History/Streaming_History_Audio_2025.json', data: enc.encode(json), deflate: true },
      { name: 'Spotify Extended Streaming History/readme.txt', data: enc.encode('привет'), deflate: false },
    ])
    const entries = listZip(buf)
    expect(entries.map((e) => e.name)).toEqual([
      'Spotify Extended Streaming History/Streaming_History_Audio_2025.json',
      'Spotify Extended Streaming History/readme.txt',
    ])
    const dec = new TextDecoder()
    expect(dec.decode(await readZipEntry(buf, entries[0]!))).toBe(json)
    expect(dec.decode(await readZipEntry(buf, entries[1]!))).toBe('привет')
  })

  it('не ZIP — понятная ошибка', () => {
    expect(() => listZip(new ArrayBuffer(100))).toThrow('Это не ZIP-архив')
  })
})
