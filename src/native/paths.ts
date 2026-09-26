import { Capacitor } from '@capacitor/core'
import { webCoverUrl } from './web/web-covers'

/**
 * Пути к файлам приложения. Папку обложек сообщает движок при старте (getInfo).
 * Обложки лежат по три размера: <hash>_s.webp (160 px), _m (480 px), _l (1080 px).
 */
let coversDir = ''

export function setCoversDir(dir: string) {
  coversDir = dir.replace(/\/+$/, '')
}

export type CoverSize = 's' | 'm' | 'l'

/** Адрес для <img> внутри WebView */
export function coverSrc(art: string | null | undefined, size: CoverSize): string | null {
  if (!art) return null
  // В браузере обложки из своей папки лежат в IndexedDB, одного размера
  if (!coversDir) return webCoverUrl(art)
  return Capacitor.convertFileSrc(`file://${coversDir}/${art}_${size}.webp`)
}

/** file:// адрес для движка (уведомление, экран блокировки) */
export function coverFileUri(art: string | null | undefined, size: CoverSize = 'l'): string | undefined {
  if (!art || !coversDir) return undefined
  return `file://${coversDir}/${art}_${size}.webp`
}

export const isNative = Capacitor.isNativePlatform()
