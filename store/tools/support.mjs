// Картинки 970×550 для ссылки на поддержку (store/src/support.html) → store/support/<id>.png
// node store/tools/support.mjs
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const store = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(store, 'support')
fs.mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const p = await b.newPage()
await p.setViewport({ width: 1100, height: 1300, deviceScaleFactor: 1 })
await p.goto('file:///' + path.join(store, 'src/support.html').split(path.sep).join('/'), { waitUntil: 'networkidle0' })
for (const id of await p.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.id))) {
  const file = path.join(out, `${id}.png`)
  await (await p.$(`#${id}`)).screenshot({ path: file })
  console.log(path.relative(store, file), `${Math.round(fs.statSync(file).size / 1024)} КБ`)
}
await b.close()
