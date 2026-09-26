import { all, db } from '../db'
import { MusicCore } from '@/native/music-core'
import type { WriteTagsItem } from '@/native/types'
import type { TagOverrides, Track } from '@/domain/track'
import { upsertTrackUser } from './library'

/**
 * Правка тегов. Сначала пробуем записать в сами файлы (mp3, с разрешения Android),
 * а если нельзя — правка живёт в приложении как «поверх файла» (track_user.overrides).
 * Записанное в файл из поверх-правок убирается: файл теперь сам знает правильное значение.
 */

export type TagEdit = Partial<Record<'title' | 'artist' | 'album' | 'genre', string>> & {
  year?: number | null
  trackNo?: number | null
}

export interface SaveTagsResult {
  written: number
  kept: number
  failed: { key: string; reason: string }[]
}

function isMp3(t: Track): boolean {
  return /\.mp3$/i.test(t.fileName) || t.mime === 'audio/mpeg'
}

export async function saveTags(tracks: Track[], edits: Map<string, TagEdit>, toFiles: boolean): Promise<SaveTagsResult> {
  const res: SaveTagsResult = { written: 0, kept: 0, failed: [] }
  const writable = toFiles ? tracks.filter((t) => isMp3(t) && edits.has(t.key)) : []
  const writtenKeys = new Set<string>()
  if (writable.length) {
    const items: WriteTagsItem[] = writable.map((t) => {
      const e = edits.get(t.key)!
      return {
        key: t.key,
        uri: t.uri,
        path: t.path,
        title: e.title,
        artist: e.artist,
        album: e.album,
        genre: e.genre,
        year: e.year ?? undefined,
        trackNo: e.trackNo ?? undefined,
      }
    })
    try {
      const r = await MusicCore.writeTags({ items })
      res.written = r.written
      const failed = new Set(r.failed.map((f) => f.key))
      for (const t of writable) if (!failed.has(t.key)) writtenKeys.add(t.key)
      res.failed = r.failed.filter((f) => f.key)
    } catch (e) {
      res.failed = writable.map((t) => ({ key: t.key, reason: e instanceof Error ? e.message : String(e) }))
    }
  }
  for (const t of tracks) {
    const e = edits.get(t.key)
    if (!e) continue
    const ov: TagOverrides = { ...t.overrides }
    for (const f of ['title', 'artist', 'album', 'genre'] as const) {
      if (e[f] === undefined) continue
      if (writtenKeys.has(t.key) || e[f] === (t.tags[f] ?? '')) delete ov[f]
      else ov[f] = e[f]
    }
    if (e.year !== undefined) {
      if (writtenKeys.has(t.key) || e.year == null) delete ov.year
      else ov.year = e.year
    }
    if (!writtenKeys.has(t.key)) res.kept++
    await upsertTrackUser(t.key, { overrides: Object.keys(ov).length ? JSON.stringify(ov) : null })
  }
  return res
}

/** Убрать все правки поверх файла */
export async function clearOverrides(keys: string[]): Promise<void> {
  for (const key of keys) await upsertTrackUser(key, { overrides: null })
}

/* ------------------------------ тексты ------------------------------ */

export async function savedLyrics(key: string): Promise<string | null> {
  const rows = await all<{ text: string }>(`SELECT text FROM lyrics WHERE key = ?`, [key])
  return rows[0]?.text ?? null
}

export async function saveLyrics(key: string, text: string | null): Promise<void> {
  if (!text?.trim()) {
    await db.deleteFrom('lyrics').where('key', '=', key).execute()
    return
  }
  const updatedAt = Date.now()
  await db
    .insertInto('lyrics')
    .values({ key, text, updatedAt })
    .onConflict((oc) => oc.column('key').doUpdateSet({ text, updatedAt }))
    .execute()
}

/* ------------------------------ отклонённые подсказки ------------------------------ */

export async function dismissedKeys(kind: string): Promise<Set<string>> {
  const rows = await all<{ key: string }>(`SELECT key FROM dismissed WHERE kind = ?`, [kind])
  return new Set(rows.map((r) => r.key))
}

export async function dismiss(kind: string, keys: string[]): Promise<void> {
  const at = Date.now()
  for (const key of keys) {
    await db
      .insertInto('dismissed')
      .values({ kind, key, at })
      .onConflict((oc) => oc.columns(['kind', 'key']).doNothing())
      .execute()
  }
}
