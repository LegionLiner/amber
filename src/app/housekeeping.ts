import { archiveClosedWeeks, hasRankSnapshot, saveRankSnapshot } from '@/data/repos/charts'
import { sortTracks } from '@/domain/sort'
import { weekKey } from '@/domain/weeks'
import { useLibrary } from '@/stores/library'

/**
 * Раз в неделю (на деле — при каждом запуске, если есть что делать):
 * закрытые недели уходят в архив чартов, а места в рейтинге фиксируются снимком —
 * от него считаются стрелки ▲▼ до конца недели.
 */
export async function weeklyHousekeeping(): Promise<void> {
  await archiveClosedWeeks()
  const week = weekKey(new Date())
  if (!(await hasRankSnapshot(week))) {
    const ranked = sortTracks(
      useLibrary().tracks.filter((t) => t.rating != null),
      'rating',
      'desc',
    )
    await saveRankSnapshot(
      week,
      ranked.map((t) => t.key),
    )
  }
}
