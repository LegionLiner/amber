// Сайт: свежие сборки — в site/download под постоянными именами, версия и размеры — в version.json.
// Запуск: npm run site (после desktop:pack и сборки APK). Папку site/ целиком выкладываешь на amber.legionliner.ru.
// Ссылка на Google Play появится на сайте сама, когда в version.json будет поле play (AMBER_PLAY_URL=…).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const out = path.join(here, 'download')
fs.mkdirSync(out, { recursive: true })

// Установщик этой версии: в release/ или в подпапке release/build-… (если release/win-unpacked был занят)
function findExe() {
  const name = `Amber-Setup-${version}.exe`
  const direct = path.join(root, 'release', name)
  if (fs.existsSync(direct)) return direct
  for (const d of fs.readdirSync(path.join(root, 'release'), { withFileTypes: true })) {
    const p = path.join(root, 'release', d.name, name)
    if (d.isDirectory() && fs.existsSync(p)) return p
  }
  return null
}

const files = {
  exe: { from: findExe(), to: 'Amber-Setup.exe' },
  apk: { from: path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), to: 'Amber.apk' },
}
const info = { version, date: new Date().toISOString().slice(0, 10) }
for (const [k, f] of Object.entries(files)) {
  if (!f.from || !fs.existsSync(f.from)) {
    console.warn(`нет файла для ${k} (${f.from ?? `Amber-Setup-${version}.exe`}) — пропускаю`)
    continue
  }
  fs.copyFileSync(f.from, path.join(out, f.to))
  info[k] = { file: f.to, size: fs.statSync(f.from).size }
  console.log(`${k}: ${path.relative(root, f.from)} → site/download/${f.to}`)
}
if (process.env.AMBER_PLAY_URL) info.play = process.env.AMBER_PLAY_URL
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(info, null, 2))
console.log('site/download/version.json:', JSON.stringify(info))
