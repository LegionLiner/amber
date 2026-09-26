import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { decodeSingleByte, parseV1, parseV2, sha1Hex, tagSize, trackKey } from '@/native/web/id3'

function cp1251(s: string): number[] {
  return [...s].map((ch) => {
    const c = ch.codePointAt(0)!
    if (c < 0x80) return c
    if (c >= 0x410 && c <= 0x44f) return 0xc0 + (c - 0x410)
    if (c === 0x401) return 0xa8
    if (c === 0x451) return 0xb8
    return 0x3f
  })
}

function frame23(id: string, data: number[]): number[] {
  const n = data.length
  return [...[...id].map((c) => c.charCodeAt(0)), (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, 0, 0, ...data]
}

function tag23(frames: number[][]): Uint8Array {
  const body = frames.flat()
  const n = body.length
  return new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f, ...body])
}

describe('кодировки', () => {
  it('CP1251 чинится, Latin-1 с акцентами остаётся', () => {
    expect(decodeSingleByte(new Uint8Array(cp1251('Кино')))).toBe('Кино')
    expect(decodeSingleByte(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe('Café')
  })
})

describe('ID3v2.3', () => {
  const tag = tag23([
    frame23('TIT2', [0, ...cp1251('Группа крови')]),
    frame23('TPE1', [1, 0xff, 0xfe, ...[...'Кино'].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])]),
    frame23('TCON', [0, ...cp1251('(17)')]),
    frame23('TRCK', [0, ...cp1251('3/12')]),
    frame23('USLT', [0, ...cp1251('rus'), 0, ...cp1251('[00:12.00]Первая строка')]),
  ])
  it('читает поля', () => {
    expect(tagSize(tag)).toBe(tag.length)
    const t = parseV2(tag)!
    expect(t.title).toBe('Группа крови')
    expect(t.artist).toBe('Кино')
    expect(t.genre).toBe('Rock')
    expect(t.trackNo).toBe(3)
    expect(t.lyrics).toBe('[00:12.00]Первая строка')
  })
})

describe('ID3v1', () => {
  it('кириллица в 1251', () => {
    const b = new Uint8Array(128)
    b.set([0x54, 0x41, 0x47], 0)
    b.set(cp1251('Ночной проспект'), 3)
    b.set(cp1251('Полночь'), 33)
    b[127] = 17
    const t = parseV1(b)!
    expect(t.title).toBe('Ночной проспект')
    expect(t.artist).toBe('Полночь')
    expect(t.genre).toBe('Rock')
  })
})

describe('SHA-1', () => {
  it('известные значения', () => {
    expect(sha1Hex([new TextEncoder().encode('abc')])).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(sha1Hex([new Uint8Array(0)])).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })
})

/** Разовая сверка с отпечатками, которые посчитал Android на эмуляторе (если тестовые файлы есть рядом) */
const dir = process.env.YANTAR_TESTMUSIC
describe.skipIf(!dir)('совпадение с Android', () => {
  it('отпечатки те же', () => {
    const expected: Record<string, string> = {
      'Download/Midnight Avenue.mp3': 'dda9fd30728f6c822a34',
      'Music/Кино/Группа крови/01. Группа крови.mp3': '17a6c5a5d910d33996de',
      'Telegram/Telegram Audio/Ночной проспект.mp3': '090ad58689cd11d465e3',
    }
    for (const [rel, key] of Object.entries(expected)) {
      const buf = new Uint8Array(fs.readFileSync(path.join(dir!, rel)))
      const t = tagSize(buf.subarray(0, 10))
      const start = t > 0 && t < buf.length ? t : 0
      const sample = buf.subarray(start, Math.min(buf.length, start + 65536))
      expect(trackKey(buf.length, start, sample)).toBe(key)
    }
  })
})
