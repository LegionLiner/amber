import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * Файл базы amber.sqlite на компьютере. Страница держит базу в памяти (sql.js) и присылает её целиком
 * после изменений; здесь она надёжно ложится на диск.
 *
 * - Запись во временный файл с fsync и только потом подмена. Без fsync Windows может запомнить
 *   переименование раньше содержимого, и после выключения из розетки на месте базы остаются нули —
 *   «file is not a database».
 * - Перед первой записью за запуск — копия .bak, но только если текущий файл похож на базу:
 *   битый файл не затирает хорошую копию.
 * - Ошибка одной записи не обрывает очередь: следующая запишет базу снова.
 * - Повреждённую базу страница откладывает (quarantine → amber.sqlite.broken-…) и берёт копию .bak.
 */

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1')

/** Начало файла как у базы SQLite: файл, забитый нулями, сюда не пройдёт */
export async function looksLikeDb(file: string): Promise<boolean> {
  try {
    const fh = await fsp.open(file, 'r')
    try {
      const head = Buffer.alloc(SQLITE_MAGIC.length)
      const { bytesRead } = await fh.read(head, 0, head.length, 0)
      return bytesRead === head.length && head.equals(SQLITE_MAGIC) && (await fh.stat()).size >= 512
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
}

/** Записать файл и дождаться, пока он реально ляжет на диск */
export async function writeDurable(file: string, data: Uint8Array): Promise<void> {
  const fh = await fsp.open(file, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
}

/** Подмена файла. На Windows его могут ненадолго держать антивирус или индексатор — пробуем ещё */
export async function replaceFile(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
      await new Promise((r) => setTimeout(r, 100 * (i + 1)))
    }
  }
}

export class DbFile {
  /** Последняя запись: перед выходом её дожидаемся */
  private writing: Promise<void> = Promise.resolve()
  private backedUp = false

  constructor(
    private readonly file: () => string,
    private readonly log: (...parts: unknown[]) => void = () => undefined,
  ) {}

  read = async (): Promise<Uint8Array | null> => {
    try {
      return new Uint8Array(await fsp.readFile(this.file()))
    } catch {
      return null
    }
  }

  write = (bytes: Uint8Array): Promise<void> => {
    const next = this.writing
      .catch(() => undefined)
      .then(async () => {
        const file = this.file()
        if (!this.backedUp) {
          this.backedUp = true
          if (await looksLikeDb(file)) {
            await writeDurable(`${file}.bak.tmp`, await fsp.readFile(file))
            await replaceFile(`${file}.bak.tmp`, `${file}.bak`)
          }
        }
        await writeDurable(`${file}.tmp`, bytes)
        await replaceFile(`${file}.tmp`, file)
      })
    next.catch((e) => this.log('db:write failed', String(e)))
    this.writing = next
    return next
  }

  /** Дождаться последней записи (ошибки уже записаны в журнал) */
  settled(): Promise<void> {
    return this.writing.catch(() => undefined)
  }

  /** Копия с прошлого запуска (amber.sqlite.bak), если она похожа на базу */
  readBackup = async (): Promise<{ data: Uint8Array; at: number } | null> => {
    const bak = `${this.file()}.bak`
    if (!(await looksLikeDb(bak))) return null
    const [data, st] = await Promise.all([fsp.readFile(bak), fsp.stat(bak)])
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), at: Math.round(st.mtimeMs) }
  }

  /** Повреждённая база — в сторону (amber.sqlite.broken-…): не удаляем, но и в копию .bak она не попадёт */
  quarantine = async (): Promise<string | null> => {
    const file = this.file()
    if (!fs.existsSync(file)) return null
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const target = `${file}.broken-${stamp}`
    await replaceFile(file, target)
    this.log('db: повреждённая база отложена как', target)
    return path.basename(target)
  }
}
