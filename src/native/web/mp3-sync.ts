/**
 * Начало кадра MPEG-аудио (MP3) в куске файла. Нужно, чтобы декодировать длинный mp3 по частям:
 * браузер не понимает кусок, который начинается посреди кадра. Кадр засчитывается, только если
 * за ним подряд идут ещё два правильных кадра — так случайные байты 0xFF в звуке не путаются с заголовком.
 */

const BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

/** Длина кадра в байтах, если по адресу p правильный заголовок; иначе 0 */
export function mp3FrameLength(b: Uint8Array, p: number): number {
  if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1]! & 0xe0) !== 0xe0) return 0
  const version = (b[p + 1]! >> 3) & 3 // 3 — MPEG1, 2 — MPEG2, 0 — MPEG2.5
  const layer = (b[p + 1]! >> 1) & 3 // 1 — III, 2 — II, 3 — I
  if (version === 1 || layer === 0) return 0
  const brIndex = b[p + 2]! >> 4
  const srIndex = (b[p + 2]! >> 2) & 3
  if (brIndex === 0 || brIndex === 15 || srIndex === 3) return 0
  const lay = 4 - layer
  const kbps = BITRATES[`${version === 3 ? 1 : 2}-${lay}`]![brIndex]!
  const sr = RATES[version]![srIndex]!
  const pad = (b[p + 2]! >> 1) & 1
  if (lay === 1) return (Math.floor((12 * kbps * 1000) / sr) + pad) * 4
  const k = lay === 3 && version !== 3 ? 72 : 144
  return Math.floor((k * kbps * 1000) / sr) + pad
}

/** Смещение первого надёжного кадра в куске (ищется в первых limit байтах); −1 — не нашли */
export function mp3SyncOffset(b: Uint8Array, limit = 64 * 1024): number {
  const end = Math.min(b.length - 4, limit)
  for (let i = 0; i < end; i++) {
    const a = mp3FrameLength(b, i)
    if (!a) continue
    const c = mp3FrameLength(b, i + a)
    if (!c) continue
    if (mp3FrameLength(b, i + a + c)) return i
  }
  return -1
}
