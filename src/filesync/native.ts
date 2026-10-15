import { MusicCore } from '@/native/music-core'
import type { FileEntry } from './plan'
import type { SyncIO } from './run'

/** SyncIO телефона: файлы и запросы к компьютеру делает движок (android/.../filesync/FileSync.kt) */
export function nativeIO(c: { base: string; token: string; root: string }, remote: FileEntry[]): SyncIO {
  const { base, token, root } = c
  return {
    listLocal: async () => (await MusicCore.fsLocalList({ root })).files,
    // Список компьютера уже получен (по нему проверялось, та ли это папка): второй раз не просим
    listRemote: async () => remote,
    hashLocal: async (p) => (await MusicCore.fsLocalHash({ root, p })).h,
    hashRemote: async (p) => (await MusicCore.fsRemoteHash({ base, token, p })).h,
    pull: (rp, lp, from, expect) => MusicCore.fsPull({ base, token, root, rp, lp, from, expect }),
    push: (lp, rp, from, expect) => MusicCore.fsPush({ base, token, root, lp, rp, from, expect }),
    trashLocal: async (p, expect) => (await MusicCore.fsLocalTrash({ root, p, expect })).result,
    trashRemote: async (p, expect) => (await MusicCore.fsRemoteTrash({ base, token, p, expect })).result,
  }
}
