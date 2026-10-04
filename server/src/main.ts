import { readFileSync } from 'node:fs'
import { buildApp } from './app.ts'
import { migrate, pgDb, pgliteDb } from './db.ts'

/**
 * Запуск сервера Amber: node src/main.ts (Node сам отбрасывает типы, сборка не нужна — поэтому в коде
 * только «стираемый» TypeScript, см. erasableSyntaxOnly). Настройки — переменные окружения (см. .env.example):
 *   DATABASE_URL   postgres://…            обязательно (pglite:./data — без Docker, для разработки)
 *   PORT           8080
 *   ALLOW_SIGNUP   true | false            можно ли заводить новые аккаунты
 *   SIGNUP_CODE    строка                  если задана — регистрация только с ней
 */
const url = process.env.DATABASE_URL
if (!url) {
  console.error('Не задан DATABASE_URL')
  process.exit(1)
}

const db = url.startsWith('pglite:') ? await pgliteDb(url.slice(7)) : pgDb(url)
// База в соседнем контейнере может подниматься дольше сервера: ждём её до минуты
for (let i = 0; ; i++) {
  try {
    await migrate(db)
    break
  } catch (e) {
    if (i >= 30 || String(e).includes('кодировке')) throw e
    console.log('База ещё не готова, жду…')
    await new Promise((r) => setTimeout(r, 2000))
  }
}

const app = await buildApp(db, {
  allowSignup: (process.env.ALLOW_SIGNUP ?? 'true') !== 'false',
  signupCode: process.env.SIGNUP_CODE || undefined,
  logger: true,
  version: (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version,
})

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) })

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    void app
      .close()
      .then(() => db.close())
      .then(() => process.exit(0))
  })
}
