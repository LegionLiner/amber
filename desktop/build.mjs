// Сборка приложения для компьютера: главный процесс и preload (TypeScript → CommonJS) плюс готовый интерфейс
// из dist/ в одну папку desktop/app, которую запускает Electron и упаковывает electron-builder.
import { build } from 'rolldown'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = path.join(here, 'app')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

for (const [entry, file] of [
  ['main.ts', 'main.cjs'],
  ['preload.ts', 'preload.cjs'],
]) {
  await build({
    input: path.join(here, entry),
    platform: 'node',
    external: ['electron', /^node:/],
    output: { file: path.join(out, file), format: 'cjs' },
    logLevel: 'warn',
  })
}

// Интерфейс: тот же, что в браузере и на телефоне (npm run build)
const dist = path.join(root, 'dist')
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('Нет dist/: сначала npm run build')
  process.exit(1)
}
fs.cpSync(dist, path.join(out, 'dist'), { recursive: true })
fs.copyFileSync(path.join(here, 'icon.png'), path.join(out, 'icon.png'))
fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    { name: 'amber', productName: 'Amber', version: pkg.version, main: 'main.cjs', author: 'Dmitry Korolev' },
    null,
    2,
  ),
)
console.log('desktop/app готов')
