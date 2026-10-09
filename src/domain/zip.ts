/**
 * Минимальное чтение ZIP: список файлов и распаковка нужных. Без библиотек — сжатие deflate
 * разжимает встроенный DecompressionStream (есть в WebView, Chrome, Electron и Node 18+).
 * Хватает для архивов-выгрузок вроде my_spotify_data.zip; ZIP64 и шифрование не поддерживаются.
 */

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

export function listZip(buf: ArrayBuffer): ZipEntry[] {
  const v = new DataView(buf)
  // Конец центрального каталога: в последних 22 байтах + до 64 КБ комментария
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Это не ZIP-архив')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  if (p === 0xffffffff || count === 0xffff) throw new Error('Архив слишком большой (ZIP64) — распакуй его и выбери JSON-файлы')
  const utf8 = new TextDecoder()
  const out: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== CENTRAL) throw new Error('Архив повреждён')
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    out.push({
      method: v.getUint16(p + 10, true),
      compressedSize: v.getUint32(p + 20, true),
      size: v.getUint32(p + 24, true),
      localOffset: v.getUint32(p + 42, true),
      name: utf8.decode(new Uint8Array(buf, p + 46, nameLen)),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

export async function readZipEntry(buf: ArrayBuffer, e: ZipEntry): Promise<Uint8Array> {
  const v = new DataView(buf)
  if (v.getUint32(e.localOffset, true) !== LOCAL) throw new Error('Архив повреждён')
  const start = e.localOffset + 30 + v.getUint16(e.localOffset + 26, true) + v.getUint16(e.localOffset + 28, true)
  const data = new Uint8Array(buf, start, e.compressedSize)
  if (e.method === 0) return data
  if (e.method !== 8) throw new Error(`Неизвестное сжатие в архиве: ${e.method}`)
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
