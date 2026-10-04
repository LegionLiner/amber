import { tagSize } from './id3'
import { flatMp4, mp4SampleTable, readMoovFromFile, sniff, type ByteSource } from './mp4'
import { mp3SyncOffset } from './mp3-sync'

/**
 * Звук трека для анализа — кусками, а не целиком. Десятичасовой трек, декодированный разом,
 * занял бы 6 ГБ памяти (на компьютере на этом и падала страница). Здесь в памяти не больше одного куска:
 *
 * — MP4/M4A (AAC): по таблицам сэмплов из moov берётся кусок минуты на три, из него собирается маленький
 *   самостоятельный M4A, его и декодирует браузер;
 * — MP3: кусок байтов, выровненный на начало кадра;
 * — остальное (FLAC, OGG, WAV) — целиком, если файл не огромный.
 *
 * У треков длиннее получаса анализ идёт по выборке: 40 окон по 30 секунд равномерно по всему треку.
 * Громкость, волна и темп по ним почти те же, тишина по краям — точная (первое и последнее окна — края).
 */

export interface SourceFile extends ByteSource {
  arrayBuffer(): Promise<ArrayBuffer>
}

type Decode = (bytes: ArrayBuffer) => Promise<AudioBuffer>

const SEGMENT_SEC = 180
const LONG_SEC = 30 * 60
const WINDOWS = 40
const WINDOW_SEC = 30
/** Форматы, которые нельзя резать: целиком — не больше этого */
const WHOLE_MAX = 48 * 1024 * 1024
const MP3_SLICE = 6 * 1024 * 1024
/** Битрейт mp3 неизвестен заранее: длинным считаем файл больше 40 МБ (≈ полчаса при 192 кбит/с) */
const MP3_LONG_BYTES = 40 * 1024 * 1024
const MP3_WINDOW = 768 * 1024

const toBuffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer

/** Отрезки [начало, конец) в единицах «сэмпл/байт»: подряд по step или выборкой из windows окон по win */
function plan(total: number, step: number, long: boolean, win: number): [number, number][] {
  const out: [number, number][] = []
  if (!long) {
    for (let a = 0; a < total; a += step) out.push([a, Math.min(total, a + step)])
    return out
  }
  const w = Math.min(win, total)
  for (let i = 0; i < WINDOWS; i++) {
    const a = Math.round(((total - w) * i) / (WINDOWS - 1))
    out.push([a, a + w])
  }
  return out
}

export async function* pcmSegments(f: SourceFile, decode: Decode): AsyncGenerator<AudioBuffer> {
  const head = new Uint8Array(await f.slice(0, 16).arrayBuffer())
  const tsz = tagSize(head)
  const after = tsz > 0 ? new Uint8Array(await f.slice(tsz, tsz + 16).arrayBuffer()) : undefined
  const kind = sniff(head, after)

  if (kind === 'mp4') {
    const moov = await readMoovFromFile(f)
    const table = moov && mp4SampleTable(moov)
    if (moov && table) {
      const n = table.sizes.length
      let ticks = 0
      for (let i = 0; i < n; i++) ticks += table.durations[i]!
      const avg = ticks / n || 1024
      const perSec = table.timescale / avg
      const ranges = plan(
        n,
        Math.max(1, Math.round(SEGMENT_SEC * perSec)),
        ticks / table.timescale > LONG_SEC,
        Math.round(WINDOW_SEC * perSec),
      )
      for (const [a, b] of ranges) {
        try {
          yield await decode(toBuffer(await mp4Piece(f, moov, table, a, b)))
        } catch {
          /* битый кусок — дальше */
        }
      }
      return
    }
  }

  if (kind === 'mpeg' && f.size > MP3_SLICE) {
    const ranges = plan(f.size, MP3_SLICE, f.size > MP3_LONG_BYTES, MP3_WINDOW)
    for (const [a, b] of ranges) {
      try {
        const bytes = new Uint8Array(await f.slice(a, b).arrayBuffer())
        // Первый кусок — с ID3 и началом файла, его браузер понимает как есть
        const off = a === 0 ? 0 : mp3SyncOffset(bytes)
        if (off < 0) continue
        yield await decode(toBuffer(bytes.subarray(off)))
      } catch {
        /* кусок не декодировался — дальше */
      }
    }
    return
  }

  if (f.size <= WHOLE_MAX) yield await decode(await f.arrayBuffer())
}

/** Сэмплы a…b-1 файла MP4 как самостоятельный M4A */
async function mp4Piece(
  f: SourceFile,
  moov: Uint8Array,
  t: NonNullable<ReturnType<typeof mp4SampleTable>>,
  a: number,
  b: number,
): Promise<Uint8Array> {
  let lo = Infinity
  let hi = 0
  let bytes = 0
  let contiguous = true
  for (let i = a; i < b; i++) {
    const o = t.offsets[i]!
    if (o < lo) lo = o
    if (o + t.sizes[i]! > hi) hi = o + t.sizes[i]!
    bytes += t.sizes[i]!
    if (i > a && o !== t.offsets[i - 1]! + t.sizes[i - 1]!) contiguous = false
  }
  const raw = new Uint8Array(await f.slice(lo, hi).arrayBuffer())
  let data = raw
  if (!contiguous) {
    // Звук вперемешку с другой дорожкой: собираем только свои сэмплы
    data = new Uint8Array(bytes)
    let p = 0
    for (let i = a; i < b; i++) {
      const o = t.offsets[i]! - lo
      data.set(raw.subarray(o, o + t.sizes[i]!), p)
      p += t.sizes[i]!
    }
  }
  return flatMp4(moov, t.durations.subarray(a, b), t.sizes.subarray(a, b), [{ count: b - a, data }])
}
