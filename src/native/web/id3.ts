/**
 * Разбор ID3 в браузере — порт android/…/library/Id3Reader.kt и TextFix.kt.
 * Нужен, чтобы в веб-версии (Docker) открывать папку с настоящими mp3.
 * Отпечаток трека считается так же, как на телефоне: бэкап из браузера подходит телефону.
 */

export interface Id3Picture {
  mime: string
  data: Uint8Array
  front: boolean
}

export interface Id3Tags {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  genre?: string
  year?: number
  trackNo?: number
  discNo?: number
  picture?: Id3Picture
  lyrics?: string
  synced?: { t: number; line: string }[]
  popm?: number
  rgTrackDb?: number
  rgAlbumDb?: number
}

const latin1 = new TextDecoder('latin1')
const cp1251 = new TextDecoder('windows-1251')
const utf8 = new TextDecoder('utf-8')
const utf16le = new TextDecoder('utf-16le')
const utf16be = new TextDecoder('utf-16be')

function mostlyCyrillic(s: string): boolean {
  let letters = 0
  let cyr = 0
  for (const ch of s) {
    if (/\p{L}/u.test(ch)) {
      letters++
      if (/[А-яЁё]/.test(ch)) cyr++
    }
  }
  return cyr > 0 && cyr * 2 > letters
}

/** Latin-1 или Windows-1251: берём 1251, если после перекодировки больше половины букв кириллические */
export function decodeSingleByte(b: Uint8Array): string {
  if (!b.some((x) => x >= 0x80)) return latin1.decode(b)
  const cyr = cp1251.decode(b)
  return mostlyCyrillic(cyr) ? cyr : latin1.decode(b)
}

function decode(enc: number, b: Uint8Array): string {
  if (!b.length) return ''
  if (enc === 0) return decodeSingleByte(b)
  if (enc === 1) {
    if (b[0] === 0xfe && b[1] === 0xff) return utf16be.decode(b.subarray(2))
    if (b[0] === 0xff && b[1] === 0xfe) return utf16le.decode(b.subarray(2))
    return utf16le.decode(b)
  }
  if (enc === 2) return utf16be.decode(b)
  return utf8.decode(b)
}

function termEnd(enc: number, b: Uint8Array, from: number): number {
  if (enc === 1 || enc === 2) {
    for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i
    return b.length
  }
  const z = b.indexOf(0, from)
  return z < 0 ? b.length : z
}

const termLen = (enc: number) => (enc === 1 || enc === 2 ? 2 : 1)

const syncsafe = (b: Uint8Array, o: number) =>
  ((b[o]! & 0x7f) << 21) | ((b[o + 1]! & 0x7f) << 14) | ((b[o + 2]! & 0x7f) << 7) | (b[o + 3]! & 0x7f)
const be32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0
const be24 = (b: Uint8Array, o: number) => (b[o]! << 16) | (b[o + 1]! << 8) | b[o + 2]!

export function tagSize(h: Uint8Array): number {
  if (h.length < 10 || h[0] !== 0x49 || h[1] !== 0x44 || h[2] !== 0x33) return 0
  const footer = h[3] === 4 && (h[5]! & 0x10) !== 0 ? 10 : 0
  return 10 + syncsafe(h, 6) + footer
}

function unsync(b: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]!)
    if (b[i] === 0xff && b[i + 1] === 0) i++
  }
  return new Uint8Array(out)
}

const GENRES = [
  'Blues',
  'Classic Rock',
  'Country',
  'Dance',
  'Disco',
  'Funk',
  'Grunge',
  'Hip-Hop',
  'Jazz',
  'Metal',
  'New Age',
  'Oldies',
  'Other',
  'Pop',
  'R&B',
  'Rap',
  'Reggae',
  'Rock',
  'Techno',
  'Industrial',
  'Alternative',
  'Ska',
  'Death Metal',
  'Pranks',
  'Soundtrack',
  'Euro-Techno',
  'Ambient',
  'Trip-Hop',
  'Vocal',
  'Jazz+Funk',
  'Fusion',
  'Trance',
  'Classical',
  'Instrumental',
  'Acid',
  'House',
  'Game',
  'Sound Clip',
  'Gospel',
  'Noise',
  'Alternative Rock',
  'Bass',
  'Soul',
  'Punk',
  'Space',
  'Meditative',
  'Instrumental Pop',
  'Instrumental Rock',
  'Ethnic',
  'Gothic',
  'Darkwave',
  'Techno-Industrial',
  'Electronic',
  'Pop-Folk',
  'Eurodance',
  'Dream',
  'Southern Rock',
  'Comedy',
  'Cult',
  'Gangsta',
  'Top 40',
  'Christian Rap',
  'Pop/Funk',
  'Jungle',
  'Native American',
  'Cabaret',
  'New Wave',
  'Psychedelic',
  'Rave',
  'Showtunes',
  'Trailer',
  'Lo-Fi',
  'Tribal',
  'Acid Punk',
  'Acid Jazz',
  'Polka',
  'Retro',
  'Musical',
  'Rock & Roll',
  'Hard Rock',
]

function genre(raw?: string): string | undefined {
  if (!raw) return undefined
  const m = raw.trim().match(/^\((\d+)\)(.*)$/)
  if (m) return m[2]!.trim() || GENRES[Number(m[1])]
  const n = Number(raw.trim())
  if (Number.isInteger(n) && raw.trim() !== '') return GENRES[n]
  return raw.trim() || undefined
}

function text(f: Uint8Array): string | undefined {
  if (!f.length) return undefined
  const enc = f[0]!
  const s = decode(enc, f.subarray(1, termEnd(enc, f, 1)))
    .replace(/\0+$/, '')
    .trim()
  return s || undefined
}

export function parseV2(tag: Uint8Array): Id3Tags | null {
  if (tagSize(tag) === 0) return null
  const major = tag[3]!
  if (major < 2 || major > 4) return null
  const flags = tag[5]!
  let data = tag
  let pos = 10
  let end = Math.min(tag.length, 10 + syncsafe(tag, 6))
  if (flags & 0x80 && major < 4) {
    data = unsync(tag.subarray(10, end))
    pos = 0
    end = data.length
  }
  if (flags & 0x40 && major >= 3 && end - pos > 4)
    pos += Math.min(end - pos, major === 4 ? syncsafe(data, pos) : be32(data, pos) + 4)
  const t: Id3Tags = {}
  const hl = major === 2 ? 6 : 10
  while (pos + hl <= end) {
    const id = latin1.decode(data.subarray(pos, pos + (major === 2 ? 3 : 4)))
    const size = major === 2 ? be24(data, pos + 3) : major === 4 ? syncsafe(data, pos + 4) : be32(data, pos + 4)
    const fflags = major === 2 ? 0 : (data[pos + 8]! << 8) | data[pos + 9]!
    if (id.charCodeAt(0) === 0 || size <= 0) break
    const start = pos + hl
    let f = data.subarray(start, Math.min(end, start + size))
    if (major === 4) {
      if (fflags & 0x0001 && f.length > 4) f = f.subarray(4)
      if (fflags & 0x0002) f = unsync(f)
    }
    const compressed = major === 3 ? (fflags & 0x00c0) !== 0 : major === 4 ? (fflags & 0x000c) !== 0 : false
    if (!compressed) readFrame(t, id, f)
    pos = start + size
  }
  return t
}

function readFrame(t: Id3Tags, id: string, f: Uint8Array) {
  switch (id) {
    case 'TIT2':
    case 'TT2':
      t.title = text(f)
      break
    case 'TPE1':
    case 'TP1':
      t.artist = text(f)
      break
    case 'TALB':
    case 'TAL':
      t.album = text(f)
      break
    case 'TPE2':
    case 'TP2':
      t.albumArtist = text(f)
      break
    case 'TCON':
    case 'TCO':
      t.genre = genre(text(f))
      break
    case 'TYER':
    case 'TYE':
    case 'TDRC':
      t.year ??= Number(text(f)?.slice(0, 4)) || undefined
      break
    case 'TRCK':
    case 'TRK':
      t.trackNo = Number(text(f)?.split('/')[0]) || undefined
      break
    case 'TPOS':
    case 'TPA':
      t.discNo = Number(text(f)?.split('/')[0]) || undefined
      break
    case 'USLT':
    case 'ULT': {
      if (f.length < 5 || t.lyrics) break
      const enc = f[0]!
      const s = termEnd(enc, f, 4) + termLen(enc)
      t.lyrics = decode(enc, f.subarray(s)).replace(/\0+$/, '') || undefined
      break
    }
    case 'SYLT':
    case 'SLT': {
      if (f.length < 7 || t.synced || f[4] !== 2) break
      const enc = f[0]!
      let p = termEnd(enc, f, 6) + termLen(enc)
      const lines: { t: number; line: string }[] = []
      while (p < f.length) {
        const e = termEnd(enc, f, p)
        const line = decode(enc, f.subarray(p, e)).trim()
        p = e + termLen(enc)
        if (p + 4 > f.length) break
        lines.push({ t: be32(f, p), line })
        p += 4
      }
      if (lines.length) t.synced = lines
      break
    }
    case 'APIC':
    case 'PIC': {
      if (f.length < 4) break
      const enc = f[0]!
      let p: number
      let mime = 'image/jpeg'
      if (id === 'PIC') {
        mime = latin1.decode(f.subarray(1, 4)).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg'
        p = 4
      } else {
        const z = f.indexOf(0, 1)
        if (z < 0) break
        mime = latin1.decode(f.subarray(1, z)) || mime
        p = z + 1
      }
      const type = f[p]!
      p = termEnd(enc, f, p + 1) + termLen(enc)
      if (p >= f.length) break
      const front = type === 3
      if (!t.picture || (front && !t.picture.front)) t.picture = { mime, data: f.slice(p), front }
      break
    }
    case 'POPM':
    case 'POP': {
      const z = f.indexOf(0)
      if (z >= 0 && z + 1 < f.length) t.popm = f[z + 1]
      break
    }
    case 'TXXX':
    case 'TXX': {
      if (f.length < 2) break
      const enc = f[0]!
      const dEnd = termEnd(enc, f, 1)
      const desc = decode(enc, f.subarray(1, dEnd)).toUpperCase()
      const vStart = dEnd + termLen(enc)
      const value = decode(enc, f.subarray(vStart, termEnd(enc, f, vStart)))
      const gain = Number(value.replace(',', '.').replace(/[^0-9.+-]/g, ''))
      if (desc === 'REPLAYGAIN_TRACK_GAIN' && Number.isFinite(gain)) t.rgTrackDb = gain
      if (desc === 'REPLAYGAIN_ALBUM_GAIN' && Number.isFinite(gain)) t.rgAlbumDb = gain
      break
    }
  }
}

export function parseV1(tail: Uint8Array): Id3Tags | null {
  if (tail.length < 128) return null
  const o = tail.length - 128
  if (tail[o] !== 0x54 || tail[o + 1] !== 0x41 || tail[o + 2] !== 0x47) return null
  const field = (from: number, len: number) => {
    let end = from + len
    for (let i = from; i < from + len; i++)
      if (tail[i] === 0) {
        end = i
        break
      }
    return decodeSingleByte(tail.subarray(from, end)).trim() || undefined
  }
  const t: Id3Tags = { title: field(o + 3, 30), artist: field(o + 33, 30), album: field(o + 63, 30) }
  t.year = Number(field(o + 93, 4)) || undefined
  if (tail[o + 125] === 0 && tail[o + 126] !== 0) t.trackNo = tail[o + 126]
  t.genre = GENRES[tail[o + 127]!]
  return t
}

/* ---------------- SHA-1 (как на телефоне, чтобы отпечатки совпадали) ---------------- */

export function sha1Hex(chunks: Uint8Array[]): string {
  let total = 0
  for (const c of chunks) total += c.length
  const msgLen = total + 9
  const padded = new Uint8Array(Math.ceil(msgLen / 64) * 64)
  let o = 0
  for (const c of chunks) {
    padded.set(c, o)
    o += c.length
  }
  padded[total] = 0x80
  const bits = total * 8
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32))
  dv.setUint32(padded.length - 4, bits >>> 0)
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4)
    for (let j = 16; j < 80; j++) {
      const x = w[j - 3]! ^ w[j - 8]! ^ w[j - 14]! ^ w[j - 16]!
      w[j] = (x << 1) | (x >>> 31)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let j = 0; j < 80; j++) {
      const f = j < 20 ? (b & c) | (~b & d) : j < 40 ? b ^ c ^ d : j < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d
      const k = j < 20 ? 0x5a827999 : j < 40 ? 0x6ed9eba1 : j < 60 ? 0x8f1bbcdc : 0xca62c1d6
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]!) >>> 0
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('')
}

/** Отпечаток трека: SHA-1(8 байт размера аудиочасти + первые 64 КБ после ID3-тега), первые 20 знаков */
export function trackKey(fileSize: number, tagLen: number, sample: Uint8Array): string {
  const sizeBytes = new Uint8Array(8)
  new DataView(sizeBytes.buffer).setBigUint64(0, BigInt(fileSize - tagLen))
  return sha1Hex([sizeBytes, sample]).slice(0, 20)
}

/** Первый кадр MPEG: частота и битрейт */
export function mp3Frame(b: Uint8Array): { sampleRate: number; bitrate: number } | null {
  const rates = [
    [11025, 12000, 8000],
    [0, 0, 0],
    [22050, 24000, 16000],
    [44100, 48000, 32000],
  ]
  const v1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const v2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  for (let i = 0; i + 4 <= b.length; i++) {
    if (b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) continue
    const version = (b[i + 1]! >> 3) & 3
    const layer = (b[i + 1]! >> 1) & 3
    const br = (b[i + 2]! >> 4) & 0xf
    const sr = (b[i + 2]! >> 2) & 3
    if (version !== 1 && layer === 1 && br >= 1 && br <= 14 && sr < 3) {
      const rate = rates[version]![sr]!
      if (rate > 0) return { sampleRate: rate, bitrate: (version === 3 ? v1 : v2)[br]! * 1000 }
    }
  }
  return null
}
