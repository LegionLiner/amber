import { audioLevels, type AudioLevels } from '@/native/web/audio-graph'

/**
 * Как музыка «дышит» — для подсветки в такт (фон окна на компьютере, режим «Сцена»).
 *
 * Удар — это бас заметно выше своего среднего за последнюю треть секунды: так вспышки видны и в тихих,
 * и в громких треках, а ровный гул не держит свечение на максимуме. Удар — сразу вверх, спад за ~0,2 с.
 * Полосы (низ, середина, верха) — где уровень сейчас между своим недавним минимумом и максимумом:
 * вступил голос или гитара — середина поднимается, затихли — опускается. Ровный звук держит спокойный уровень.
 * Всё считается по времени, а не по кадрам: в свёрнутом окне кадров меньше, а ритм тот же.
 */
export interface Beat {
  /** Удар баса, 0…1 — для подсветки окна (по шкале децибел, так она настроена) */
  hit: number
  /** Удар бочки по линейной громкости низа: не срабатывает от отголосков голоса и гитар, 0…1 */
  kick: number
  /** Общая громкость относительно недавнего максимума, 0…1 */
  loud: number
  /** Низ: бас и бочка, 0…1 */
  low: number
  /** Середина (голос, гитары, клавишные) и верха (тарелки, хэты), 0…1 */
  mid: number
  high: number
}

/** Одна полоса частот: быстро поднимается, плавно опускается — получается дыхание, а не мигание */
class Band {
  private peak = 0.05
  private floor = 0
  private out = 0
  constructor(
    private attack: number,
    private release: number,
  ) {}

  update(v: number, dt: number): number {
    const slow = 1 - Math.exp(-dt / 6000)
    this.peak = Math.max(v, this.peak + (v - this.peak) * slow)
    // Минимум подтягивается вдвое быстрее максимума: ровный звук за несколько секунд успокаивается
    this.floor = Math.min(v, this.floor + (v - this.floor) * (1 - Math.exp(-dt / 3000)))
    // Диапазон не уже 60% от максимума: ровный звук не раздувается до полного свечения
    const span = Math.max(this.peak - this.floor, 0.6 * this.peak)
    const swell = span > 0.02 ? Math.min(1, (v - this.floor) / span) : 0
    const target = 0.35 * Math.min(1, v / Math.max(0.03, this.peak)) + 0.65 * swell
    const tau = target > this.out ? this.attack : this.release
    this.out += (target - this.out) * (1 - Math.exp(-dt / tau))
    return this.out
  }
}

export class BeatFollower {
  private avg = 0
  private env = 0
  private lowAvg = 0
  private lowPeak = 0.05
  private kick = 0
  private loud = 0
  private loudPeak = 0.1
  private low = new Band(60, 350)
  private mid = new Band(150, 700)
  private high = new Band(40, 600)

  /** dt — миллисекунды с прошлого раза; l — уровни (null — звука нет: всё плавно гаснет) */
  update(dt: number, l: AudioLevels | null = audioLevels()): Beat {
    const bass = l?.bass ?? 0
    this.avg += (bass - this.avg) * (1 - Math.exp(-dt / 350))
    const hit = Math.min(1, Math.max(0, bass - this.avg) / Math.max(0.03, this.avg * 0.22))
    this.env = hit > this.env ? hit : this.env * Math.exp(-dt / 200)
    const low = l?.low ?? 0
    this.lowAvg += (low - this.lowAvg) * (1 - Math.exp(-dt / 350))
    // Порог — и от среднего, и от недавних настоящих ударов: после бочки отголосок голоса в басах ударом не считается
    this.lowPeak = Math.max(low, this.lowPeak * Math.exp(-dt / 15000), 0.05)
    const kick = Math.min(1, Math.max(0, low - this.lowAvg) / Math.max(0.04, this.lowAvg * 0.5, this.lowPeak * 0.3))
    this.kick = kick > this.kick ? kick : this.kick * Math.exp(-dt / 200)

    this.loudPeak = Math.max(l?.level ?? 0, this.loudPeak * Math.exp(-dt / 8000), 0.05)
    this.loud += (Math.min(1, (l?.level ?? 0) / this.loudPeak) - this.loud) * (1 - Math.exp(-dt / 300))
    return {
      hit: this.env,
      kick: this.kick,
      loud: this.loud,
      low: this.low.update(low, dt),
      mid: this.mid.update(l?.mid ?? 0, dt),
      high: this.high.update(l?.high ?? 0, dt),
    }
  }

  reset() {
    this.env = 0
    this.kick = 0
  }
}
