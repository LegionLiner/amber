/**
 * Звуковой граф веб-версии: у каждой деки свой GainNode (кривые переходов и нормализация),
 * дальше общие предусилитель → 10 полос эквалайзера → лимитер. Так же устроено на телефоне
 * (там это DynamicsProcessing на общей аудиосессии).
 */
export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

export class AudioGraph {
  readonly ctx: AudioContext
  private readonly preamp: GainNode
  private readonly bands: BiquadFilterNode[]
  private readonly limiter: DynamicsCompressorNode

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
    node.connect(this.limiter).connect(this.ctx.destination)
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

  /** boostDb — общий предусилитель нормализации, eqPreampDb — предусилитель эквалайзера */
  setEq(enabled: boolean, bands: number[], eqPreampDb: number, boostDb: number) {
    const total = boostDb + (enabled ? eqPreampDb : 0)
    this.preamp.gain.value = Math.pow(10, total / 20)
    this.bands.forEach((b, i) => (b.gain.value = enabled ? (bands[i] ?? 0) : 0))
  }
}
