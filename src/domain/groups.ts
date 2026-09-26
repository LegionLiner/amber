import type { Track } from './track'
import { normKey } from './names'

export interface AlbumGroup {
  id: string
  title: string
  artist: string
  year: number | null
  art: string | null
  seed: string
  tracks: Track[]
  durationMs: number
  plays: number
}

export interface ArtistGroup {
  id: string
  name: string
  art: string | null
  tracks: Track[]
  plays: number
}

export interface GenreGroup {
  id: string
  name: string
  tracks: Track[]
}

export interface FolderNode {
  /** Относительный путь с завершающим «/», корень = '' */
  path: string
  name: string
  tracks: Track[]
  children: FolderNode[]
  /** Треков вместе с вложенными папками */
  total: number
}

export const albumIdOf = (t: Pick<Track, 'album' | 'albumArtist'>) => `${normKey(t.album)}|${normKey(t.albumArtist)}`
export const artistIdOf = (name: string) => normKey(name)

const byDiscTrack = (a: Track, b: Track) =>
  (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 9999) - (b.trackNo ?? 9999) || a.title.localeCompare(b.title, 'ru')

export function groupAlbums(tracks: Track[]): AlbumGroup[] {
  const map = new Map<string, AlbumGroup>()
  for (const t of tracks) {
    if (!t.album) continue
    const id = albumIdOf(t)
    let g = map.get(id)
    if (!g) {
      g = {
        id,
        title: t.album,
        artist: t.albumArtist,
        year: t.year,
        art: null,
        seed: t.album,
        tracks: [],
        durationMs: 0,
        plays: 0,
      }
      map.set(id, g)
    }
    g.tracks.push(t)
    g.durationMs += t.durationMs
    g.plays += t.plays
    if (!g.art && t.art) g.art = t.art
    if (!g.year && t.year) g.year = t.year
  }
  for (const g of map.values()) g.tracks.sort(byDiscTrack)
  return [...map.values()]
}

export function groupArtists(tracks: Track[]): ArtistGroup[] {
  const map = new Map<string, ArtistGroup>()
  for (const t of tracks) {
    for (const name of t.artists) {
      const id = normKey(name)
      if (!id) continue
      let g = map.get(id)
      if (!g) {
        g = { id, name, art: null, tracks: [], plays: 0 }
        map.set(id, g)
      }
      g.tracks.push(t)
      g.plays += t.plays
      if (!g.art && t.art) g.art = t.art
    }
  }
  return [...map.values()]
}

export function groupGenres(tracks: Track[]): GenreGroup[] {
  const map = new Map<string, GenreGroup>()
  for (const t of tracks) {
    for (const raw of t.genre.split(/[;/,]/)) {
      const name = raw.trim()
      const id = normKey(name)
      if (!id) continue
      let g = map.get(id)
      if (!g) {
        g = { id, name, tracks: [] }
        map.set(id, g)
      }
      g.tracks.push(t)
    }
  }
  return [...map.values()].sort((a, b) => b.tracks.length - a.tracks.length)
}

export function buildFolderTree(tracks: Track[]): FolderNode {
  const root: FolderNode = { path: '', name: 'Все папки', tracks: [], children: [], total: 0 }
  const index = new Map<string, FolderNode>([['', root]])
  const ensure = (path: string): FolderNode => {
    const found = index.get(path)
    if (found) return found
    const parts = path.split('/').filter(Boolean)
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : ''
    const parent = ensure(parentPath)
    const node: FolderNode = { path, name: parts[parts.length - 1] ?? path, tracks: [], children: [], total: 0 }
    parent.children.push(node)
    index.set(path, node)
    return node
  }
  for (const t of tracks) {
    const path = t.folder && !t.folder.endsWith('/') ? t.folder + '/' : t.folder
    ensure(path).tracks.push(t)
  }
  const count = (n: FolderNode): number => {
    n.total = n.tracks.length + n.children.reduce((s, c) => s + count(c), 0)
    n.children.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))
    n.tracks.sort(byDiscTrack)
    return n.total
  }
  count(root)
  return root
}

export function findFolder(root: FolderNode, path: string): FolderNode | null {
  if (root.path === path) return root
  for (const c of root.children) {
    if (path.startsWith(c.path)) {
      const f = findFolder(c, path)
      if (f) return f
    }
  }
  return null
}

export function allTracksIn(node: FolderNode): Track[] {
  const out: Track[] = [...node.tracks]
  for (const c of node.children) out.push(...allTracksIn(c))
  return out
}
