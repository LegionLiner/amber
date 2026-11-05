import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { tr } from './lang'

/**
 * Модель распознавания речи для голосовых команд — офлайн, маленькая модель Vosk на язык команд
 * (русская ~45 МБ, английская ~40 МБ). Скачивается один раз, когда голосом начинают пользоваться на этом языке,
 * и хранится в папке данных приложения.
 * Распознаватель на странице (vosk-browser) ждёт архив tar.gz с папкой model/ внутри: модель приходит
 * zip-архивом, поэтому распаковываем и упаковываем заново системным tar.exe (он есть в Windows 10 и 11).
 */
export type VoiceLang = 'ru' | 'en'

const MODELS: Record<VoiceLang, { url: string; file: string }> = {
  ru: { url: 'https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip', file: 'model-ru-small.tar.gz' },
  en: { url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip', file: 'model-en-small.tar.gz' },
}

/** Готовый архив модели языка */
export function voiceModelFile(userData: string, lang: VoiceLang): string {
  return path.join(userData, 'voice', MODELS[lang].file)
}

export interface VoiceProgress {
  stage: 'download' | 'unpack'
  done: number
  total: number
}

const tarExe = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

function tar(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(tarExe(), args, { cwd, windowsHide: true })
    let err = ''
    p.stderr.on('data', (d: Buffer) => (err += d.toString()))
    p.on('error', reject)
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(err.trim() || tr(`tar завершился с кодом ${code}`, `tar exited with code ${code}`))),
    )
  })
}

const pending = new Map<VoiceLang, Promise<string>>()

/** Путь к готовому архиву модели языка; при первом вызове — скачать и подготовить */
export function voiceModelPath(userData: string, lang: VoiceLang, progress: (p: VoiceProgress) => void): Promise<string> {
  let p = pending.get(lang)
  if (!p) {
    p = prepare(userData, lang, progress).finally(() => pending.delete(lang))
    pending.set(lang, p)
  }
  return p
}

async function prepare(userData: string, lang: VoiceLang, progress: (p: VoiceProgress) => void): Promise<string> {
  const dir = path.join(userData, 'voice')
  const file = voiceModelFile(userData, lang)
  if (fs.existsSync(file)) return file
  await fsp.mkdir(dir, { recursive: true })

  const zip = path.join(dir, `model-${lang}.zip`)
  if (!fs.existsSync(zip)) {
    const res = await fetch(MODELS[lang].url)
    if (!res.ok || !res.body)
      throw new Error(tr(`Не удалось скачать модель речи (${res.status})`, `Couldn't download the speech model (${res.status})`))
    const total = Number(res.headers.get('content-length') ?? 0)
    const tmp = `${zip}.part`
    const out = fs.createWriteStream(tmp)
    let done = 0
    let last = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      out.write(chunk)
      done += chunk.length
      if (done - last > 256 * 1024 || done === total) {
        last = done
        progress({ stage: 'download', done, total })
      }
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())))
    await fsp.rename(tmp, zip)
  }

  progress({ stage: 'unpack', done: 0, total: 0 })
  const work = path.join(dir, `unpack-${lang}`)
  await fsp.rm(work, { recursive: true, force: true })
  await fsp.mkdir(work, { recursive: true })
  await tar(['-xf', zip], work)
  const top = (await fsp.readdir(work)).find((n) => n.startsWith('vosk-model'))
  if (!top) throw new Error(tr('В архиве модели нет папки vosk-model', 'The model archive has no vosk-model folder'))
  await fsp.rename(path.join(work, top), path.join(work, 'model'))
  const tmpTar = `${file}.part`
  await tar(['-czf', tmpTar, 'model'], work)
  await fsp.rename(tmpTar, file)
  await fsp.rm(work, { recursive: true, force: true })
  await fsp.rm(zip, { force: true })
  return file
}
