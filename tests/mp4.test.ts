import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mp4KeyFromBytes, mp4KeyFromFile, readMoov, sniff, unwrapId3Mp4, writeMp4Tags } from '@/native/web/mp4'
import { writeId3 } from '@/native/web/id3-writer'
import { parseV2, tagSize } from '@/native/web/id3'

/**
 * Файлы в fixtures сделаны ffmpeg: AAC в MP4 с расширением .mp3 — как в реальной библиотеке.
 * faststart: moov перед аудио (при записи тегов смещения должны сдвинуться), moovend — moov в конце.
 */
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)))

interface TopBox {
  type: string
  start: number
  end: number
}
function top(b: Uint8Array): TopBox[] {
  const out: TopBox[] = []
  let p = 0
  while (p + 8 <= b.length) {
    const size = new DataView(b.buffer, b.byteOffset + p).getUint32(0)
    out.push({ type: String.fromCharCode(...b.subarray(p + 4, p + 8)), start: p, end: p + size })
    p += size
  }
  return out
}

/** Все смещения кусков из stco/co64 */
function chunkOffsets(b: Uint8Array): number[] {
  const out: number[] = []
  const dv = new DataView(b.buffer, b.byteOffset)
  const walk = (s: number, e: number) => {
    let p = s
    while (p + 8 <= e) {
      const size = dv.getUint32(p)
      const type = String.fromCharCode(...b.subarray(p + 4, p + 8))
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) walk(p + 8, p + size)
      if (type === 'stco') {
        const n = dv.getUint32(p + 12)
        for (let i = 0; i < n; i++) out.push(dv.getUint32(p + 16 + i * 4))
      }
      p += size
    }
  }
  walk(0, b.length)
  return out
}

function moovOf(b: Uint8Array): Uint8Array {
  const m = top(b).find((x) => x.type === 'moov')!
  return b.subarray(m.start, m.end)
}

describe('формат по содержимому', () => {
  it('MP4 с расширением .mp3 — это MP4, а не MPEG', () => {
    expect(sniff(fixture('aac-faststart.mp3').subarray(0, 16))).toBe('mp4')
    expect(sniff(Uint8Array.from([0xff, 0xfb, 0x90, 0x44]))).toBe('mpeg')
  })
  it('ID3, приписанный к MP4, распознаётся как повреждение', () => {
    const broken = writeId3(fixture('aac-faststart.mp3'), { title: 'Сломанный' })
    const t = tagSize(broken.subarray(0, 10))
    expect(sniff(broken.subarray(0, 10), broken.subarray(t, t + 16))).toBe('id3+mp4')
  })
})

describe('теги MP4', () => {
  it('читаются из файла ffmpeg', () => {
    const { tags, durationMs } = readMoov(moovOf(fixture('aac-faststart.mp3')))
    expect(tags.title).toBe('Трек в AAC')
    expect(tags.artist).toBe('Проверочный')
    expect(tags.album).toBe('Контейнеры')
    expect(tags.year).toBe(2024)
    expect(tags.trackNo).toBe(3)
    expect(durationMs).toBeGreaterThan(1900)
    expect(durationMs).toBeLessThan(2200)
  })

  for (const name of ['aac-faststart.mp3', 'aac-moovend.mp3']) {
    it(`запись в ${name}: теги новые, аудио на месте`, () => {
      const src = fixture(name)
      const out = writeMp4Tags(src, { title: 'Новое название', artist: 'Кино', genre: 'Рок', year: 1988, trackNo: 5 })
      // Структура цела: коробки верхнего уровня покрывают весь файл
      const boxes = top(out)
      expect(boxes[boxes.length - 1]!.end).toBe(out.length)
      const { tags, durationMs } = readMoov(moovOf(out))
      expect(tags).toMatchObject({ title: 'Новое название', artist: 'Кино', genre: 'Рок', year: 1988, trackNo: 5 })
      // Нетронутые поля остались
      if (name === 'aac-faststart.mp3') expect(tags.album).toBe('Контейнеры')
      expect(durationMs).toBe(readMoov(moovOf(src)).durationMs)
      // Каждый кусок аудио по новому смещению — те же байты, что по старому
      const before = chunkOffsets(src)
      const after = chunkOffsets(out)
      expect(after.length).toBe(before.length)
      for (let i = 0; i < before.length; i++) {
        expect([...out.subarray(after[i]!, after[i]! + 32)]).toEqual([...src.subarray(before[i]!, before[i]! + 32)])
      }
      // Повторная запись поверх записанного тоже корректна
      const again = writeMp4Tags(out, { title: 'Ещё раз' })
      expect(readMoov(moovOf(again)).tags.title).toBe('Ещё раз')
      expect(readMoov(moovOf(again)).tags.artist).toBe('Кино')
    })
  }

  it('испорченный файл «ID3 + MP4» чинится до исходного MP4, правка переносится', () => {
    const src = fixture('aac-faststart.mp3')
    const broken = writeId3(src, { title: 'Переименованный' })
    const fixed = unwrapId3Mp4(broken)!
    expect(fixed).not.toBeNull()
    expect([...fixed.mp4]).toEqual([...src])
    expect(fixed.edit.title).toBe('Переименованный')
    const retagged = writeMp4Tags(fixed.mp4, fixed.edit)
    expect(readMoov(moovOf(retagged)).tags.title).toBe('Переименованный')
  })

  it('не MP4 не трогает', () => {
    expect(() => writeMp4Tags(Uint8Array.from([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0]), { title: 'x' })).toThrow()
  })
})

describe('отпечаток MP4', () => {
  it('не меняется от правки тегов (раньше менялся у файлов с moov в начале)', () => {
    for (const name of ['aac-faststart.mp3', 'aac-moovend.mp3']) {
      const src = fixture(name)
      const out = writeMp4Tags(src, { title: 'Совсем другое название', artist: 'Кто-то ещё' })
      expect(mp4KeyFromBytes(out)).toBe(mp4KeyFromBytes(src))
    }
  })
  it('в браузере по кусочкам файла — то же, что по байтам целиком', async () => {
    const src = fixture('aac-faststart.mp3')
    expect(await mp4KeyFromFile(new Blob([src]))).toBe(mp4KeyFromBytes(src))
  })
})

describe('обложка', () => {
  // Маленький «JPEG»: движку важны только байты, картинку никто не декодирует
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 300 }, (_, i) => i & 255), 0xff, 0xd9])
  const b64 = Buffer.from(jpeg).toString('base64')

  for (const name of ['aac-faststart.mp3', 'aac-moovend.mp3']) {
    it(`записывается в m4a (${name}) и читается обратно, аудио на месте`, () => {
      const src = fixture(name)
      const out = writeMp4Tags(src, { picture: b64 })
      const { tags } = readMoov(moovOf(out))
      expect([...(tags.picture?.data ?? [])]).toEqual([...jpeg])
      expect(tags.title).toBe(readMoov(moovOf(src)).tags.title)
      const before = chunkOffsets(src)
      const after = chunkOffsets(out)
      for (let i = 0; i < before.length; i++) {
        expect([...out.subarray(after[i]!, after[i]! + 32)]).toEqual([...src.subarray(before[i]!, before[i]! + 32)])
      }
      // Вторая обложка заменяет первую, а не добавляется рядом
      const again = writeMp4Tags(out, { picture: Buffer.from(jpeg.slice().reverse()).toString('base64') })
      expect(readMoov(moovOf(again)).tags.picture?.data.length).toBe(jpeg.length)
    })
  }

  it('записывается в mp3 кадром APIC и заменяет старую', () => {
    const audio = Uint8Array.from([0xff, 0xfb, 0x90, 0x64, ...Array.from({ length: 400 }, () => 0)])
    const once = writeId3(audio, { title: 'С обложкой', picture: b64 })
    const tags = parseV2(once.subarray(0, tagSize(once.subarray(0, 10))))!
    expect(tags.title).toBe('С обложкой')
    expect([...(tags.picture?.data ?? [])]).toEqual([...jpeg])
    expect(tags.picture?.mime).toBe('image/jpeg')
    const twice = writeId3(once, { picture: Buffer.from(jpeg.slice(0, 100)).toString('base64') })
    const t2 = parseV2(twice.subarray(0, tagSize(twice.subarray(0, 10))))!
    expect(t2.picture?.data.length).toBe(100)
    expect(t2.title).toBe('С обложкой')
    // Аудио после тега не тронуто
    expect([...twice.subarray(tagSize(twice.subarray(0, 10)))]).toEqual([...audio])
  })
})
