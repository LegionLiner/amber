import { posAt } from './order'

/**
 * Плейлисты деревом: закреплённые — сверху, своим порядком; ниже — группы и плейлисты вне групп
 * вперемешку, в одном общем порядке; в группе — её плейлисты. Закреплённый плейлист показывается
 * только среди закреплённых, но помнит свою группу: открепишь — вернётся туда.
 *
 * Перенос описывается «куда»: зона (закреплённые, общий список, группа) и сосед, перед которым или после
 * которого встать. Отсюда считается новое место — одно число между соседями (см. order.ts).
 */

export interface TreePlaylist {
  id: number
  pos: number | null
  groupAt: number | null
  pinPos: number | null
}

export interface TreeGroup {
  createdAt: number
  pos: number | null
}

export type RootNode<P extends TreePlaylist, G extends TreeGroup> =
  { type: 'group'; key: string; group: G; items: P[] } | { type: 'playlist'; key: string; p: P }

export interface Tree<P extends TreePlaylist, G extends TreeGroup> {
  pinned: P[]
  root: RootNode<P, G>[]
}

export const pKey = (id: number) => `p:${id}`
export const gKey = (createdAt: number) => `g:${createdAt}`

const byPos = (a: { pos: number | null }, b: { pos: number | null }) => (a.pos ?? 0) - (b.pos ?? 0)

export function buildTree<P extends TreePlaylist, G extends TreeGroup>(playlists: P[], groups: G[]): Tree<P, G> {
  const known = new Set(groups.map((g) => g.createdAt))
  const pinned = playlists.filter((p) => p.pinPos != null).sort((a, b) => a.pinPos! - b.pinPos!)
  const free = playlists.filter((p) => p.pinPos == null)
  const inGroup = new Map<number, P[]>()
  const loose: P[] = []
  for (const p of free) {
    // Группу могли удалить на другом устройстве: тогда плейлист просто вне групп
    if (p.groupAt != null && known.has(p.groupAt)) {
      const list = inGroup.get(p.groupAt) ?? []
      list.push(p)
      inGroup.set(p.groupAt, list)
    } else loose.push(p)
  }
  const root: RootNode<P, G>[] = [
    ...groups.map((g) => ({
      type: 'group' as const,
      key: gKey(g.createdAt),
      group: g,
      items: (inGroup.get(g.createdAt) ?? []).sort(byPos),
    })),
    ...loose.map((p) => ({ type: 'playlist' as const, key: pKey(p.id), p })),
  ]
  root.sort((a, b) => nodePos(a) - nodePos(b))
  return { pinned, root }
}

export function nodePos(n: RootNode<TreePlaylist, TreeGroup>): number {
  return (n.type === 'group' ? n.group.pos : n.p.pos) ?? 0
}

export type Zone = { zone: 'pinned' } | { zone: 'root' } | { zone: 'group'; groupAt: number }

/** Куда отпустили: зона и сосед (ключ p:/g:), перед или после него; без соседа — в конец зоны */
export type Drop = Zone & { ref?: string | null; side?: 'before' | 'after' }

export interface Place {
  groupAt: number | null
  pos: number
  pinPos: number | null
}

function indexIn(keys: string[], drop: Drop): number {
  const i = drop.ref ? keys.indexOf(drop.ref) : -1
  if (i < 0) return keys.length
  return drop.side === 'after' ? i + 1 : i
}

/** Новое место плейлиста после переноса */
export function placeFor<P extends TreePlaylist, G extends TreeGroup>(tree: Tree<P, G>, p: P, drop: Drop): Place {
  const self = pKey(p.id)
  if (drop.zone === 'pinned') {
    const list = tree.pinned.filter((x) => x.id !== p.id)
    const i = indexIn(
      list.map((x) => pKey(x.id)),
      drop,
    )
    return {
      groupAt: p.groupAt,
      pos: p.pos ?? 0,
      pinPos: posAt(
        list.map((x) => ({ pos: x.pinPos })),
        i,
      ),
    }
  }
  if (drop.zone === 'group') {
    const g = tree.root.find((n) => n.type === 'group' && n.group.createdAt === drop.groupAt)
    const list = g?.type === 'group' ? g.items.filter((x) => x.id !== p.id) : []
    const i = indexIn(
      list.map((x) => pKey(x.id)),
      drop,
    )
    return { groupAt: drop.groupAt, pos: posAt(list, i), pinPos: null }
  }
  const list = tree.root.filter((n) => n.key !== self)
  const i = indexIn(
    list.map((n) => n.key),
    drop,
  )
  return {
    groupAt: null,
    pos: posAt(
      list.map((n) => ({ pos: nodePos(n) })),
      i,
    ),
    pinPos: null,
  }
}

/** Новое место группы: группы живут только в общем списке */
export function groupPosFor<P extends TreePlaylist, G extends TreeGroup>(
  tree: Tree<P, G>,
  g: G,
  drop: { ref?: string | null; side?: 'before' | 'after' },
): number {
  const list = tree.root.filter((n) => n.key !== gKey(g.createdAt))
  const i = indexIn(
    list.map((n) => n.key),
    { zone: 'root', ...drop },
  )
  return posAt(
    list.map((n) => ({ pos: nodePos(n) })),
    i,
  )
}

/** Соседний элемент в той же зоне: для «Выше» / «Ниже» из меню (на телефоне перетаскивания нет) */
export function nudge<P extends TreePlaylist, G extends TreeGroup>(tree: Tree<P, G>, p: P, dir: -1 | 1): Place | null {
  const self = pKey(p.id)
  let zone: Zone
  let keys: string[]
  if (p.pinPos != null) {
    zone = { zone: 'pinned' }
    keys = tree.pinned.map((x) => pKey(x.id))
  } else {
    const g = tree.root.find((n) => n.type === 'group' && n.items.some((x) => x.id === p.id))
    if (g?.type === 'group') {
      zone = { zone: 'group', groupAt: g.group.createdAt }
      keys = g.items.map((x) => pKey(x.id))
    } else {
      zone = { zone: 'root' }
      keys = tree.root.map((n) => n.key)
    }
  }
  const i = keys.indexOf(self)
  const j = i + dir
  if (i < 0 || j < 0 || j >= keys.length) return null
  return placeFor(tree, p, { ...zone, ref: keys[j], side: dir < 0 ? 'before' : 'after' })
}
