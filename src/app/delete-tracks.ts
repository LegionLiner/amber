import { MusicCore } from '@/native/music-core'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import type { Track } from '@/domain/track'

/**
 * Удалить файлы треков. На телефоне подтверждение показывает Android; отказ — не ошибка (вернётся 0).
 * История прослушиваний, оценки и дуэли остаются в базе (трек помечен пропавшим) — статистика
 * прошлого не ломается. Из очереди удалённые треки убираются, медиатека перечитывается.
 */
export async function deleteTracks(tracks: Track[]): Promise<number> {
  if (!tracks.length) return 0
  let deleted = 0
  try {
    const r = await MusicCore.deleteFiles({ items: tracks.map((t) => ({ key: t.key, uri: t.uri, path: t.path })) })
    deleted = r.deleted
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/cancel|отмен/i.test(msg)) return 0
    throw e
  }
  await usePlayer().removeKeys(new Set(tracks.map((t) => t.key)))
  await useLibrary().load()
  return deleted
}
