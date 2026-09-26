/**
 * Демо-библиотека для разработки в браузере. Названия выдуманные.
 * Часть треков намеренно без тегов, только с именем файла, как в реальной библиотеке.
 */

export interface DemoTrack {
  key: string
  uri: string
  path: string
  folder: string
  fileName: string
  title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  year: number | null
  trackNo: number | null
  durationMs: number
  bitrate: number
  sampleRate: number
  mime: string
  size: number
  seed: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fnv(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function demoKey(s: string): string {
  return fnv(s).toString(16).padStart(8, '0') + fnv(s, 0x12345678).toString(16).padStart(8, '0')
}

const ARTISTS: { name: string; genre: string; albums: string[] }[] = [
  { name: 'Янтарный берег', genre: 'Инди', albums: ['Сосны и соль', 'Отлив'] },
  { name: 'Северо-Запад', genre: 'Пост-панк', albums: ['Бетон и небо'] },
  { name: 'Полночь', genre: 'Синти-поп', albums: ['Неон', 'Последний трамвай'] },
  { name: 'Дворы', genre: 'Рок', albums: ['Двор-колодец'] },
  { name: 'Тёплый свет', genre: 'Эмбиент', albums: ['Лампы'] },
  { name: 'Kosmos Radio', genre: 'Электроника', albums: ['Orbit', 'Night Shift'] },
  { name: 'Late Tram', genre: 'Джаз', albums: ['Blue Hours'] },
  { name: 'Hollow Coast', genre: 'Дрим-поп', albums: ['Salt Air'] },
  { name: 'Неон и Пыль', genre: 'Синти-поп', albums: ['Пыль'] },
  { name: 'Пятая весна', genre: 'Инди', albums: ['Оттепель'] },
]

const WORDS_A = [
  'Ночной',
  'Тихий',
  'Последний',
  'Северный',
  'Стеклянный',
  'Тёплый',
  'Белый',
  'Далёкий',
  'Янтарный',
  'Пустой',
  'Долгий',
  'Сонный',
]
const WORDS_B = ['проспект', 'ветер', 'сад', 'город', 'берег', 'свет', 'трамвай', 'двор', 'мост', 'снег', 'вокзал', 'август']
const EN_A = ['Midnight', 'Neon', 'Quiet', 'Paper', 'Silver', 'Late', 'Golden', 'Hollow']
const EN_B = ['Avenue', 'Signals', 'Harbor', 'Lights', 'Rain', 'Hours', 'Motel', 'Echo']
const JUNK = ['', '', '', '', ' (zaycev.net)', ' [muzmo.ru]', '']

export function buildDemoLibrary(count = 160): DemoTrack[] {
  const rnd = mulberry32(20260926)
  const out: DemoTrack[] = []
  const used = new Set<string>()
  for (let i = 0; i < count; i++) {
    const tagged = rnd() > 0.3
    const ru = rnd() > 0.35
    let title = ru
      ? `${WORDS_A[Math.floor(rnd() * WORDS_A.length)]} ${WORDS_B[Math.floor(rnd() * WORDS_B.length)]}`
      : `${EN_A[Math.floor(rnd() * EN_A.length)]} ${EN_B[Math.floor(rnd() * EN_B.length)]}`
    if (used.has(title)) title += ` ${i % 7 === 0 ? 'II' : '(live)'}`
    used.add(title)
    const artist = ARTISTS[Math.floor(rnd() * ARTISTS.length)]!
    const album = artist.albums[Math.floor(rnd() * artist.albums.length)]!
    const durationMs = Math.round((40 + rnd() * 110) * 1000)
    const seed = fnv(title + i)
    const junk = JUNK[Math.floor(rnd() * JUNK.length)]!

    let folder: string
    let fileName: string
    if (tagged) {
      folder = `Music/${artist.name}/${album}/`
      fileName = `${String((i % 12) + 1).padStart(2, '0')}. ${title}.mp3`
    } else {
      folder = rnd() > 0.5 ? 'Download/' : 'Telegram/Telegram Audio/'
      fileName = rnd() > 0.5 ? `${artist.name} - ${title}${junk}.mp3` : `${title}${junk}.mp3`
    }
    const key = demoKey(folder + fileName)
    out.push({
      key,
      uri: `demo://${key}`,
      path: `/storage/emulated/0/${folder}${fileName}`,
      folder,
      fileName,
      title: tagged ? title : null,
      artist: tagged ? artist.name : null,
      album: tagged ? album : null,
      genre: tagged ? artist.genre : null,
      year: tagged ? 2008 + Math.floor(rnd() * 18) : null,
      trackNo: tagged ? (i % 12) + 1 : null,
      durationMs,
      bitrate: [128, 192, 256, 320][Math.floor(rnd() * 4)]! * 1000,
      sampleRate: 44100,
      mime: 'audio/mpeg',
      size: Math.round((durationMs / 1000) * 40_000),
      seed,
    })
  }
  return out
}
