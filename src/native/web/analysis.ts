/**
 * Анализ трека в браузере — порт android/…/analysis/Analyzer.kt:
 * громкость по EBU R128 (K-фильтр, блоки 400 мс, гейты −70 LUFS и −10 LU), пик, тишина по краям,
 * волна на 1000 точек, энергия и грубый темп.
 */

export interface AnalysisResult {
  lufs: number | null
  peakDb: number
  introMs: number
  outroMs: number
  waveform: string
  energy: number
  bpm: number | null
}

class Biquad {
  z1 = 0
  z2 = 0
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}
  process(x: number) {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

function kFilter(fs: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533
  const g = 3.999843853973347
  let q = 0.7071752369554196
  let k = Math.tan((Math.PI * f0) / fs)
  const vh = Math.pow(10, g / 20)
  const vb = Math.pow(vh, 0.4996667741545416)
  let a0 = 1 + k / q + k * k
  const shelf = new Biquad(
    (vh + (vb * k) / q + k * k) / a0,
    (2 * (k * k - vh)) / a0,
    (vh - (vb * k) / q + k * k) / a0,
    (2 * (k * k - 1)) / a0,
    (1 - k / q + k * k) / a0,
  )
  f0 = 38.13547087602444
  q = 0.5003270373238773
  k = Math.tan((Math.PI * f0) / fs)
  a0 = 1 + k / q + k * k
  const hp = new Biquad(1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0)
  return [shelf, hp]
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

export function analyzeBuffer(buf: AudioBuffer): AnalysisResult {
  return analyzeChannels(
    Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)),
    buf.sampleRate,
  )
}

/** То же на голых каналах: так анализ можно отдать в Web Worker */
export function analyzeChannels(data: Float32Array[], sr: number): AnalysisResult {
  const chans = Math.min(data.length, 2)
  const length = data[0]?.length ?? 0
  const filters = Array.from({ length: chans }, () => kFilter(sr))
  const block = Math.floor(sr / 10)
  const envLen = Math.floor(sr / 100)
  const sub: number[] = []
  const env: number[] = []
  const silence = Math.pow(10, -50 / 20)
  let acc = 0
  let accN = 0
  let peak = 0
  let first = -1
  let last = -1
  let envMax = 0
  let envN = 0
  let sumSq = 0
  for (let i = 0; i < length; i++) {
    let fmax = 0
    let fsq = 0
    for (let c = 0; c < data.length; c++) {
      const x = data[c]![i]!
      const ax = Math.abs(x)
      if (ax > fmax) fmax = ax
      sumSq += x * x
      if (c < chans) {
        const [shelf, hp] = filters[c]!
        const y = hp.process(shelf.process(x))
        fsq += y * y
      }
    }
    acc += fsq
    if (++accN >= block) {
      sub.push(acc / accN)
      acc = 0
      accN = 0
    }
    if (fmax > peak) peak = fmax
    if (fmax > silence) {
      if (first < 0) first = i
      last = i
    }
    if (fmax > envMax) envMax = fmax
    if (++envN >= envLen) {
      env.push(envMax)
      envMax = 0
      envN = 0
    }
  }
  const blocks: number[] = []
  for (let i = 0; i + 3 < sub.length; i++) blocks.push((sub[i]! + sub[i + 1]! + sub[i + 2]! + sub[i + 3]!) / 4)
  const L = (ms: number) => -0.691 + 10 * Math.log10(ms)
  const abs70 = blocks.filter((b) => b > 0 && L(b) > -70)
  let lufs: number | null = null
  if (abs70.length) {
    const rel = L(abs70.reduce((s, x) => s + x, 0) / abs70.length) - 10
    const gated = abs70.filter((b) => L(b) > rel)
    if (gated.length) lufs = L(gated.reduce((s, x) => s + x, 0) / gated.length)
  }
  const wave = new Uint8Array(1000)
  const top = Math.max(1e-9, ...env)
  for (let i = 0; i < 1000; i++) {
    const from = Math.floor((i * env.length) / 1000)
    const to = Math.max(from + 1, Math.floor(((i + 1) * env.length) / 1000))
    let m = 0
    for (let j = from; j < Math.min(to, env.length); j++) if (env[j]! > m) m = env[j]!
    wave[i] = Math.min(255, Math.round(Math.sqrt(m / top) * 255))
  }
  const rmsDb = 10 * Math.log10(sumSq / Math.max(1, length * data.length) + 1e-12)
  return {
    lufs,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -90,
    introMs: first > 0 ? Math.round((first / sr) * 1000) : 0,
    outroMs: last >= 0 ? Math.round(((length - 1 - last) / sr) * 1000) : 0,
    waveform: toBase64(wave),
    energy: Math.min(1, Math.max(0, (rmsDb + 30) / 25)),
    bpm: estimateBpm(env),
  }
}

function estimateBpm(env: number[]): number | null {
  if (env.length < 1500) return null
  const start = Math.floor(env.length / 4)
  const n = Math.min(6000, env.length - start)
  const flux = new Float64Array(n)
  for (let i = 1; i < n; i++) flux[i] = Math.max(0, env[start + i]! - env[start + i - 1]!)
  const mean = flux.reduce((s, x) => s + x, 0) / n
  for (let i = 0; i < n; i++) flux[i]! -= mean
  let best = 0
  let bestLag = 0
  for (let lag = 33; lag <= 86; lag++) {
    let s = 0
    for (let i = lag; i < n; i++) s += flux[i]! * flux[i - lag]!
    if (s > best) {
      best = s
      bestLag = lag
    }
  }
  return bestLag ? 6000 / bestLag : null
}
