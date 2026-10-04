import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { defragmentMp4, flatMp4, isFragmentedMp4, mp4SampleTable, readMoov } from '@/native/web/mp4'
import { mp3FrameLength, mp3SyncOffset } from '@/native/web/mp3-sync'
import { TrackAnalyzer, analyzeChannels } from '@/native/web/analysis'

/**
 * Анализ длинных треков по кускам: таблица сэмплов MP4, сборка самостоятельного M4A из части сэмплов,
 * выравнивание кусков MP3 и потоковый анализатор. Файлы — ffmpeg, AAC в MP4 с расширением .mp3.
 */
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)))

function topBoxes(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: { type: string; start: number; end: number }[] = []
  for (let p = 0; p + 8 <= b.length;) {
    const size = dv.getUint32(p)
    out.push({ type: String.fromCharCode(...b.subarray(p + 4, p + 8)), start: p, end: p + size })
    p += size
  }
  return out
}
const moovOf = (b: Uint8Array) => {
  const m = topBoxes(b).find((x) => x.type === 'moov')!
  return b.subarray(m.start, m.end)
}

describe('MP4 по кускам', () => {
  for (const name of ['aac-faststart.mp3', 'aac-moovend.mp3']) {
    it(`таблица сэмплов указывает внутрь mdat (${name})`, () => {
      const file = fixture(name)
      const t = mp4SampleTable(moovOf(file))!
      const mdat = topBoxes(file).find((x) => x.type === 'mdat')!
      expect(t.sizes.length).toBeGreaterThan(10)
      for (let i = 0; i < t.sizes.length; i++) {
        expect(t.offsets[i]).toBeGreaterThanOrEqual(mdat.start + 8)
        expect(t.offsets[i]! + t.sizes[i]!).toBeLessThanOrEqual(mdat.end)
      }
      expect(t.timescale).toBeGreaterThan(0)
    })

    it(`кусок сэмплов — самостоятельный M4A с теми же байтами (${name})`, () => {
      const file = fixture(name)
      const moov = moovOf(file)
      const t = mp4SampleTable(moov)!
      const a = 5
      const b = Math.min(t.sizes.length, 25)
      const data = file.subarray(t.offsets[a]!, t.offsets[b - 1]! + t.sizes[b - 1]!)
      const piece = flatMp4(moov, t.durations.subarray(a, b), t.sizes.subarray(a, b), [{ count: b - a, data }])
      expect(topBoxes(piece).map((x) => x.type)).toEqual(['ftyp', 'moov', 'mdat'])
      const pt = mp4SampleTable(moovOf(piece))!
      expect([...pt.sizes]).toEqual([...t.sizes.subarray(a, b)])
      // Сэмплы в новом файле — те же байты, что в исходном
      for (let i = 0; i < pt.sizes.length; i++) {
        const src = file.subarray(t.offsets[a + i]!, t.offsets[a + i]! + t.sizes[a + i]!)
        const dst = piece.subarray(pt.offsets[i]!, pt.offsets[i]! + pt.sizes[i]!)
        expect(Buffer.from(dst).equals(Buffer.from(src))).toBe(true)
      }
      let ticks = 0
      for (let i = a; i < b; i++) ticks += t.durations[i]!
      expect(readMoov(moovOf(piece)).durationMs).toBe(Math.round((ticks / t.timescale) * 1000))
      expect(isFragmentedMp4(piece)).toBe(false)
    })
  }

  it('обычный файл пересборкой не портится', () => {
    expect(() => defragmentMp4(fixture('aac-faststart.mp3'))).toThrow()
  })
})

describe('MP3 по кускам', () => {
  it('начало кусков ищется по трём кадрам подряд', () => {
    // Три кадра MPEG1 Layer III 128 кбит/с 44,1 кГц по 417 байт, перед ними мусор
    const frame = new Uint8Array(417)
    frame.set([0xff, 0xfb, 0x90, 0x00])
    const bytes = new Uint8Array(37 + 417 * 3)
    bytes.set([0xff, 0xfb, 0x12], 5) // ложный заголовок в мусоре
    for (let i = 0; i < 3; i++) bytes.set(frame, 37 + 417 * i)
    expect(mp3FrameLength(bytes, 37)).toBe(417)
    expect(mp3SyncOffset(bytes)).toBe(37)
    expect(mp3SyncOffset(new Uint8Array(500))).toBe(-1)
  })
})

describe('анализ по кускам', () => {
  it('куски дают тот же итог, что звук целиком', () => {
    const sr = 22050
    const ch = new Float32Array(sr * 40)
    for (let i = 0; i < ch.length; i++) {
      const t = i / sr
      ch[i] = t < 2 ? 0 : 0.4 * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 2 * t))
    }
    const whole = analyzeChannels([ch, ch], sr)
    const a = new TrackAnalyzer(sr, 2)
    for (let p = 0; p < ch.length; p += sr * 7) a.push([ch.slice(p, p + sr * 7), ch.slice(p, p + sr * 7)])
    expect(a.finish()).toEqual(whole)
    expect(whole.introMs).toBeGreaterThan(1900)
  })

  it('часовой трек не переполняет стек', () => {
    const sr = 2000
    const a = new TrackAnalyzer(sr, 1)
    const piece = new Float32Array(sr * 60).map((_, i) => 0.3 * Math.sin(i / 3))
    for (let m = 0; m < 60; m++) a.push([piece])
    expect(a.finish().waveform.length).toBeGreaterThan(1000)
  })
})
