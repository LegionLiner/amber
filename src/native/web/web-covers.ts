/**
 * Обложки в веб-версии: картинки из тегов хранятся в IndexedDB (переживают перезагрузку),
 * а в интерфейс отдаются как blob-адреса.
 */
import { ref } from 'vue'

const urls = new Map<string, string>()
let loaded = false
/** Меняется, когда появились новые обложки: интерфейс перерисует картинки */
const version = ref(0)

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('yantar-web-covers', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('covers')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadCovers(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const d = await idb()
    await new Promise<void>((resolve) => {
      const req = d.transaction('covers', 'readonly').objectStore('covers').openCursor()
      req.onsuccess = () => {
        const c = req.result
        if (!c) return resolve()
        urls.set(String(c.key), URL.createObjectURL(c.value as Blob))
        c.continue()
      }
      req.onerror = () => resolve()
    })
    version.value++
  } catch {
    /* без IndexedDB обложки просто не сохранятся между запусками */
  }
}

export async function saveCover(hash: string, blob: Blob): Promise<void> {
  if (urls.has(hash)) return
  urls.set(hash, URL.createObjectURL(blob))
  version.value++
  try {
    const d = await idb()
    d.transaction('covers', 'readwrite').objectStore('covers').put(blob, hash)
  } catch {
    /* не критично */
  }
}

export function webCoverUrl(hash: string | null | undefined): string | null {
  void version.value
  return hash ? (urls.get(hash) ?? null) : null
}
