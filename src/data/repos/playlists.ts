import { all, batch, db } from '../db'

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
  /** Место в списке (внутри группы — среди плейлистов группы) */
  pos: number | null
  /** Группа — по её createdAt; null — вне групп */
  groupAt: number | null
  /** Место среди закреплённых; null — не закреплён */
  pinPos: number | null
}

export interface PlaylistGroupRow {
  id: number
  name: string
  pos: number | null
  createdAt: number
  updatedAt: number
}

export interface PlaylistItemRow {
  id: number
  trackKey: string
  pos: number
  transition: string | null
  /** Когда трек добавлен в плейлист */
  addedAt: number
}

/**
 * Список плейлистов. Число треков — только тех, что есть в медиатеке этого устройства: трек без файла
 * в плейлисте не показывается, значит, и в длину не входит. Сама строка при этом остаётся — на другом
 * устройстве этот трек может быть (плейлисты общие)
 */
export async function listPlaylists(): Promise<PlaylistRow[]> {
  const [rows, present] = await Promise.all([listPlaylistRows(), presentCounts()])
  return rows.map((r) => ({ ...r, count: present.get(r.id) ?? 0 }))
}

async function presentCounts(): Promise<Map<number, number>> {
  const rows = await all<{ id: number; n: number }>(
    `SELECT i.playlist_id AS id, COUNT(*) AS n
     FROM playlist_items i JOIN tracks t ON t.key = i.track_key
     WHERE t.missing_since IS NULL AND t.key NOT IN (SELECT key FROM dismissed WHERE kind = 'hidden')
     GROUP BY i.playlist_id`,
  )
  return new Map(rows.map((r) => [r.id, Number(r.n)]))
}

async function listPlaylistRows(): Promise<Omit<PlaylistRow, 'count'>[]> {
  return db
    .selectFrom('playlists as p')
    .select([
      'p.id',
      'p.name',
      'p.kind',
      'p.rules',
      'p.note',
      'p.cover',
      'p.createdAt',
      'p.updatedAt',
      'p.pos',
      'p.groupAt',
      'p.pinPos',
    ])
    .orderBy('p.pos')
    .orderBy('p.updatedAt', 'desc')
    .execute()
}

export async function createPlaylist(
  name: string,
  kind: PlaylistRow['kind'] = 'manual',
  rules: string | null = null,
): Promise<number> {
  const now = Date.now()
  // Новый — первым в списке вне групп
  const top = await db
    .selectFrom('playlists')
    .select(({ fn }) => fn.min('pos').as('p'))
    .executeTakeFirst()
  const groupsTop = await db
    .selectFrom('playlistGroups')
    .select(({ fn }) => fn.min('pos').as('p'))
    .executeTakeFirst()
  const first = Math.min(Number(top?.p ?? 0), Number(groupsTop?.p ?? 0))
  const r = await db
    .insertInto('playlists')
    .values({
      name,
      kind,
      rules,
      sort: null,
      cover: null,
      note: null,
      createdAt: now,
      updatedAt: now,
      pos: first - 1,
      groupAt: null,
      pinPos: null,
    })
    .executeTakeFirst()
  return Number(r.insertId)
}

/** Куда положить плейлист: группа (null — вне групп), место в ней и место среди закреплённых */
export async function placePlaylist(id: number, place: { groupAt: number | null; pos: number; pinPos: number | null }) {
  await db
    .updateTable('playlists')
    .set({ groupAt: place.groupAt, pos: place.pos, pinPos: place.pinPos, updatedAt: Date.now() })
    .where('id', '=', id)
    .execute()
}

/* ------------------------------ группы ------------------------------ */

export function listGroups(): Promise<PlaylistGroupRow[]> {
  return db
    .selectFrom('playlistGroups')
    .select(['id', 'name', 'pos', 'createdAt', 'updatedAt'])
    .orderBy('pos')
    .orderBy('createdAt')
    .execute()
}

export async function createGroup(name: string, pos: number): Promise<number> {
  const now = Date.now()
  await db.insertInto('playlistGroups').values({ name, pos, createdAt: now, updatedAt: now }).execute()
  return now
}

export async function renameGroup(createdAt: number, name: string): Promise<void> {
  await db.updateTable('playlistGroups').set({ name, updatedAt: Date.now() }).where('createdAt', '=', createdAt).execute()
}

export async function moveGroup(createdAt: number, pos: number): Promise<void> {
  await db.updateTable('playlistGroups').set({ pos, updatedAt: Date.now() }).where('createdAt', '=', createdAt).execute()
}

/** Удалить группу: её плейлисты остаются и встают на её место в общем списке */
export async function deleteGroup(createdAt: number): Promise<void> {
  const g = await db.selectFrom('playlistGroups').select('pos').where('createdAt', '=', createdAt).executeTakeFirst()
  const inside = await db.selectFrom('playlists').select(['id', 'pos']).where('groupAt', '=', createdAt).orderBy('pos').execute()
  const base = g?.pos ?? 0
  const now = Date.now()
  await batch([
    ...inside.map((p, i) =>
      db
        .updateTable('playlists')
        .set({ groupAt: null, pos: base + (i + 1) / (inside.length + 1), updatedAt: now })
        .where('id', '=', p.id),
    ),
    db.deleteFrom('playlistGroups').where('createdAt', '=', createdAt),
  ])
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
    .select(['id', 'trackKey', 'pos', 'transition', 'addedAt'])
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

/** Трек удалили из приложения: из всех плейлистов он уходит совсем (и на других устройствах тоже) */
export async function removeKeysEverywhere(keys: readonly string[]): Promise<void> {
  if (keys.length)
    await db
      .deleteFrom('playlistItems')
      .where('trackKey', 'in', [...keys])
      .execute()
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
