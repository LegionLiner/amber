/**
 * Синтезатор «музыки» для демо-треков: у каждого трека свой темп, лад и мелодия.
 * Нужен только чтобы в браузере было что слушать при разработке.
 */

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

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

/** Сырые отсчёты 22 050 Гц, моно */
export function synthPcm(seed: number, durationMs: number): { pcm: Int16Array; sr: number } {
  const sr = 22050
  const n = Math.floor((sr * durationMs) / 1000)
  const rnd = mulberry32(seed)
  const bpm = 76 + Math.floor(rnd() * 52)
  const step = Math.floor((sr * 60) / bpm / 2)
  const root = 45 + Math.floor(rnd() * 10)
  const scale = [0, 3, 5, 7, 10, 12, 15, 17]
  const chords = [0, -4, 3, -2]
  const pattern = Array.from({ length: 8 }, () => scale[Math.floor(rnd() * scale.length)]!)
  const wave = rnd() > 0.5 ? 'tri' : 'sine'

  const pcm = new Int16Array(n)
  let phaseLead = 0
  let phaseBass = 0
  const fade = sr * 1.5

  for (let i = 0; i < n; i++) {
    const s = Math.floor(i / step)
    const inStep = (i % step) / step
    const chord = chords[Math.floor(s / 16) % chords.length]!
    const lead = hz(root + 12 + chord + pattern[s % 8]!)
    const bass = hz(root - 12 + chord + (s % 4 === 2 ? 7 : 0))
    phaseLead += lead / sr
    phaseBass += bass / sr
    const pl = phaseLead % 1
    const leadV = wave === 'tri' ? 1 - 4 * Math.abs(pl - 0.5) : Math.sin(2 * Math.PI * pl)
    const bassV = Math.sin(2 * Math.PI * (phaseBass % 1))
    const envLead = Math.exp(-inStep * 3.2)
    let v = leadV * envLead * 0.32 + bassV * 0.22
    if (i < fade) v *= i / fade
    if (i > n - fade) v *= (n - i) / fade
    pcm[i] = Math.max(-1, Math.min(1, v)) * 30000
  }
  return { pcm, sr }
}

export function synthWav(seed: number, durationMs: number): Blob {
  const { pcm, sr } = synthPcm(seed, durationMs)

  const header = new ArrayBuffer(44)
  const dv = new DataView(header)
  const w = (o: number, s: string) => [...s].forEach((c, k) => dv.setUint8(o + k, c.charCodeAt(0)))
  w(0, 'RIFF')
  dv.setUint32(4, 36 + pcm.byteLength, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  w(36, 'data')
  dv.setUint32(40, pcm.byteLength, true)
  return new Blob([header, pcm.buffer as ArrayBuffer], { type: 'audio/wav' })
}
