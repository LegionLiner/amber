// Значки из store/src/logos.html: каждый <svg id> → store/icon/<id>.png 512×512.
// Google Play просит 32-битный PNG с альфа-каналом — поэтому omitBackground (фон у значков свой, непрозрачный).
// node store/tools/render.mjs
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

/** Непрозрачный PNG браузер пишет как RGB (24 бита). Перекладываем в RGBA с альфой 255 */
function toRGBA(png) {
  const chunks = []
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o)
    chunks.push({ type: png.toString('latin1', o + 4, o + 8), data: png.subarray(o + 8, o + 8 + len) })
    o += 12 + len
  }
  const ih = chunks.find((c) => c.type === 'IHDR').data
  const w = ih.readUInt32BE(0)
  const h = ih.readUInt32BE(4)
  if (ih[9] === 6) return png
  if (ih[8] !== 8 || ih[9] !== 2 || ih[12] !== 0) throw new Error('ожидался 8-битный RGB без чересстрочности')
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)))
  const bpp = 3
  const stride = w * bpp
  const px = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = px.subarray(y * stride, (y + 1) * stride)
    const up = y ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0
      const b = up[i]
      const c = i >= bpp ? up[i - bpp] : 0
      let v = src[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      row[i] = v & 255
    }
  }
  const out = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    const o = y * (w * 4 + 1)
    for (let x = 0; x < w; x++) {
      px.copy(out, o + 1 + x * 4, y * stride + x * 3, y * stride + x * 3 + 3)
      out[o + 1 + x * 4 + 3] = 255
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.from(ih)
  ihdr[9] = 6
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

export { toRGBA }
const store = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(store, 'icon')
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
async function main() {
fs.mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const p = await b.newPage()
await p.setViewport({ width: 1700, height: 1200, deviceScaleFactor: 1 })
await p.goto('file:///' + path.join(store, 'src/logos.html').split(path.sep).join('/'), { waitUntil: 'networkidle0' })
await p.evaluate(() => (document.body.style.background = 'transparent'))
const ids = await p.evaluate(() => [...document.querySelectorAll('svg[id]')].map((s) => s.id))
for (const id of ids) {
  const el = await p.$(`#${id}`)
  fs.writeFileSync(path.join(out, `${id}.png`), toRGBA(Buffer.from(await el.screenshot({ omitBackground: true }))))
  console.log(`icon/${id}.png`)
}
await b.close()
}
