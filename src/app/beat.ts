import { audioLevels, type AudioLevels } from '@/native/web/audio-graph'

/**
 * Как музыка «дышит» — для подсветки в такт (фон окна на компьютере, режим «Сцена»).
 *
 * Удар — это бас заметно выше своего среднего за последнюю треть секунды: так вспышки видны и в тихих,
 * и в громких треках, а ровный гул не держит свечение на максимуме. Удар — сразу вверх, спад за ~0,2 с.
 * Громкость, середина и верха — относительно своих недавних максимумов, сглаженно.
 * Всё считается по времени, а не по кадрам: в свёрнутом окне кадров меньше, а ритм тот же.
 */
export interface Beat {
  /** Удар баса, 0…1 */
  hit: number
  /** Общая громкость относительно недавнего максимума, 0…1 */
  loud: number
  /** Середина (голос, гитары) и верха (тарелки, хэты), 0…1 */
  mid: number
  high: number
}

export class BeatFollower {
  private avg = 0
  private env = 0
  private loud = 0
  private loudPeak = 0.1
  private mid = 0
  private midPeak = 0.1
  private high = 0
  private highPeak = 0.05

  /** dt — миллисекунды с прошлого раза; l — уровни (null — звука нет: всё плавно гаснет) */
  update(dt: number, l: AudioLevels | null = audioLevels()): Beat {
    const k = (tau: number) => 1 - Math.exp(-dt / tau)
    const bass = l?.bass ?? 0
    this.avg += (bass - this.avg) * k(350)
    const hit = Math.min(1, Math.max(0, bass - this.avg) / Math.max(0.03, this.avg * 0.22))
    this.env = hit > this.env ? hit : this.env * Math.exp(-dt / 200)

    const rel = (v: number, peak: number) => (peak > 0 ? Math.min(1, v / peak) : 0)
    this.loudPeak = Math.max(l?.level ?? 0, this.loudPeak * Math.exp(-dt / 8000), 0.05)
    this.loud += (rel(l?.level ?? 0, this.loudPeak) - this.loud) * k(300)
    this.midPeak = Math.max(l?.mid ?? 0, this.midPeak * Math.exp(-dt / 8000), 0.05)
    this.mid += (rel(l?.mid ?? 0, this.midPeak) - this.mid) * k(400)
    this.highPeak = Math.max(l?.high ?? 0, this.highPeak * Math.exp(-dt / 8000), 0.03)
    this.high += (rel(l?.high ?? 0, this.highPeak) - this.high) * k(250)
    return { hit: this.env, loud: this.loud, mid: this.mid, high: this.high }
  }

  reset() {
    this.env = 0
  }
}
