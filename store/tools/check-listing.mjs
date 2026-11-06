// Длины текстов для Google Play: node store/tools/check-listing.mjs
import fs from 'node:fs'
const md = fs.readFileSync(new URL('../listing.md', import.meta.url), 'utf8')
const LIMIT = { 'Название': 30, Title: 30, 'Краткое': 80, Short: 80, 'Полное': 4000, Full: 4000 }
for (const block of md.split(/^### /m).slice(1)) {
  const [head, ...rest] = block.split('\n')
  const text = rest.join('\n').split(/^## /m)[0].trim()
  const key = Object.keys(LIMIT).find((k) => head.startsWith(k))
  if (!key) continue
  const n = [...text].length
  console.log(`${n <= LIMIT[key] ? 'ok ' : 'МНОГО'} ${String(n).padStart(4)} / ${LIMIT[key]}  ${head}`)
}
