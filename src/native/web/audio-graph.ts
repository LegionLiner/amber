import { WebEffects } from './audio-effects'

/**
 * Звуковой граф веб-версии: у каждой деки свой GainNode (кривые переходов и нормализация),
 * дальше общие предусилитель → 10 полос эквалайзера → эффекты (эхо, зал…) → лимитер. Так же устроено на телефоне
 * (там это DynamicsProcessing на общей аудиосессии).
 */
export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

let live: AudioGraph | null = null
let freq = new Uint8Array(1024)

/** Граф, чьи уровни показывает подсветка (движок регистрирует его при создании) */
export function showLevelsOf(g: AudioGraph | null) {
  live = g
}

export interface AudioLevels {
  /** Басы, до 150 Гц — в шкале анализатора (децибелы), по ним настроены удары подсветки окна */
  bass: number
  /** Общий уровень до 8 кГц, тоже в децибелах */
  level: number
  /**
   * Полосы в линейной громкости: низ (до 150 Гц), середина (250–2000 Гц), верха (2–8 кГц).
   * В децибелах отголоски соседних частот выглядят почти как сам звук — голос «поднимал» и басы, и верха.
   * В линейной шкале между звучащей полосой и её отголоском разница в десятки раз
   */
  low: number
  mid: number
  high: number
}

/** Байт анализатора (от -100 до -30 дБ) → линейная громкость 0…1 */
const LIN = Float32Array.from({ length: 256 }, (_, b) => 10 ** ((-100 + (b * 70) / 255 + 30) / 20))

/**
 * Что сейчас звучит, 0…1. null — звук ещё не шёл через граф.
 * Читается каждый кадр подсветкой на компьютере, поэтому без выделения памяти.
 */
export function audioLevels(): AudioLevels | null {
  const g = live
  if (!g || g.ctx.state !== 'running') return null
  const a = g.analyser
  if (freq.length !== a.frequencyBinCount) freq = new Uint8Array(a.frequencyBinCount)
  a.getByteFrequencyData(freq)
  const hz = g.ctx.sampleRate / a.fftSize
  const bassTo = Math.max(2, Math.round(150 / hz))
  const allTo = Math.min(freq.length - 1, Math.round(8000 / hz))
  const midFrom = Math.round(250 / hz)
  const midTo = Math.round(2000 / hz)
  let bass = 0
  let all = 0
  let low = 0
  let mid = 0
  let high = 0
  for (let i = 1; i <= allTo; i++) {
    const v = freq[i]!
    all += v
    if (i <= bassTo) {
      bass += v
      low += LIN[v]!
    } else if (i >= midFrom && i < midTo) mid += LIN[v]!
    else if (i >= midTo) high += LIN[v]!
  }
  return {
    bass: bass / (bassTo * 255),
    level: all / (allTo * 255),
    low: low / bassTo,
    mid: mid / Math.max(1, midTo - midFrom),
    high: high / Math.max(1, allTo - midTo + 1),
  }
}

export class AudioGraph {
  readonly ctx: AudioContext
  private readonly preamp: GainNode
  private readonly bands: BiquadFilterNode[]
  private readonly limiter: DynamicsCompressorNode
  private readonly effects: WebEffects
  /** Уровни звука после эффектов — для подсветки в такт музыке на компьютере (audioLevels) */
  readonly analyser: AnalyserNode

  constructor() {
    this.ctx = new AudioContext()
    this.preamp = this.ctx.createGain()
    this.bands = EQ_FREQS.map((f, i) => {
      const b = this.ctx.createBiquadFilter()
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking'
      b.frequency.value = f
      b.Q.value = 1.1
      b.gain.value = 0
      return b
    })
    this.limiter = this.ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -1
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.001
    this.limiter.release.value = 0.06
    let node: AudioNode = this.preamp
    for (const b of this.bands) {
      node.connect(b)
      node = b
    }
    this.effects = new WebEffects(this.ctx)
    node.connect(this.effects.input)
    this.effects.output.connect(this.limiter).connect(this.ctx.destination)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.55
    this.limiter.connect(this.analyser)
  }

  connect(el: HTMLMediaElement): GainNode {
    const src = this.ctx.createMediaElementSource(el)
    const g = this.ctx.createGain()
    g.gain.value = 0
    src.connect(g).connect(this.preamp)
    return g
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => undefined)
  }

  setEffects(fx: Partial<Record<string, number>>) {
    this.effects.set(fx)
  }

  /** boostDb — общий предусилитель нормализации, eqPreampDb — предусилитель эквалайзера */
  setEq(enabled: boolean, bands: number[], eqPreampDb: number, boostDb: number) {
    const total = boostDb + (enabled ? eqPreampDb : 0)
    this.preamp.gain.value = Math.pow(10, total / 20)
    this.bands.forEach((b, i) => (b.gain.value = enabled ? (bands[i] ?? 0) : 0))
  }
}
