import { all, db } from '../db'
import { MusicCore } from '@/native/music-core'
import type { WriteTagsItem } from '@/native/types'
import type { TagOverrides, Track } from '@/domain/track'
import { upsertTrackUser } from './library'

/**
 * Правка тегов. Сначала пробуем записать в сами файлы (с разрешения Android): mp3 — ID3,
 * MP4/AAC — теги iTunes. Формат определяет движок по байтам, а не по расширению: у многих «.mp3»
 * внутри MP4, и ID3 такой файл ломает. Если записать нельзя, правка живёт в приложении поверх файла.
 * Записанное в файл из поверх-правок убирается: файл теперь сам знает правильное значение.
 */

export type TagEdit = Partial<Record<'title' | 'artist' | 'album' | 'genre', string>> & {
  year?: number | null
  trackNo?: number | null
  /** Новая обложка, base64 JPEG; в файл, а если формат не даёт — своей обложкой в приложении */
  picture?: string
}

export interface SaveTagsResult {
  written: number
  kept: number
  failed: { key: string; reason: string }[]
}

/** Форматы, в которые умеем писать теги (id3+mp4 — испорченный файл, запись его заодно чинит) */
const WRITABLE = new Set(['mpeg', 'mp4', 'id3+mp4'])

export async function saveTags(tracks: Track[], edits: Map<string, TagEdit>, toFiles: boolean): Promise<SaveTagsResult> {
  const res: SaveTagsResult = { written: 0, kept: 0, failed: [] }
  let writable = toFiles ? tracks.filter((t) => edits.has(t.key)) : []
  if (writable.length) {
    // Не спрашиваем разрешение на файлы, в которые писать всё равно нечем (FLAC, OGG, WAV)
    try {
      const { kinds } = await MusicCore.probeFormats({ uris: writable.map((t) => t.uri) })
      writable = writable.filter((_, i) => WRITABLE.has(kinds[i] ?? 'unknown'))
    } catch {
      /* старый движок без проверки формата: пусть решит сам */
    }
  }
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
        picture: e.picture,
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
    let customArt: string | null | undefined
    if (e.picture && !writtenKeys.has(t.key)) {
      try {
        customArt = (await MusicCore.saveCover({ data: e.picture })).art
      } catch {
        /* картинку не прочитали: оставим старую обложку */
      }
    }
    await upsertTrackUser(t.key, {
      overrides: Object.keys(ov).length ? JSON.stringify(ov) : null,
      ...(customArt ? { customArt } : {}),
    })
  }
  return res
}

/** Убрать все правки поверх файла */
export async function clearOverrides(keys: string[]): Promise<void> {
  for (const key of keys) await upsertTrackUser(key, { overrides: null, customArt: null })
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

/* ------------------------------ копии до записи ------------------------------ */

/** Для каких треков можно вернуть файл к состоянию до последней записи тегов */
export async function tagBackupKeys(): Promise<Set<string>> {
  try {
    return new Set((await MusicCore.tagBackups()).keys)
  } catch {
    return new Set()
  }
}

export async function restoreTagFiles(tracks: Track[]): Promise<number> {
  const r = await MusicCore.restoreTags({ items: tracks.map((t) => ({ key: t.key, uri: t.uri, path: t.path })) })
  return r.written
}
