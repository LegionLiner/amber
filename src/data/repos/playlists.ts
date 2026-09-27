import { batch, db } from '../db'

/**
 * Плейлисты. Порядок треков — дробный индекс pos: чтобы вставить трек между
 * соседями с pos 1 и 2, ему дают 1.5, и перенумеровывать весь список не нужно.
 */

export interface PlaylistRow {
  id: number
  name: string
  kind: 'manual' | 'smart' | 'mix'
  rules: string | null
  note: string | null
  /** Своя обложка (ключ в папке обложек), только в приложении */
  cover: string | null
  createdAt: number
  updatedAt: number
  count: number
}

export interface PlaylistItemRow {
  id: number
  trackKey: string
  pos: number
  transition: string | null
}

export async function listPlaylists(): Promise<PlaylistRow[]> {
  const rows = await db
    .selectFrom('playlists as p')
    .leftJoin('playlistItems as i', 'i.playlistId', 'p.id')
    .select(({ fn }) => [
      'p.id',
      'p.name',
      'p.kind',
      'p.rules',
      'p.note',
      'p.cover',
      'p.createdAt',
      'p.updatedAt',
      fn.count<number>('i.id').as('count'),
    ])
    .groupBy('p.id')
    .orderBy('p.updatedAt', 'desc')
    .execute()
  return rows.map((r) => ({ ...r, count: Number(r.count) }))
}

export async function createPlaylist(
  name: string,
  kind: PlaylistRow['kind'] = 'manual',
  rules: string | null = null,
): Promise<number> {
  const now = Date.now()
  const r = await db
    .insertInto('playlists')
    .values({ name, kind, rules, sort: null, cover: null, note: null, createdAt: now, updatedAt: now })
    .executeTakeFirst()
  return Number(r.insertId)
}

export async function renamePlaylist(id: number, name: string): Promise<void> {
  await db.updateTable('playlists').set({ name, updatedAt: Date.now() }).where('id', '=', id).execute()
}

/** Микс ↔ обычный плейлист: переходы остаются у треков и снова работают, если вернуть микс */
export async function setPlaylistKind(id: number, kind: 'manual' | 'mix'): Promise<void> {
  await db.updateTable('playlists').set({ kind, updatedAt: Date.now() }).where('id', '=', id).execute()
}

export async function setPlaylistCover(id: number, cover: string | null): Promise<void> {
  await db.updateTable('playlists').set({ cover, updatedAt: Date.now() }).where('id', '=', id).execute()
}

export async function deletePlaylist(id: number): Promise<void> {
  await batch([db.deleteFrom('playlistItems').where('playlistId', '=', id), db.deleteFrom('playlists').where('id', '=', id)])
}

export function playlistItems(id: number): Promise<PlaylistItemRow[]> {
  return db
    .selectFrom('playlistItems')
    .select(['id', 'trackKey', 'pos', 'transition'])
    .where('playlistId', '=', id)
    .orderBy('pos')
    .execute()
}

/** Добавляет треки в конец. Возвращает сколько добавлено (уже имеющиеся не дублируются) */
export async function addToPlaylist(id: number, keys: string[]): Promise<number> {
  const existing = await playlistItems(id)
  const have = new Set(existing.map((i) => i.trackKey))
  let pos = existing.length ? existing[existing.length - 1]!.pos : 0
  const now = Date.now()
  const fresh = keys.filter((k, i) => !have.has(k) && keys.indexOf(k) === i)
  if (!fresh.length) return 0
  await batch([
    ...fresh.map((trackKey) =>
      db.insertInto('playlistItems').values({ playlistId: id, trackKey, pos: ++pos, transition: null, addedAt: now }),
    ),
    db.updateTable('playlists').set({ updatedAt: now }).where('id', '=', id),
  ])
  return fresh.length
}

/** В каких плейлистах уже есть эти треки: id плейлиста → сколько из них там лежит */
export async function playlistsContaining(keys: string[]): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  const uniq = [...new Set(keys)]
  // Кусками: у SQLite ограничено число параметров в одном запросе
  for (let i = 0; i < uniq.length; i += 500) {
    const rows = await db
      .selectFrom('playlistItems')
      .select(({ fn }) => ['playlistId', fn.count<number>('trackKey').distinct().as('n')])
      .where('trackKey', 'in', uniq.slice(i, i + 500))
      .groupBy('playlistId')
      .execute()
    for (const r of rows) out.set(r.playlistId, (out.get(r.playlistId) ?? 0) + Number(r.n))
  }
  return out
}

export async function removeTrackFromPlaylist(playlistId: number, trackKey: string): Promise<void> {
  await db.deleteFrom('playlistItems').where('playlistId', '=', playlistId).where('trackKey', '=', trackKey).execute()
}

export async function removeFromPlaylist(itemId: number): Promise<void> {
  await db.deleteFrom('playlistItems').where('id', '=', itemId).execute()
}

/** Переставляет элемент между соседями: новый pos = середина между ними */
export async function moveInPlaylist(itemId: number, before: number | null, after: number | null): Promise<void> {
  let pos: number
  if (before != null && after != null) pos = (before + after) / 2
  else if (before != null) pos = before + 1
  else if (after != null) pos = after - 1
  else pos = 1
  await db.updateTable('playlistItems').set({ pos }).where('id', '=', itemId).execute()
}

export async function saveRules(id: number, rules: string): Promise<void> {
  await db.updateTable('playlists').set({ rules, updatedAt: Date.now() }).where('id', '=', id).execute()
}

/** Переход, с которым трек входит в миксе (null — по общим настройкам) */
export async function setItemTransition(itemId: number, transition: string | null): Promise<void> {
  await db.updateTable('playlistItems').set({ transition }).where('id', '=', itemId).execute()
}

/** Порядок целиком: после перетаскивания проще перенумеровать, чем искать середину */
export async function reorderPlaylist(playlistId: number, itemIds: number[]): Promise<void> {
  const now = Date.now()
  await batch([
    ...itemIds.map((id, i) =>
      db
        .updateTable('playlistItems')
        .set({ pos: i + 1 })
        .where('id', '=', id),
    ),
    db.updateTable('playlists').set({ updatedAt: now }).where('id', '=', playlistId),
  ])
}
