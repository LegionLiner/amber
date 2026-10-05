import { coverSrc } from '@/native/paths'
import { MusicCore } from '@/native/music-core'
import { blobToBase64 } from '@/app/pick-image'

/**
 * Обложки плейлистов для синхронизации. На сервер уходит не исходный файл, а квадрат до 640 px в JPEG:
 * так запись остаётся небольшой (сервер принимает до 256 КБ на запись), а на экране разницы не видно.
 */
const SIDE = 640

export async function readCoverImage(art: string): Promise<string | null> {
  const url = coverSrc(art, 'l')
  if (!url) return null
  const res = await fetch(url)
  if (!res.ok) return null
  const bmp = await createImageBitmap(await res.blob())
  try {
    const side = Math.min(bmp.width, bmp.height)
    const out = Math.min(SIDE, side)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = out
    canvas.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out)
    for (const q of [0.85, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q))
      if (blob && blob.size < 170_000) return blobToBase64(blob)
    }
    return null
  } finally {
    bmp.close()
  }
}

export async function saveCoverImage(image: string): Promise<string> {
  return (await MusicCore.saveCover({ data: image })).art
}
