import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  addToPlaylist,
  createGroup,
  createPlaylist,
  deleteGroup,
  deletePlaylist,
  listGroups,
  listPlaylists,
  moveGroup,
  placePlaylist,
  removeTrackFromPlaylist,
  renameGroup,
  renamePlaylist,
  setPlaylistCover,
  setPlaylistKind,
  type PlaylistGroupRow,
  type PlaylistRow,
} from '@/data/repos/playlists'
import { buildTree, groupPosFor, nodePos, nudge, placeFor, type Drop } from '@/domain/playlist-tree'
import { useSettings } from './settings'

export const usePlaylists = defineStore('playlists', () => {
  const list = ref<PlaylistRow[]>([])
  const groups = ref<PlaylistGroupRow[]>([])
  const loaded = ref(false)
  /** Растёт при любом изменении состава: открытые страницы плейлистов перечитывают треки */
  const version = ref(0)

  /** Закреплённые сверху; ниже группы и плейлисты вне групп в общем порядке */
  const tree = computed(() => buildTree(list.value, groups.value))

  async function refresh() {
    const [l, g] = await Promise.all([listPlaylists(), listGroups()])
    list.value = l
    groups.value = g
    loaded.value = true
    version.value++
  }

  async function create(
    name: string,
    keys: string[] = [],
    kind: PlaylistRow['kind'] = 'manual',
    rules: string | null = null,
  ): Promise<number> {
    const id = await createPlaylist(name.trim() || 'Новый плейлист', kind, rules)
    if (keys.length) await addToPlaylist(id, keys)
    await refresh()
    return id
  }

  async function add(id: number, keys: string[]): Promise<number> {
    const n = await addToPlaylist(id, keys)
    await refresh()
    return n
  }

  async function rename(id: number, name: string) {
    await renamePlaylist(id, name.trim())
    await refresh()
  }

  async function setKind(id: number, kind: 'manual' | 'mix') {
    await setPlaylistKind(id, kind)
    await refresh()
  }

  async function setCover(id: number, art: string | null) {
    await setPlaylistCover(id, art)
    await refresh()
  }

  async function remove(id: number) {
    await deletePlaylist(id)
    await refresh()
  }

  async function removeTrack(id: number, key: string) {
    await removeTrackFromPlaylist(id, key)
    await refresh()
  }

  /* ---------- порядок, группы, закрепление ---------- */

  /** Перенос плейлиста: в закреплённые, в общий список или в группу, рядом с соседом */
  async function place(p: PlaylistRow, drop: Drop) {
    await placePlaylist(p.id, placeFor(tree.value, p, drop))
    if (drop.zone === 'group') setCollapsed(drop.groupAt, false)
    await refresh()
  }

  async function placeGroup(g: PlaylistGroupRow, drop: { ref?: string | null; side?: 'before' | 'after' }) {
    await moveGroup(g.createdAt, groupPosFor(tree.value, g, drop))
    await refresh()
  }

  async function pin(p: PlaylistRow, on: boolean) {
    await place(p, on ? { zone: 'pinned' } : p.groupAt != null ? { zone: 'group', groupAt: p.groupAt } : { zone: 'root' })
  }

  /** В группу (в конец) или вон из групп (null — в конец общего списка) */
  async function moveToGroup(p: PlaylistRow, groupAt: number | null) {
    const pinned = p.pinPos
    const target = placeFor(tree.value, { ...p, pinPos: null }, groupAt == null ? { zone: 'root' } : { zone: 'group', groupAt })
    // Закреплённый остаётся закреплённым: меняется только группа, куда он вернётся
    await placePlaylist(p.id, { ...target, pinPos: pinned })
    await refresh()
  }

  async function shift(p: PlaylistRow, dir: -1 | 1) {
    const next = nudge(tree.value, p, dir)
    if (!next) return
    await placePlaylist(p.id, next)
    await refresh()
  }

  async function addGroup(name: string): Promise<number> {
    const first = tree.value.root[0]
    const createdAt = await createGroup(name.trim() || 'Новая группа', first ? nodePos(first) - 1 : 0)
    await refresh()
    return createdAt
  }

  async function renameGroupTo(createdAt: number, name: string) {
    await renameGroup(createdAt, name.trim())
    await refresh()
  }

  async function removeGroup(createdAt: number) {
    await deleteGroup(createdAt)
    setCollapsed(createdAt, false)
    await refresh()
  }

  /** Свёрнутые группы — своё у каждого устройства (в настройках, не в синхронизации) */
  function isCollapsed(createdAt: number) {
    return useSettings().s.collapsedGroups.includes(createdAt)
  }
  function setCollapsed(createdAt: number, on: boolean) {
    const s = useSettings().s
    const has = s.collapsedGroups.includes(createdAt)
    if (on && !has) s.collapsedGroups = [...s.collapsedGroups, createdAt]
    else if (!on && has) s.collapsedGroups = s.collapsedGroups.filter((x) => x !== createdAt)
  }

  return {
    list,
    groups,
    tree,
    loaded,
    version,
    refresh,
    create,
    add,
    rename,
    setKind,
    setCover,
    remove,
    removeTrack,
    place,
    placeGroup,
    pin,
    moveToGroup,
    shift,
    addGroup,
    renameGroupTo,
    removeGroup,
    isCollapsed,
    setCollapsed,
  }
})
