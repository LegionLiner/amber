import { describe, expect, it } from 'vitest'
import { between, posAt } from '@/domain/order'
import { buildTree, gKey, groupPosFor, nudge, pKey, placeFor, type TreeGroup, type TreePlaylist } from '@/domain/playlist-tree'

const P = (id: number, pos: number, groupAt: number | null = null, pinPos: number | null = null): TreePlaylist => ({
  id,
  pos,
  groupAt,
  pinPos,
})
const G = (createdAt: number, pos: number): TreeGroup => ({ createdAt, pos })

/** Порядок в дереве строкой: «*1 *2 | g100[3 4] 5» */
function show(playlists: TreePlaylist[], groups: TreeGroup[]): string {
  const t = buildTree(playlists, groups)
  const root = t.root.map((n) =>
    n.type === 'group' ? `g${n.group.createdAt}[${n.items.map((p) => p.id).join(' ')}]` : String(n.p.id),
  )
  return `${t.pinned.map((p) => `*${p.id}`).join(' ')} | ${root.join(' ')}`
}

/** Применить перенос и вернуть новый список */
function apply(list: TreePlaylist[], groups: TreeGroup[], id: number, drop: Parameters<typeof placeFor>[2]) {
  const t = buildTree(list, groups)
  const p = list.find((x) => x.id === id)!
  const place = placeFor(t, p, drop)
  return list.map((x) => (x.id === id ? { ...x, ...place } : x))
}

describe('дробный порядок', () => {
  it('между соседями, в начало, в конец', () => {
    expect(between(1, 2)).toBe(1.5)
    expect(between(null, 2)).toBe(1)
    expect(between(3, null)).toBe(4)
    expect(between(null, null)).toBe(0)
    expect(posAt([{ pos: 0 }, { pos: 1 }], 1)).toBe(0.5)
    expect(posAt([{ pos: 0 }, { pos: 1 }], 2)).toBe(2)
  })
})

describe('дерево плейлистов', () => {
  const groups = [G(100, 1)]
  const list = [P(1, 0), P(2, 2), P(3, 0, 100), P(4, 1, 100), P(5, 5, null, 0)]

  it('закреплённые сверху, группы и плейлисты в общем порядке', () => {
    expect(show(list, groups)).toBe('*5 | 1 g100[3 4] 2')
  })

  it('плейлист из удалённой группы — просто вне групп', () => {
    expect(show([P(1, 0), P(3, 2, 999)], [])).toBe(' | 1 3')
  })

  it('перетаскивание между плейлистами, в группу и из неё', () => {
    let l = apply(list, groups, 2, { zone: 'root', ref: pKey(1), side: 'before' })
    expect(show(l, groups)).toBe('*5 | 2 1 g100[3 4]')
    l = apply(l, groups, 1, { zone: 'group', groupAt: 100, ref: pKey(4), side: 'before' })
    expect(show(l, groups)).toBe('*5 | 2 g100[3 1 4]')
    l = apply(l, groups, 3, { zone: 'root' })
    expect(show(l, groups)).toBe('*5 | 2 g100[1 4] 3')
  })

  it('закрепить, переставить среди закреплённых, открепить обратно в свою группу', () => {
    let l = apply(list, groups, 4, { zone: 'pinned', ref: pKey(5), side: 'before' })
    expect(show(l, groups)).toBe('*4 *5 | 1 g100[3] 2')
    // Закреплённый помнит группу
    expect(l.find((p) => p.id === 4)!.groupAt).toBe(100)
    l = apply(l, groups, 4, { zone: 'pinned' })
    expect(show(l, groups)).toBe('*5 *4 | 1 g100[3] 2')
    l = apply(l, groups, 4, { zone: 'group', groupAt: 100 })
    expect(show(l, groups)).toBe('*5 | 1 g100[3 4] 2')
  })

  it('группа встаёт между плейлистами', () => {
    const t = buildTree(list, groups)
    const g = [G(100, groupPosFor(t, groups[0]!, { ref: pKey(2), side: 'after' }))]
    expect(show(list, g)).toBe('*5 | 1 2 g100[3 4]')
    const g2 = [G(100, groupPosFor(buildTree(list, g), g[0]!, { ref: pKey(1), side: 'before' }))]
    expect(show(list, g2)).toBe('*5 | g100[3 4] 1 2')
    expect(gKey(100)).toBe('g:100')
  })

  it('«Выше» и «Ниже» — внутри своей зоны, у краёв их нет', () => {
    const t = buildTree(list, groups)
    const p3 = list.find((p) => p.id === 3)!
    expect(nudge(t, p3, -1)).toBeNull()
    const down = nudge(t, p3, 1)!
    const l = list.map((x) => (x.id === 3 ? { ...x, ...down } : x))
    expect(show(l, groups)).toBe('*5 | 1 g100[4 3] 2')
    const up = nudge(
      t,
      list.find((p) => p.id === 2)!,
      -1,
    )!
    expect(
      show(
        list.map((x) => (x.id === 2 ? { ...x, ...up } : x)),
        groups,
      ),
    ).toBe('*5 | 1 2 g100[3 4]')
  })
})
