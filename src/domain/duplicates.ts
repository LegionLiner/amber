import { normKey, stripJunk } from './names'
import type { Track } from './track'

/**
 * Дубли: один и тот же трек в разных файлах (из «Загрузок» и из альбома, 128 и 320 кбит/с).
 * Совпадают название и исполнитель без мусора и регистра, длительность отличается не больше чем на 3 секунды.
 * Живые версии и ремиксы отличаются названием, поэтому в дубли не попадают.
 */
export interface DuplicateGroup {
  id: string
  tracks: Track[]
  /** Лучший файл: выше битрейт, потом больше прослушиваний, потом раньше добавлен */
  best: Track
}

export function findDuplicates(tracks: Track[]): DuplicateGroup[] {
  const buckets = new Map<string, Track[]>()
  for (const t of tracks) {
    if (!t.title || !t.artist) continue
    const k = `${normKey(stripJunk(t.title))}|${normKey(t.artists[0] ?? t.artist)}`
    buckets.set(k, [...(buckets.get(k) ?? []), t])
  }
  const out: DuplicateGroup[] = []
  for (const list of buckets.values()) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.durationMs - b.durationMs)
    // Внутри корзины режем на кластеры по длительности
    let cluster: Track[] = [sorted[0]!]
    const flush = () => {
      if (cluster.length > 1) {
        const best = [...cluster].sort(
          (a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0) || b.plays - a.plays || a.addedAt - b.addedAt,
        )[0]!
        out.push({
          id: cluster
            .map((t) => t.key)
            .sort()
            .join('|'),
          tracks: cluster,
          best,
        })
      }
    }
    for (let i = 1; i < sorted.length; i++) {
      const t = sorted[i]!
      if (t.durationMs - cluster[cluster.length - 1]!.durationMs <= 3000) cluster.push(t)
      else {
        flush()
        cluster = [t]
      }
    }
    flush()
  }
  return out.sort((a, b) => b.tracks.length - a.tracks.length)
}
