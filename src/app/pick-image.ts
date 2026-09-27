/**
 * Выбор картинки для обложки: системный выбор файла, обрезка по центру в квадрат,
 * уменьшение до 1000 px и JPEG. Результат — base64 (для движка и тегов) и адрес для предпросмотра.
 */
export interface PickedImage {
  base64: string
  url: string
}

export function pickImage(maxPx = 1000): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        resolve(await squareJpeg(file, maxPx))
      } catch {
        resolve(null)
      }
    }
    input.click()
  })
}

async function squareJpeg(file: Blob, maxPx: number): Promise<PickedImage> {
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const out = Math.min(maxPx, side)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = out
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out)
  bmp.close()
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', 0.9),
  )
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { base64: btoa(bin), url: URL.createObjectURL(blob) }
}
