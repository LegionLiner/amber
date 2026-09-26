import { tagSize } from './id3'

/**
 * Запись тегов в mp3 — порт android/…/library/Id3Writer.kt.
 * Новый тег ID3v2.3 с текстом в UTF-16, прочие кадры старого тега (обложка, текст песни, рейтинги)
 * переносятся, аудио дописывается без изменений — отпечаток трека остаётся прежним.
 */
export interface Id3Edit {
  title?: string
  artist?: string
  album?: string
  genre?: string
  year?: number
  trackNo?: number
}

interface Frame {
  id: string
  data: Uint8Array
}

const latin1 = new TextDecoder('latin1')
const utf8 = new TextDecoder('utf-8')

function syncsafe(b: Uint8Array, o: number): number {
  return ((b[o]! & 0x7f) << 21) | ((b[o + 1]! & 0x7f) << 14) | ((b[o + 2]! & 0x7f) << 7) | (b[o + 3]! & 0x7f)
}

function be32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0
}

function unsync(b: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]!)
    if (b[i] === 0xff && b[i + 1] === 0) i++
  }
  return Uint8Array.from(out)
}

function utf16le(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out.push(c & 0xff, c >> 8)
  }
  return out
}

function utf16Text(value: string): Uint8Array {
  return Uint8Array.from([1, 0xff, 0xfe, ...utf16le(value)])
}

/** Кадры существующего тега v2.3/v2.4 (v2.2 не переносим: у него другие имена кадров) */
function readFrames(file: Uint8Array, size: number): Frame[] {
  const major = file[3]
  if (major !== 3 && major !== 4) return []
  const flags = file[5]!
  let body = file.subarray(10, Math.min(size, file.length))
  if (flags & 0x80 && major === 3) body = unsync(body)
  let pos = 0
  if (flags & 0x40 && body.length > 4) pos = major === 4 ? syncsafe(body, 0) : be32(body, 0) + 4
  const out: Frame[] = []
  while (pos + 10 <= body.length) {
    if (body[pos] === 0) break
    const id = latin1.decode(body.subarray(pos, pos + 4))
    const n = major === 4 ? syncsafe(body, pos + 4) : be32(body, pos + 4)
    const fflags = (body[pos + 8]! << 8) | body[pos + 9]!
    const start = pos + 10
    const end = Math.min(body.length, start + n)
    if (n <= 0 || start >= end) break
    let data: Uint8Array = body.slice(start, end)
    let skip = false
    if (major === 4) {
      if (fflags & 0x000c) skip = true // сжато или зашифровано
      if (fflags & 0x0001 && data.length > 4) data = data.slice(4)
      if (fflags & 0x0002) data = unsync(data)
    } else if (fflags & 0x00c0) {
      skip = true
    }
    if (!skip) out.push({ id: id === 'TDRC' ? 'TYER' : id, data })
    pos = start + n
  }
  return out
}

/** v2.3 не знает UTF-8: такие текстовые кадры перекодируем в UTF-16 */
function toV23(f: Frame): Frame | null {
  if (!f.data.length || f.data[0] !== 3) return f
  if (f.id.startsWith('T') && f.id !== 'TXXX') {
    const text = utf8.decode(f.data.subarray(1)).replace(/\0+$/, '')
    return { id: f.id, data: utf16Text(f.id === 'TYER' ? text.slice(0, 4) : text) }
  }
  if (f.id === 'TXXX') {
    const zero = f.data.indexOf(0, 1)
    if (zero < 0) return null
    const desc = utf8.decode(f.data.subarray(1, zero))
    const value = utf8.decode(f.data.subarray(zero + 1)).replace(/\0+$/, '')
    return { id: 'TXXX', data: Uint8Array.from([1, 0xff, 0xfe, ...utf16le(desc), 0, 0, 0xff, 0xfe, ...utf16le(value)]) }
  }
  if (f.id === 'APIC') {
    const copy = f.data.slice()
    copy[0] = 0
    return { id: 'APIC', data: copy }
  }
  return null
}

export function writeId3(file: Uint8Array, edit: Id3Edit): Uint8Array {
  const size = Math.min(tagSize(file.subarray(0, 10)), file.length)
  const old = size > 0 ? readFrames(file, size) : []

  const replaced = new Map<string, string>()
  if (edit.title != null) replaced.set('TIT2', edit.title)
  if (edit.artist != null) replaced.set('TPE1', edit.artist)
  if (edit.album != null) replaced.set('TALB', edit.album)
  if (edit.genre != null) replaced.set('TCON', edit.genre)
  if (edit.year != null) replaced.set('TYER', String(edit.year))
  if (edit.trackNo != null) replaced.set('TRCK', String(edit.trackNo))

  const frames: Frame[] = []
  for (const [id, value] of replaced) if (value.trim()) frames.push({ id, data: utf16Text(value.trim()) })
  for (const f of old) {
    if (replaced.has(f.id)) continue
    const v = toV23(f)
    if (v) frames.push(v)
  }

  // Запас на будущие правки, чтобы не переписывать файл целиком каждый раз
  const padding = 1024
  const bodyLen = frames.reduce((s, f) => s + 10 + f.data.length, 0) + padding
  const out = new Uint8Array(10 + bodyLen + (file.length - size))
  out.set([0x49, 0x44, 0x33, 3, 0, 0, (bodyLen >> 21) & 0x7f, (bodyLen >> 14) & 0x7f, (bodyLen >> 7) & 0x7f, bodyLen & 0x7f])
  let o = 10
  for (const f of frames) {
    for (let i = 0; i < 4; i++) out[o + i] = f.id.charCodeAt(i)
    const n = f.data.length
    out.set([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, 0, 0], o + 4)
    out.set(f.data, o + 10)
    o += 10 + n
  }
  out.set(file.subarray(size), 10 + bodyLen)
  return out
}
