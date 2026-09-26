import { db } from '../db'

/** Метки внутри трека: точка (или отрезок) с названием. Тип best — «лучший момент» для дуэлей и хайлайтов. */
export interface Bookmark {
  id: number
  trackKey: string
  positionMs: number
  endMs: number | null
  title: string
  kind: 'mark' | 'best'
  createdAt: number
}

export function bookmarksFor(trackKey: string): Promise<Bookmark[]> {
  return db
    .selectFrom('bookmarks')
    .select(['id', 'trackKey', 'positionMs', 'endMs', 'title', 'kind', 'createdAt'])
    .where('trackKey', '=', trackKey)
    .orderBy('positionMs')
    .execute()
}

export function allBookmarks(): Promise<Bookmark[]> {
  return db
    .selectFrom('bookmarks')
    .select(['id', 'trackKey', 'positionMs', 'endMs', 'title', 'kind', 'createdAt'])
    .orderBy('createdAt', 'desc')
    .execute()
}

export async function addBookmark(
  trackKey: string,
  positionMs: number,
  title: string,
  kind: 'mark' | 'best' = 'mark',
): Promise<number> {
  const r = await db
    .insertInto('bookmarks')
    .values({
      trackKey,
      positionMs: Math.round(positionMs),
      endMs: null,
      title,
      color: null,
      kind,
      note: null,
      createdAt: Date.now(),
    })
    .executeTakeFirst()
  return Number(r.insertId)
}

export async function renameBookmark(id: number, title: string): Promise<void> {
  await db.updateTable('bookmarks').set({ title }).where('id', '=', id).execute()
}

export async function setBookmarkKind(id: number, kind: 'mark' | 'best'): Promise<void> {
  await db.updateTable('bookmarks').set({ kind }).where('id', '=', id).execute()
}

export async function deleteBookmark(id: number): Promise<void> {
  await db.deleteFrom('bookmarks').where('id', '=', id).execute()
}
