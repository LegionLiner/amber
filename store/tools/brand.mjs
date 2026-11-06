// Растровые значки приложения из знака «A-волна» (store/src/logos.html, #e-monogram):
//  desktop/icon.png — Windows (электрон-сборщик делает из него .ico), скруглённый квадрат 512;
//  android mipmap-*/ic_launcher*.png — запасные растровые значки (основной — векторный, drawable/ic_launcher_fg.xml).
// Значок для Google Play — store/icon/e-monogram.png (node store/tools/render.mjs).
// node store/tools/brand.mjs
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toRGBA } from './render.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const DEFS = `<defs>
  <linearGradient id="e-amb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".5" stop-color="#ffb23e"/><stop offset="1" stop-color="#e8681e"/></linearGradient>
  <radialGradient id="e-glow" cx="50%" cy="55%" r="50%"><stop offset="0" stop-color="#ff9f3a" stop-opacity=".3"/><stop offset="1" stop-color="#ff9f3a" stop-opacity="0"/></radialGradient>
</defs>`
const MARK = `<path d="M128 412 L256 104 L384 412" fill="none" stroke="url(#e-amb)" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="166,318 200,318 220,284 244,346 268,272 290,336 310,318 346,318" fill="none" stroke="#fff3df" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`
const BG = `<rect width="512" height="512" fill="#0e0d0c"/><circle cx="256" cy="280" r="230" fill="url(#e-glow)"/>`

/** Значок в форме: square — скруглённый квадрат с полями (Windows), legacy — квадрат на всю площадь, round — круг, fg — только знак в сетке адаптивного значка */
function svg(kind) {
  if (kind === 'fg') {
    // как в ic_launcher_fg.xml: сетка 108, знак масштабом 0.125 со сдвигом (22, 21.75)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">${DEFS}<g transform="translate(22 21.75) scale(.125)">${MARK}</g></svg>`
  }
  const clip =
    kind === 'round' ? '<clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath>' : kind === 'square' ? '<clipPath id="c"><rect x="16" y="16" width="480" height="480" rx="108"/></clipPath>' : '<clipPath id="c"><rect width="512" height="512" rx="72"/></clipPath>'
  const inner = kind === 'square' ? `${BG}<g transform="translate(256 258) scale(.88) translate(-256 -258)">${MARK}</g>` : `${BG}${MARK}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${DEFS}<defs>${clip}</defs><g clip-path="url(#c)">${inner}</g></svg>`
}

const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const p = await b.newPage()
async function render(kind, size, file) {
  await p.setViewport({ width: size, height: size, deviceScaleFactor: 1 })
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(kind)}`)
  const png = await (await p.$('svg')).screenshot({ omitBackground: true })
  fs.writeFileSync(file, toRGBA(Buffer.from(png)))
  console.log(path.relative(root, file), `${size}×${size}`)
}

await render('square', 512, path.join(root, 'desktop/icon.png'))
const res = path.join(root, 'android/app/src/main/res')
for (const [dpi, s] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  await render('legacy', s, path.join(res, `mipmap-${dpi}/ic_launcher.png`))
  await render('round', s, path.join(res, `mipmap-${dpi}/ic_launcher_round.png`))
  await render('fg', Math.round((s * 108) / 48), path.join(res, `mipmap-${dpi}/ic_launcher_foreground.png`))
}
await b.close()
