import { parseV2, tagSize, trackKey } from './id3'
import { fromBase64, isPng } from './id3-writer'

/**
 * MP4/M4A (AAC): определение формата по содержимому, чтение и запись тегов iTunes (moov/udta/meta/ilst).
 * Порт этого файла — android/…/library/Mp4Tagger.kt: логика должна совпадать.
 *
 * Зачем: у многих файлов расширение .mp3, а внутри MP4. ID3-тег в начале такого файла ломает его —
 * поэтому формат определяется только по байтам, а не по имени.
 */

export type AudioKind = 'mpeg' | 'mp4' | 'flac' | 'ogg' | 'wav' | 'id3+mp4' | 'unknown'

const ascii = (b: Uint8Array, p: number, n: number) => String.fromCharCode(...b.subarray(p, p + n))

function isMpegSync(b: Uint8Array, p: number): boolean {
  return b[p] === 0xff && (b[p + 1]! & 0xe0) === 0xe0 && ((b[p + 1]! >> 1) & 3) !== 0
}

/**
 * Формат по первым байтам. head — начало файла, afterTag — байты сразу после ID3-тега (если он есть).
 * «id3+mp4» — MP4, перед которым кто-то дописал ID3: такой файл не играется, его надо чинить.
 */
export function sniff(head: Uint8Array, afterTag?: Uint8Array): AudioKind {
  const t = tagSize(head)
  if (t > 0) {
    const a = afterTag ?? new Uint8Array(0)
    if (a.length >= 8 && ascii(a, 4, 4) === 'ftyp') return 'id3+mp4'
    if (a.length >= 4 && ascii(a, 0, 4) === 'fLaC') return 'flac'
    return 'mpeg'
  }
  if (head.length >= 8 && ascii(head, 4, 4) === 'ftyp') return 'mp4'
  if (ascii(head, 0, 4) === 'fLaC') return 'flac'
  if (ascii(head, 0, 4) === 'OggS') return 'ogg'
  if (ascii(head, 0, 4) === 'RIFF') return 'wav'
  if (isMpegSync(head, 0)) return 'mpeg'
  return 'unknown'
}

/* ------------------------------ коробки ------------------------------ */

interface Box {
  type: string
  start: number
  header: number
  end: number
}

function u32(b: Uint8Array, p: number): number {
  return ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0
}

function u64(b: Uint8Array, p: number): number {
  return u32(b, p) * 2 ** 32 + u32(b, p + 4)
}

function boxes(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = []
  let p = start
  while (p + 8 <= end) {
    let size = u32(b, p)
    let header = 8
    if (size === 1) {
      size = u64(b, p + 8)
      header = 16
    } else if (size === 0) size = end - p
    if (size < header || p + size > end) throw new Error(`MP4: битая коробка ${ascii(b, p + 4, 4)}`)
    out.push({ type: ascii(b, p + 4, 4), start: p, header, end: p + size })
    p += size
  }
  return out
}

const child = (b: Uint8Array, box: Box, type: string, skip = 0) =>
  boxes(b, box.start + box.header + skip, box.end).find((x) => x.type === type)

function be32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}

function makeBox(type: string | number[], payload: Uint8Array | number[]): Uint8Array {
  const t = typeof type === 'string' ? [...type].map((c) => c.charCodeAt(0) & 255) : type
  const p = payload instanceof Uint8Array ? payload : Uint8Array.from(payload)
  const out = new Uint8Array(8 + p.length)
  out.set(be32(out.length), 0)
  out.set(t, 4)
  out.set(p, 8)
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/* ------------------------------ чтение ------------------------------ */

export interface Mp4Tags {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  genre?: string
  year?: number
  trackNo?: number
  picture?: { mime: string; data: Uint8Array }
  lyrics?: string
}

/** Имена полей iTunes: «©» — это байт 0xA9 */
const ITEM = {
  title: '\xa9nam',
  artist: '\xa9ART',
  album: '\xa9alb',
  albumArtist: 'aART',
  genre: '\xa9gen',
  year: '\xa9day',
  lyrics: '\xa9lyr',
  track: 'trkn',
  cover: 'covr',
  genreId: 'gnre',
} as const

const utf8 = new TextDecoder('utf-8')

/** Теги и длительность из байтов коробки moov (целиком, с заголовком) */
export function readMoov(moov: Uint8Array): { tags: Mp4Tags; durationMs: number | null } {
  const root = boxes(moov, 0, moov.length).find((x) => x.type === 'moov')
  if (!root) return { tags: {}, durationMs: null }
  let durationMs: number | null = null
  const mvhd = child(moov, root, 'mvhd')
  if (mvhd) {
    const p = mvhd.start + mvhd.header
    const v1 = moov[p] === 1
    const timescale = v1 ? u32(moov, p + 20) : u32(moov, p + 12)
    const dur = v1 ? u64(moov, p + 24) : u32(moov, p + 16)
    if (timescale > 0) durationMs = Math.round((dur / timescale) * 1000)
  }
  const tags: Mp4Tags = {}
  const udta = child(moov, root, 'udta')
  const meta = udta && child(moov, udta, 'meta')
  const ilst = meta && child(moov, meta, 'ilst', 4)
  if (ilst) {
    for (const item of boxes(moov, ilst.start + ilst.header, ilst.end)) {
      const data = boxes(moov, item.start + item.header, item.end).find((x) => x.type === 'data')
      if (!data) continue
      const kind = u32(moov, data.start + data.header) & 0xffffff
      const value = moov.subarray(data.start + data.header + 8, data.end)
      const text = () => utf8.decode(value).replace(/\0+$/, '').trim() || undefined
      switch (item.type) {
        case ITEM.title:
          tags.title = text()
          break
        case ITEM.artist:
          tags.artist = text()
          break
        case ITEM.album:
          tags.album = text()
          break
        case ITEM.albumArtist:
          tags.albumArtist = text()
          break
        case ITEM.genre:
          tags.genre = text()
          break
        case ITEM.lyrics:
          tags.lyrics = text()
          break
        case ITEM.year: {
          const y = Number.parseInt(text() ?? '', 10)
          if (y > 0) tags.year = y
          break
        }
        case ITEM.track:
          if (value.length >= 4) tags.trackNo = (value[2]! << 8) | value[3]! || undefined
          break
        case ITEM.cover:
          if (!tags.picture) tags.picture = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: value.slice() }
          break
      }
    }
  }
  return { tags, durationMs }
}

/* ------------------------------ запись ------------------------------ */

export interface Mp4Edit {
  title?: string
  artist?: string
  album?: string
  genre?: string
  year?: number
  trackNo?: number
  /** Новая обложка, base64 JPEG/PNG */
  picture?: string
}

function textItem(type: string, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  const data = makeBox('data', [...be32(1), ...be32(0), ...bytes])
  return makeBox(
    [...type].map((c) => c.charCodeAt(0) & 255),
    data,
  )
}

function trackItem(no: number, total: number): Uint8Array {
  const data = makeBox('data', [...be32(0), ...be32(0), 0, 0, (no >> 8) & 255, no & 255, (total >> 8) & 255, total & 255, 0, 0])
  return makeBox('trkn', data)
}

/**
 * Новый файл с изменёнными тегами. Аудио не трогается: если данные лежат после moov,
 * таблицы смещений кусков (stco/co64) сдвигаются на изменение размера moov.
 */
export function writeMp4Tags(file: Uint8Array, edit: Mp4Edit): Uint8Array {
  const top = boxes(file, 0, file.length)
  if (top[0]?.type !== 'ftyp') throw new Error('Не MP4: нет ftyp в начале')
  if (top.some((x) => x.type === 'moof')) throw new Error('Фрагментированный MP4 не поддерживается')
  const moov = top.find((x) => x.type === 'moov')
  if (!moov) throw new Error('В MP4 нет moov')

  const kids = boxes(file, moov.start + moov.header, moov.end)
  const udta = kids.find((x) => x.type === 'udta')
  const udtaKids = udta ? boxes(file, udta.start + udta.header, udta.end) : []
  const meta = udtaKids.find((x) => x.type === 'meta')
  const metaKids = meta ? boxes(file, meta.start + meta.header + 4, meta.end) : []
  const ilst = metaKids.find((x) => x.type === 'ilst')
  const items = ilst ? boxes(file, ilst.start + ilst.header, ilst.end) : []

  // Номер трека: сохраняем «из скольки», если он был
  const oldTrk = items.find((x) => x.type === ITEM.track)
  let total = 0
  if (oldTrk) {
    const d = boxes(file, oldTrk.start + oldTrk.header, oldTrk.end).find((x) => x.type === 'data')
    if (d && d.end - (d.start + d.header + 8) >= 6)
      total = (file[d.start + d.header + 8 + 4]! << 8) | file[d.start + d.header + 8 + 5]!
  }

  const replace = new Map<string, Uint8Array | null>()
  if (edit.title != null) replace.set(ITEM.title, edit.title.trim() ? textItem(ITEM.title, edit.title.trim()) : null)
  if (edit.artist != null) replace.set(ITEM.artist, edit.artist.trim() ? textItem(ITEM.artist, edit.artist.trim()) : null)
  if (edit.album != null) replace.set(ITEM.album, edit.album.trim() ? textItem(ITEM.album, edit.album.trim()) : null)
  if (edit.genre != null) {
    replace.set(ITEM.genre, edit.genre.trim() ? textItem(ITEM.genre, edit.genre.trim()) : null)
    replace.set(ITEM.genreId, null) // числовой жанр перебил бы текстовый
  }
  if (edit.year != null) replace.set(ITEM.year, edit.year > 0 ? textItem(ITEM.year, String(edit.year)) : null)
  if (edit.trackNo != null) replace.set(ITEM.track, edit.trackNo > 0 ? trackItem(edit.trackNo, total) : null)
  if (edit.picture) {
    // Обложка: covr → data с типом 13 (JPEG) или 14 (PNG)
    const pic = fromBase64(edit.picture)
    replace.set(ITEM.cover, makeBox('covr', makeBox('data', [...be32(isPng(pic) ? 14 : 13), ...be32(0), ...pic])))
  }

  const newItems: Uint8Array[] = []
  const done = new Set<string>()
  for (const it of items) {
    if (replace.has(it.type)) {
      const r = replace.get(it.type)
      if (r && !done.has(it.type)) newItems.push(r)
      done.add(it.type)
    } else newItems.push(file.subarray(it.start, it.end))
  }
  for (const [type, r] of replace) if (!done.has(type) && r) newItems.push(r)

  const newIlst = makeBox('ilst', concat(newItems))
  const hdlr = metaKids.find((x) => x.type === 'hdlr') ?? null
  const hdlrBytes = hdlr
    ? file.subarray(hdlr.start, hdlr.end)
    : makeBox('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, ...'mdirappl'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const otherMeta = metaKids.filter((x) => !['hdlr', 'ilst', 'free'].includes(x.type)).map((x) => file.subarray(x.start, x.end))
  // Небольшой запас: следующие правки часто уложатся без сдвига аудио
  const padding = makeBox('free', new Uint8Array(512))
  const newMeta = makeBox('meta', concat([Uint8Array.from([0, 0, 0, 0]), hdlrBytes, newIlst, ...otherMeta, padding]))
  const newUdta = makeBox(
    'udta',
    concat([...udtaKids.filter((x) => x.type !== 'meta').map((x) => file.subarray(x.start, x.end)), newMeta]),
  )

  const moovParts: Uint8Array[] = []
  let placed = false
  for (const k of kids) {
    if (k.type === 'udta') {
      moovParts.push(newUdta)
      placed = true
    } else moovParts.push(file.subarray(k.start, k.end))
  }
  if (!placed) moovParts.push(newUdta)
  const newMoov = makeBox('moov', concat(moovParts))
  const delta = newMoov.length - (moov.end - moov.start)
  if (delta !== 0) shiftChunkOffsets(newMoov, moov.start, delta)

  return concat([file.subarray(0, moov.start), newMoov, file.subarray(moov.end)])
}

/** Сдвигает в stco/co64 все смещения, указывающие дальше начала старой moov */
function shiftChunkOffsets(moov: Uint8Array, moovStart: number, delta: number) {
  const walk = (start: number, end: number) => {
    for (const b of boxes(moov, start, end)) {
      if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'].includes(b.type)) walk(b.start + b.header, b.end)
      else if (b.type === 'stco' || b.type === 'co64') {
        const p = b.start + b.header + 4
        const n = u32(moov, p)
        const wide = b.type === 'co64'
        for (let i = 0; i < n; i++) {
          const at = p + 4 + i * (wide ? 8 : 4)
          const v = wide ? u64(moov, at) : u32(moov, at)
          if (v < moovStart) continue
          const nv = v + delta
          if (wide) {
            moov.set(be32(Math.floor(nv / 2 ** 32)), at)
            moov.set(be32(nv >>> 0), at + 4)
          } else {
            if (nv > 0xffffffff) throw new Error('MP4 больше 4 ГБ: смещения не помещаются')
            moov.set(be32(nv), at)
          }
        }
      }
    }
  }
  walk(0, moov.length)
}

/* ------------------------------ обычный M4A из сэмплов ------------------------------ */

/** Кусок звука для сборки M4A: подряд идущие сэмплы, их байты лежат в data одним блоком */
export interface Mp4Chunk {
  count: number
  data: Uint8Array
}

/** Звуковая дорожка в moov (hdlr = soun); если подписи нет — первая */
function soundTrak(moov: Uint8Array, kids: Box[]): Box | undefined {
  const traks = kids.filter((x) => x.type === 'trak')
  return (
    traks.find((t) => {
      const mdia = child(moov, t, 'mdia')
      const hdlr = mdia && child(moov, mdia, 'hdlr')
      return hdlr ? ascii(moov, hdlr.start + hdlr.header + 8, 4) === 'soun' : false
    }) ?? traks[0]
  )
}

/**
 * Обычный M4A (ftyp, moov, mdat) по образцу moov: описание звука (stsd) берётся из него, таблицы сэмплов
 * строятся заново из durations, sizes и chunks. Остальные дорожки (обложка-видео) отбрасываются.
 * На этом стоят пересборка фрагментированного файла с YouTube и нарезка длинных треков для анализа.
 */
export function flatMp4(
  moov: Uint8Array,
  durations: ArrayLike<number>,
  sizes: ArrayLike<number>,
  chunks: Mp4Chunk[],
): Uint8Array {
  const moovKids = boxes(moov, 8, moov.length)
  const trak = soundTrak(moov, moovKids)
  if (!trak) throw new Error('В MP4 нет звуковой дорожки')
  const n = sizes.length
  let total = 0
  for (let i = 0; i < n; i++) total += durations[i]!

  // Таблицы сэмплов
  const stts: number[] = []
  let runs = 0
  for (let i = 0; i < n;) {
    let j = i
    while (j < n && durations[j] === durations[i]) j++
    stts.push(...be32(j - i), ...be32(durations[i]!))
    runs++
    i = j
  }
  const stsc: number[] = []
  let stscN = 0
  chunks.forEach((c, i) => {
    if (i > 0 && chunks[i - 1]!.count === c.count) return
    stsc.push(...be32(i + 1), ...be32(c.count), ...be32(1))
    stscN++
  })
  const stszPayload = new Uint8Array(12 + 4 * n)
  stszPayload.set(be32(n), 8)
  for (let i = 0; i < n; i++) stszPayload.set(be32(sizes[i]!), 12 + 4 * i)
  const stszBox = makeBox('stsz', stszPayload)
  const sttsBox = makeBox('stts', [0, 0, 0, 0, ...be32(runs), ...stts])
  const stscBox = makeBox('stsc', [0, 0, 0, 0, ...be32(stscN), ...stsc])
  const stcoBox = (offsets: number[]) => makeBox('stco', [0, 0, 0, 0, ...be32(offsets.length), ...offsets.flatMap(be32)])

  // Длительности в mvhd, tkhd, mdhd: в образце они другие (или ноль у фрагментированного)
  const patchDuration = (box: Box, value: number, at0: number, at1: number) => {
    const b = moov.slice(box.start, box.end)
    const v = b[box.header]!
    const at = (v === 1 ? at1 : at0) + box.header
    if (v === 1) {
      b.set(be32(Math.floor(value / 2 ** 32)), at)
      b.set(be32(value >>> 0), at + 4)
    } else b.set(be32(Math.min(0xffffffff, value)), at)
    return b
  }
  const scaleOf = (box: Box) => u32(moov, box.start + box.header + (moov[box.start + box.header] === 1 ? 20 : 12))
  const mvhd = moovKids.find((x) => x.type === 'mvhd')!
  const trakKids = boxes(moov, trak.start + trak.header, trak.end)
  const mdia = trakKids.find((x) => x.type === 'mdia')!
  const mdiaKids = boxes(moov, mdia.start + mdia.header, mdia.end)
  const mdhd = mdiaKids.find((x) => x.type === 'mdhd')!
  const inMovie = Math.round((total / scaleOf(mdhd)) * scaleOf(mvhd))
  const minf = mdiaKids.find((x) => x.type === 'minf')!
  const minfKids = boxes(moov, minf.start + minf.header, minf.end)
  const stbl = minfKids.find((x) => x.type === 'stbl')!
  const stsd = boxes(moov, stbl.start + stbl.header, stbl.end).find((x) => x.type === 'stsd')!
  const raw = (b: Box) => moov.subarray(b.start, b.end)

  const build = (offsets: number[]) => {
    const newStbl = makeBox('stbl', concat([raw(stsd), sttsBox, stscBox, stszBox, stcoBox(offsets)]))
    const newMinf = makeBox('minf', concat(minfKids.map((k) => (k.type === 'stbl' ? newStbl : raw(k)))))
    const newMdia = makeBox(
      'mdia',
      concat(mdiaKids.map((k) => (k.type === 'mdhd' ? patchDuration(k, total, 16, 24) : k.type === 'minf' ? newMinf : raw(k)))),
    )
    // Список правок (edts) относится ко всей старой дорожке — в новом файле он только мешал бы
    const newTrak = makeBox(
      'trak',
      concat(
        trakKids
          .filter((k) => k.type !== 'edts')
          .map((k) => (k.type === 'tkhd' ? patchDuration(k, inMovie, 20, 28) : k.type === 'mdia' ? newMdia : raw(k))),
      ),
    )
    return makeBox(
      'moov',
      concat(
        moovKids
          .filter((k) => k.type !== 'mvex' && (k.type !== 'trak' || k.start === trak.start))
          .map((k) => (k.type === 'mvhd' ? patchDuration(k, inMovie, 16, 24) : k.type === 'trak' ? newTrak : raw(k))),
      ),
    )
  }

  // ftyp обычного M4A
  const ftyp = makeBox(
    'ftyp',
    [...'M4A ']
      .map((c) => c.charCodeAt(0))
      .concat([0, 0, 2, 0], ...['M4A ', 'mp42', 'isom'].map((s) => [...s].map((c) => c.charCodeAt(0)))),
  )
  const dataStart = ftyp.length + build(chunks.map(() => 0)).length + 8
  const offsets: number[] = []
  let o = dataStart
  for (const c of chunks) {
    offsets.push(o)
    o += c.data.length
  }
  if (o > 0xffffffff) throw new Error('MP4 больше 4 ГБ')
  const mdatHead = new Uint8Array(8)
  mdatHead.set(be32(o - dataStart + 8), 0)
  mdatHead.set([0x6d, 0x64, 0x61, 0x74], 4)
  return concat([ftyp, build(offsets), mdatHead, ...chunks.map((c) => c.data)])
}

/** Таблица сэмплов звуковой дорожки обычного MP4: где лежит каждый сэмпл, сколько весит и длится */
export interface Mp4SampleTable {
  sizes: Uint32Array
  offsets: Float64Array
  durations: Uint32Array
  timescale: number
}

export function mp4SampleTable(moov: Uint8Array): Mp4SampleTable | null {
  const trak = soundTrak(moov, boxes(moov, 8, moov.length))
  const mdia = trak && child(moov, trak, 'mdia')
  const mdhd = mdia && child(moov, mdia, 'mdhd')
  const minf = mdia && child(moov, mdia, 'minf')
  const stbl = minf && child(moov, minf, 'stbl')
  if (!stbl || !mdhd) return null
  const kids = boxes(moov, stbl.start + stbl.header, stbl.end)
  const get = (t: string) => kids.find((x) => x.type === t)
  const stsz = get('stsz')
  const stsc = get('stsc')
  const stts = get('stts')
  const stco = get('stco') ?? get('co64')
  if (!stsz || !stsc || !stts || !stco) return null
  const timescale = u32(moov, mdhd.start + mdhd.header + (moov[mdhd.start + mdhd.header] === 1 ? 20 : 12))

  let p = stsz.start + stsz.header + 4
  const fixed = u32(moov, p)
  const n = u32(moov, p + 4)
  if (!n) return null
  const sizes = new Uint32Array(n)
  for (let i = 0; i < n; i++) sizes[i] = fixed || u32(moov, p + 8 + 4 * i)

  p = stts.start + stts.header + 4
  const durations = new Uint32Array(n)
  let k = 0
  for (let e = 0, entries = u32(moov, p); e < entries && k < n; e++) {
    const count = u32(moov, p + 4 + 8 * e)
    const delta = u32(moov, p + 8 + 8 * e)
    for (let i = 0; i < count && k < n; i++) durations[k++] = delta
  }

  // Своя переменная, а не p: p ниже переиспользуется для stsc, а смещения читаются позже
  const co = stco.start + stco.header + 4
  const wide = stco.type === 'co64'
  const chunkCount = u32(moov, co)
  const chunkOffset = (c: number) => (wide ? u64(moov, co + 4 + 8 * c) : u32(moov, co + 4 + 4 * c))
  p = stsc.start + stsc.header + 4
  const runs = u32(moov, p)
  const offsets = new Float64Array(n)
  let s = 0
  for (let r = 0; r < runs && s < n; r++) {
    const first = u32(moov, p + 4 + 12 * r) - 1
    const per = u32(moov, p + 8 + 12 * r)
    const last = r + 1 < runs ? u32(moov, p + 4 + 12 * (r + 1)) - 1 : chunkCount
    for (let c = first; c < last && s < n; c++) {
      let off = chunkOffset(c)
      for (let i = 0; i < per && s < n; i++) {
        offsets[s] = off
        off += sizes[s]!
        s++
      }
    }
  }
  return { sizes, offsets, durations, timescale }
}

/* ------------------------------ фрагментированный MP4 ------------------------------ */

export function isFragmentedMp4(file: Uint8Array): boolean {
  return boxes(file, 0, file.length).some((x) => x.type === 'moof')
}

/**
 * Фрагментированный MP4 (так YouTube отдаёт звук: пустые таблицы в moov и куски moof+mdat)
 * → обычный M4A. Звук не перекодируется, байты сэмплов те же. Такой файл читают все плееры,
 * и в него можно записать теги. На телефоне это делает MediaMuxer.
 */
export function defragmentMp4(file: Uint8Array): Uint8Array {
  const top = boxes(file, 0, file.length)
  const moovBox = top.find((x) => x.type === 'moov')
  if (!moovBox) throw new Error('В MP4 нет moov')
  const moov = file.subarray(moovBox.start, moovBox.end)
  const moovKids = boxes(moov, 8, moov.length)
  if (moovKids.filter((x) => x.type === 'trak').length !== 1) throw new Error('Пересобрать можно только файл с одной дорожкой')

  // Значения по умолчанию из mvex/trex
  let defDuration = 0
  let defSize = 0
  const mvex = moovKids.find((x) => x.type === 'mvex')
  const trex = mvex && child(moov, mvex, 'trex')
  if (trex) {
    const p = trex.start + trex.header + 4
    defDuration = u32(moov, p + 8)
    defSize = u32(moov, p + 12)
  }

  // Сэмплы всех фрагментов: длительность, размер и где лежат байты
  const durations: number[] = []
  const sizes: number[] = []
  const chunks: Mp4Chunk[] = []
  for (const moof of top.filter((x) => x.type === 'moof')) {
    for (const traf of boxes(file, moof.start + moof.header, moof.end).filter((x) => x.type === 'traf')) {
      const kids = boxes(file, traf.start + traf.header, traf.end)
      const tfhd = kids.find((x) => x.type === 'tfhd')
      if (!tfhd) continue
      let p = tfhd.start + tfhd.header
      const tf = u32(file, p) & 0xffffff
      p += 8 // версия и флаги, track_ID
      let base = moof.start
      if (tf & 0x1) {
        base = u64(file, p)
        p += 8
      }
      if (tf & 0x2) p += 4
      let tDur = defDuration
      let tSize = defSize
      if (tf & 0x8) {
        tDur = u32(file, p)
        p += 4
      }
      if (tf & 0x10) tSize = u32(file, p)
      let cursor = base
      for (const trun of kids.filter((x) => x.type === 'trun')) {
        let q = trun.start + trun.header
        const rf = u32(file, q) & 0xffffff
        const n = u32(file, q + 4)
        q += 8
        if (rf & 0x1) {
          cursor = base + (u32(file, q) | 0)
          q += 4
        }
        if (rf & 0x4) q += 4
        let bytes = 0
        for (let i = 0; i < n; i++) {
          let d = tDur
          let s = tSize
          if (rf & 0x100) {
            d = u32(file, q)
            q += 4
          }
          if (rf & 0x200) {
            s = u32(file, q)
            q += 4
          }
          if (rf & 0x400) q += 4
          if (rf & 0x800) q += 4
          durations.push(d)
          sizes.push(s)
          bytes += s
        }
        if (cursor + bytes > file.length) throw new Error('MP4: фрагмент указывает за конец файла')
        chunks.push({ count: n, data: file.subarray(cursor, cursor + bytes) })
        cursor += bytes
      }
    }
  }
  if (!sizes.length) throw new Error('Во фрагментах нет звука')
  return flatMp4(moov, durations, sizes, chunks)
}

/* ------------------------------ починка ------------------------------ */

/**
 * Файл «ID3 + MP4» (так его портила старая запись тегов): возвращает исходный MP4
 * и то, что было в приписанном теге, чтобы перенести правку в теги MP4.
 */
export function unwrapId3Mp4(file: Uint8Array): { mp4: Uint8Array; edit: Mp4Edit } | null {
  const t = tagSize(file.subarray(0, 10))
  if (!t || t + 8 > file.length || ascii(file, t + 4, 4) !== 'ftyp') return null
  const tags = parseV2(file.subarray(0, t)) ?? {}
  return {
    mp4: file.subarray(t),
    edit: {
      title: tags.title,
      artist: tags.artist,
      album: tags.album,
      genre: tags.genre,
      year: tags.year,
      trackNo: tags.trackNo,
    },
  }
}

/** Байты коробки moov из файла: в браузере по кусочкам, не читая весь файл */
/** Источник байтов: браузерный File или файл на диске компьютера (desktop/DesktopFile) */
export interface ByteSource {
  readonly size: number
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

export async function readMoovFromFile(f: ByteSource): Promise<Uint8Array | null> {
  let p = 0
  for (let guard = 0; guard < 64 && p + 8 <= f.size; guard++) {
    const h = new Uint8Array(await f.slice(p, p + 16).arrayBuffer())
    let size = u32(h, 0)
    const type = ascii(h, 4, 4)
    if (size === 1) size = u64(h, 8)
    else if (size === 0) size = f.size - p
    if (size < 8) return null
    if (type === 'moov') return size > 64 * 1024 * 1024 ? null : new Uint8Array(await f.slice(p, p + size).arrayBuffer())
    p += size
  }
  return null
}

/* ------------------------------ отпечаток ------------------------------ */

/**
 * Отпечаток MP4 по аудиоданным (коробка mdat): правка тегов меняет moov, но не mdat.
 * Совпадает с TrackKey.mp4 в Kotlin.
 */
export async function mp4KeyFromFile(f: ByteSource): Promise<string | null> {
  let p = 0
  for (let guard = 0; guard < 64 && p + 8 <= f.size; guard++) {
    const h = new Uint8Array(await f.slice(p, p + 16).arrayBuffer())
    let size = u32(h, 0)
    let header = 8
    if (size === 1) {
      size = u64(h, 8)
      header = 16
    } else if (size === 0) size = f.size - p
    if (size < header) return null
    if (ascii(h, 4, 4) === 'mdat') {
      const payload = size - header
      const sample = new Uint8Array(await f.slice(p + header, p + header + Math.min(65536, payload)).arrayBuffer())
      return trackKey(payload, 0, sample)
    }
    p += size
  }
  return null
}

export function mp4KeyFromBytes(b: Uint8Array): string | null {
  for (const box of boxes(b, 0, b.length)) {
    if (box.type !== 'mdat') continue
    const payload = box.end - box.start - box.header
    return trackKey(payload, 0, b.subarray(box.start + box.header, box.start + box.header + Math.min(65536, payload)))
  }
  return null
}
