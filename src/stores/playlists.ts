import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  removeTrackFromPlaylist,
  renamePlaylist,
  type PlaylistRow,
} from '@/data/repos/playlists'

export const usePlaylists = defineStore('playlists', () => {
  const list = ref<PlaylistRow[]>([])
  const loaded = ref(false)
  /** Растёт при любом изменении состава: открытые страницы плейлистов перечитывают треки */
  const version = ref(0)

  async function refresh() {
    list.value = await listPlaylists()
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

  async function remove(id: number) {
    await deletePlaylist(id)
    await refresh()
  }

  async function removeTrack(id: number, key: string) {
    await removeTrackFromPlaylist(id, key)
    await refresh()
  }

  return { list, loaded, version, refresh, create, add, rename, remove, removeTrack }
})
