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

/** То же на голых каналах целиком (тесты, короткие демо-треки) */
export function analyzeChannels(data: Float32Array[], sr: number): AnalysisResult {
  const a = new TrackAnalyzer(sr, Math.min(2, data.length))
  a.push(data)
  return a.finish()
}

/**
 * Анализ по кускам: звук подаётся частями (push), итог — finish(). Памяти нужно столько же на час звука,
 * сколько на минуту: хранятся только накопители, огибающая (100 точек в секунду) и блоки громкости.
 * Так анализируются и десятичасовые треки — целиком в память они не помещаются.
 */
export class TrackAnalyzer {
  private readonly filters: [Biquad, Biquad][]
  private readonly block: number
  private readonly envLen: number
  private readonly sub: number[] = []
  private readonly env: number[] = []
  private readonly silence = Math.pow(10, -50 / 20)
  private acc = 0
  private accN = 0
  private peak = 0
  private first = -1
  private last = -1
  private envMax = 0
  private envN = 0
  private sumSq = 0
  private length = 0
  private values = 0

  constructor(
    private readonly sr: number,
    private readonly chans: number,
  ) {
    this.filters = Array.from({ length: chans }, () => kFilter(sr))
    this.block = Math.floor(sr / 10)
    this.envLen = Math.floor(sr / 100)
  }

  push(data: Float32Array[]) {
    const n = data[0]?.length ?? 0
    for (let i = 0; i < n; i++) {
      let fmax = 0
      let fsq = 0
      for (let c = 0; c < data.length; c++) {
        const x = data[c]![i]!
        const ax = Math.abs(x)
        if (ax > fmax) fmax = ax
        this.sumSq += x * x
        if (c < this.chans) {
          const [shelf, hp] = this.filters[c]!
          const y = hp.process(shelf.process(x))
          fsq += y * y
        }
      }
      this.acc += fsq
      if (++this.accN >= this.block) {
        this.sub.push(this.acc / this.accN)
        this.acc = 0
        this.accN = 0
      }
      if (fmax > this.peak) this.peak = fmax
      const at = this.length + i
      if (fmax > this.silence) {
        if (this.first < 0) this.first = at
        this.last = at
      }
      if (fmax > this.envMax) this.envMax = fmax
      if (++this.envN >= this.envLen) {
        this.env.push(this.envMax)
        this.envMax = 0
        this.envN = 0
      }
    }
    this.length += n
    this.values += n * data.length
  }

  finish(): AnalysisResult {
    const { sub, env, sr, length, first, last, peak } = this
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
    // Не Math.max(...env): у часового трека в огибающей сотни тысяч точек — столько аргументов не влезает в стек
    let top = 1e-9
    for (const v of env) if (v > top) top = v
    for (let i = 0; i < 1000; i++) {
      const from = Math.floor((i * env.length) / 1000)
      const to = Math.max(from + 1, Math.floor(((i + 1) * env.length) / 1000))
      let m = 0
      for (let j = from; j < Math.min(to, env.length); j++) if (env[j]! > m) m = env[j]!
      wave[i] = Math.min(255, Math.round(Math.sqrt(m / top) * 255))
    }
    const rmsDb = 10 * Math.log10(this.sumSq / Math.max(1, this.values) + 1e-12)
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
