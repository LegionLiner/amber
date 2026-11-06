// Запуск Gradle из npm-скриптов: node android/gradle.mjs <задачи…>
// npm на Windows запускает скрипты так, что «cd android && gradlew.bat» не находит gradlew, а без JAVA_HOME сборка
// молча падает. Здесь — gradlew из этой папки и JDK по умолчанию, если JAVA_HOME не задан.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const env = { ...process.env }
if (!env.JAVA_HOME) {
  const jdk = 'C:\\Program Files\\Java\\jdk-23'
  if (fs.existsSync(jdk)) env.JAVA_HOME = jdk
}
const win = process.platform === 'win32'
// Полный путь: cmd не всегда ищет программы в текущей папке (NoDefaultCurrentDirectoryInExePath)
const exe = path.join(here, win ? 'gradlew.bat' : 'gradlew')
const r = spawnSync(win ? `"${exe}"` : exe, process.argv.slice(2), { cwd: here, env, stdio: 'inherit', shell: win })
process.exit(r.status ?? 1)
