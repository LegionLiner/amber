/**
 * Волна трека для плеера: 1000 столбиков 0..255.
 *
 * Раньше бралась пиковая громкость, поделённая на самый громкий пик. У громко сведённых треков пики почти
 * везде упираются в потолок — волна выходила ровной полосой. Теперь — средняя громкость (RMS) в децибелах,
 * растянутая по самому треку: от его тихой четверти до самого громкого места (не меньше 12 дБ, чтобы у тихих
 * ровных записей не раздувать шум). Так видно строение песни — вступление, проигрыш, припевы — у любого трека.
 *
 * Та же формула — в Kotlin (android/…/analysis/Analyzer.kt, waveFromMeanSquares): поменяешь здесь — поменяй и там,
 * и подними WAVE_VERSION, чтобы старые волны пересчитались.
 */
export const WAVE_VERSION = 2

/** meanSq — средний квадрат сигнала по кусочкам в 10 мс */
export function waveFromMeanSquares(meanSq: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(1000)
  const n = meanSq.length
  if (!n) return out
  const db = new Float64Array(1000)
  for (let i = 0; i < 1000; i++) {
    const from = Math.floor((i * n) / 1000)
    const to = Math.max(from + 1, Math.floor(((i + 1) * n) / 1000))
    let s = 0
    let c = 0
    for (let j = from; j < Math.min(to, n); j++) {
      s += meanSq[j]!
      c++
    }
    db[i] = 10 * Math.log10((c ? s / c : 0) + 1e-12)
  }
  const sorted = Float64Array.from(db).sort()
  const pct = (q: number) => sorted[Math.min(999, Math.floor(q * 1000))]!
  const hi = pct(0.995)
  const lo = Math.min(pct(0.25), hi - 12)
  for (let i = 0; i < 1000; i++) {
    const t = (db[i]! - lo) / (hi - lo)
    // Тише «тела» трека — плавно к почти пустому столбику (тишина, затухание)
    const v = t >= 0 ? 0.12 + 0.88 * Math.min(1, t) : Math.max(0.03, 0.12 + (0.09 * (db[i]! - lo)) / 20)
    out[i] = Math.round(v * 255)
  }
  return out
}
