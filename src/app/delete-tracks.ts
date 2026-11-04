import { MusicCore } from '@/native/music-core'
import { all } from '@/data/db'
import { removeKeysEverywhere } from '@/data/repos/playlists'
import { usePlaylists } from '@/stores/playlists'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import type { Track } from '@/domain/track'

/**
 * Удалить файлы треков. На телефоне подтверждение показывает Android; отказ — не ошибка (вернётся 0).
 * История прослушиваний, оценки и дуэли остаются в базе (трек помечен пропавшим) — статистика
 * прошлого не ломается. Из очереди и из плейлистов удалённые треки убираются, медиатека перечитывается.
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
  // Из плейлистов — только то, что действительно удалилось (на телефоне можно отказаться от части файлов)
  const keys = tracks.map((t) => t.key)
  const gone = await all<{ key: string }>(
    `SELECT key FROM tracks WHERE missing_since IS NOT NULL AND key IN (${keys.map(() => '?').join(',')})`,
    keys,
  )
  await removeKeysEverywhere(gone.map((g) => g.key))
  await useLibrary().load()
  await usePlaylists().refresh()
  return deleted
}
