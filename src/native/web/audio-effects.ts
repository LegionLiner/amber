import type { EffectId } from '@/domain/effects'

/**
 * Эффекты веб-версии на узлах Web Audio — те же восемь, что SoundEffects.kt на телефоне, и в том же порядке:
 * караоке → бас → за стеной → радио → ширина → 8D → эхо → зал. Каждый эффект — звено цепочки с сухим
 * и обработанным путём; сила меняет их баланс (плавно, setTargetAtTime), выключенный эффект прозрачен.
 */
interface Stage {
  input: GainNode
  output: GainNode
  set(a: number): void
}

const TC = 0.04

function ramp(p: AudioParam, v: number, ctx: BaseAudioContext) {
  p.setTargetAtTime(v, ctx.currentTime, TC)
}

/** Звено «сухой + обработанный»: wet(a) и dry(a) задают баланс */
function mix(
  ctx: BaseAudioContext,
  build: (input: AudioNode) => AudioNode,
  wetOf: (a: number) => number,
  dryOf: (a: number) => number = (a) => 1 - a,
): Stage {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  wet.gain.value = 0
  input.connect(dry).connect(output)
  build(input).connect(wet).connect(output)
  return {
    input,
    output,
    set(a) {
      ramp(wet.gain, wetOf(a), ctx)
      ramp(dry.gain, dryOf(a), ctx)
    },
  }
}

/** Матрица 2×2 над стерео: [ll, rl, lr, rr] — вклад левого и правого входа в левый и правый выход */
function matrix(ctx: BaseAudioContext, input: AudioNode, out: AudioNode) {
  const split = ctx.createChannelSplitter(2)
  const merge = ctx.createChannelMerger(2)
  const g = [0, 1, 2, 3].map(() => ctx.createGain())
  input.connect(split)
  split.connect(g[0]!, 0).connect(merge, 0, 0)
  split.connect(g[1]!, 1).connect(merge, 0, 0)
  split.connect(g[2]!, 0).connect(merge, 0, 1)
  split.connect(g[3]!, 1).connect(merge, 0, 1)
  merge.connect(out)
  return (ll: number, rl: number, lr: number, rr: number) => {
    ;[ll, rl, lr, rr].forEach((v, i) => ramp(g[i]!.gain, v, ctx))
  }
}

function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.round(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
  }
  return buf
}

export class WebEffects {
  readonly input: GainNode
  readonly output: GainNode
  private readonly stages: Record<EffectId, Stage>

  constructor(ctx: BaseAudioContext) {
    const c = ctx
    this.input = c.createGain()
    this.output = c.createGain()

    const karaoke = ((): Stage => {
      const input = c.createGain()
      const output = c.createGain()
      const dry = c.createGain()
      const wet = c.createGain()
      wet.gain.value = 0
      input.connect(dry).connect(output)
      // голос в центре: остаётся разница каналов, низы середины возвращаются
      const sideSum = c.createGain()
      const side = matrix(c, input, sideSum)
      side(0.5, -0.5, -0.5, 0.5)
      const low = c.createBiquadFilter()
      low.type = 'lowpass'
      low.frequency.value = 160
      input.connect(low).connect(sideSum)
      sideSum.connect(wet).connect(output)
      return {
        input,
        output,
        set(a) {
          ramp(wet.gain, a, c)
          ramp(dry.gain, 1 - a, c)
        },
      }
    })()

    const bassF = c.createBiquadFilter()
    bassF.type = 'lowshelf'
    bassF.frequency.value = 95
    bassF.gain.value = 0
    const bass = passthrough(c, bassF, (a) => ramp(bassF.gain, 11 * a, c))

    const wallF = c.createBiquadFilter()
    wallF.type = 'lowpass'
    wallF.Q.value = 0.75
    wallF.frequency.value = 20000
    const wall = passthrough(c, wallF, (a) => ramp(wallF.frequency, a > 0.001 ? 12000 * Math.pow(500 / 12000, a) : 20000, c))

    const radio = mix(
      c,
      (input) => {
        const mono = c.createGain()
        mono.channelCount = 1
        mono.channelCountMode = 'explicit'
        const hp = c.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 420
        const lp = c.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 3200
        const sat = c.createWaveShaper()
        const curve = new Float32Array(1024)
        for (let i = 0; i < curve.length; i++) curve[i] = (Math.tanh((i / 511.5 - 1) * 2.2) / 0.976) * 1.25
        sat.curve = curve
        input.connect(mono).connect(hp).connect(lp).connect(sat)
        return sat
      },
      (a) => a,
    )

    const wide = ((): Stage => {
      const input = c.createGain()
      const output = c.createGain()
      const gains = matrix(c, input, output)
      return {
        input,
        output,
        set(a) {
          const k = 1.3 * a
          const n = 1 / (1 + 0.35 * a)
          gains((1 + k / 2) * n, (-k / 2) * n, (-k / 2) * n, (1 + k / 2) * n)
        },
      }
    })()
    wide.set(0)

    const orbit = mix(
      c,
      (input) => {
        const mono = c.createGain()
        mono.channelCount = 1
        mono.channelCountMode = 'explicit'
        const pan = c.createStereoPanner()
        pan.pan.value = 0
        const lfo = c.createOscillator()
        lfo.frequency.value = 0.1
        lfo.connect(pan.pan)
        lfo.start()
        input.connect(mono).connect(pan)
        return pan
      },
      (a) => a,
    )

    const echo = mix(
      c,
      (input) => {
        const mono = c.createGain()
        mono.channelCount = 1
        mono.channelCountMode = 'explicit'
        const dl = c.createDelay(1)
        const dr = c.createDelay(1)
        dl.delayTime.value = 0.32
        dr.delayTime.value = 0.32
        const fbl = c.createGain()
        const fbr = c.createGain()
        fbl.gain.value = 0.45
        fbr.gain.value = 0.45
        input.connect(mono).connect(dl)
        dl.connect(fbl).connect(dr)
        dr.connect(fbr).connect(dl)
        const merge = c.createChannelMerger(2)
        dl.connect(merge, 0, 0)
        dr.connect(merge, 0, 1)
        return merge
      },
      (a) => 0.6 * a,
      () => 1,
    )

    const reverb = mix(
      c,
      (input) => {
        const conv = c.createConvolver()
        conv.buffer = impulse(c, 2.6)
        input.connect(conv)
        return conv
      },
      (a) => 0.8 * a,
      (a) => 1 - 0.3 * a,
    )

    this.stages = { karaoke, bass, wall, radio, wide, orbit, echo, reverb }
    let node: AudioNode = this.input
    for (const s of [karaoke, bass, wall, radio, wide, orbit, echo, reverb]) {
      node.connect(s.input)
      node = s.output
    }
    node.connect(this.output)
  }

  set(fx: Partial<Record<string, number>>) {
    for (const [id, s] of Object.entries(this.stages)) s.set(Math.min(1, Math.max(0, fx[id] ?? 0)))
  }
}

/** Звено без сухого пути: фильтр сам прозрачен при нулевой силе */
function passthrough(ctx: BaseAudioContext, node: AudioNode, set: (a: number) => void): Stage {
  const input = ctx.createGain()
  const output = ctx.createGain()
  input.connect(node).connect(output)
  return { input, output, set }
}
