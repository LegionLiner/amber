import { mp3Frame, parseV1, parseV2, sha1Hex, tagSize, trackKey, type Id3Tags } from './id3'
import { mp4KeyFromFile, readMoov, readMoovFromFile, sniff, type AudioKind } from './mp4'

/**
 * Папка с настоящими mp3 в браузере (веб-версия и Docker).
 * Chrome и Edge дают выбрать папку (showDirectoryPicker) и помнят её между запусками;
 * в остальных браузерах работает выбор папки через <input webkitdirectory>.
 */

export interface LocalEntry {
  file: File
  relPath: string
}

export interface LocalTrack {
  key: string
  path: string
  folder: string
  fileName: string
  size: number
  mtime: number
  mime: string
  durationMs: number
  bitrate: number | null
  sampleRate: number | null
  tags: Id3Tags
  art: { hash: string; blob: Blob } | null
  /** Что внутри на самом деле: у многих «.mp3» — MP4/AAC */
  kind: AudioKind
  /** Отпечаток по старому расчёту, если он отличается (для переноса истории) */
  legacyKey?: string
}

const AUDIO = /\.(mp3|flac|m4a|aac|ogg|opus|wav)$/i

export type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterable<[string, FileSystemHandle]>
  queryPermission?(o: { mode: string }): Promise<string>
  requestPermission?(o: { mode: string }): Promise<string>
}

async function walk(dir: DirHandle, prefix: string, out: LocalEntry[]) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') await walk(handle as DirHandle, `${prefix}${name}/`, out)
    else if (AUDIO.test(name)) out.push({ file: await (handle as FileSystemFileHandle).getFile(), relPath: `${prefix}${name}` })
  }
}

export function canPickDirectory(): boolean {
  return 'showDirectoryPicker' in window
}

/** Выбор папки. Возвращает файлы и, если браузер умеет, «ручку» папки для следующих запусков */
export async function pickFolder(): Promise<{ entries: LocalEntry[]; handle: DirHandle | null }> {
  if (canPickDirectory()) {
    const handle = (await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({
      mode: 'read',
    })) as DirHandle
    const entries: LocalEntry[] = []
    await walk(handle, `${handle.name}/`, entries)
    return { entries, handle }
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.setAttribute('webkitdirectory', '')
  const files = await new Promise<File[]>((resolve) => {
    input.onchange = () => resolve([...(input.files ?? [])])
    input.click()
  })
  return {
    entries: files.filter((f) => AUDIO.test(f.name)).map((f) => ({ file: f, relPath: f.webkitRelativePath || f.name })),
    handle: null,
  }
}

/** Повторно открыть сохранённую папку (нужно нажатие пользователя, если браузер спросит разрешение) */
export async function reopenFolder(handle: DirHandle, mode: 'read' | 'readwrite' = 'read'): Promise<LocalEntry[] | null> {
  let perm = (await handle.queryPermission?.({ mode })) ?? 'granted'
  if (perm !== 'granted') perm = (await handle.requestPermission?.({ mode })) ?? 'denied'
  if (perm !== 'granted') return null
  const entries: LocalEntry[] = []
  await walk(handle, `${handle.name}/`, entries)
  return entries
}

/** Длительность mp3 по заголовку Xing/Info (VBR) или по битрейту (CBR) */
function mp3Duration(sample: Uint8Array, audioBytes: number): { ms: number; sampleRate: number; bitrate: number } | null {
  const fr = mp3Frame(sample)
  if (!fr) return null
  for (let i = 0; i + 4 <= Math.min(sample.length, 4096); i++) {
    if (sample[i] !== 0xff || (sample[i + 1]! & 0xe0) !== 0xe0) continue
    const version = (sample[i + 1]! >> 3) & 3
    const mono = ((sample[i + 3]! >> 6) & 3) === 3
    const side = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17
    const x = i + 4 + side
    const tag = String.fromCharCode(...sample.subarray(x, x + 4))
    if (tag === 'Xing' || tag === 'Info') {
      const flags = (sample[x + 4]! << 24) | (sample[x + 5]! << 16) | (sample[x + 6]! << 8) | sample[x + 7]!
      if (flags & 1) {
        const frames = ((sample[x + 8]! << 24) | (sample[x + 9]! << 16) | (sample[x + 10]! << 8) | sample[x + 11]!) >>> 0
        const spf = version === 3 ? 1152 : 576
        return { ms: Math.round(((frames * spf) / fr.sampleRate) * 1000), sampleRate: fr.sampleRate, bitrate: fr.bitrate }
      }
    }
    break
  }
  return { ms: Math.round(((audioBytes * 8) / fr.bitrate) * 1000), sampleRate: fr.sampleRate, bitrate: fr.bitrate }
}

function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const a = new Audio()
    const done = (ms: number) => {
      URL.revokeObjectURL(url)
      resolve(ms)
    }
    const t = setTimeout(() => done(0), 6000)
    a.preload = 'metadata'
    a.onloadedmetadata = () => {
      clearTimeout(t)
      done(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : 0)
    }
    a.onerror = () => {
      clearTimeout(t)
      done(0)
    }
    a.src = url
  })
}

export async function readLocal(e: LocalEntry): Promise<LocalTrack | null> {
  const f = e.file
  // Формат по байтам, а не по расширению: у многих «.mp3» внутри MP4/AAC
  const head = new Uint8Array(await f.slice(0, 16).arrayBuffer())
  const tsz = tagSize(head)
  const after = tsz > 0 ? new Uint8Array(await f.slice(tsz, tsz + 16).arrayBuffer()) : undefined
  const kind = sniff(head, after)
  const isMp3 = kind === 'mpeg'
  let tags: Id3Tags = {}
  let mp4Duration: number | null = null
  if (kind === 'mp4') {
    const moov = await readMoovFromFile(f)
    if (moov) {
      const m = readMoov(moov)
      tags = { ...m.tags, picture: m.tags.picture ? { ...m.tags.picture, front: true } : undefined }
      mp4Duration = m.durationMs
    }
  } else if (tsz > 0) tags = parseV2(new Uint8Array(await f.slice(0, Math.min(tsz, 8 * 1024 * 1024)).arrayBuffer())) ?? {}
  let v1Len = 0
  if (isMp3 && f.size > 128) {
    const v1 = parseV1(new Uint8Array(await f.slice(f.size - 128).arrayBuffer()))
    if (v1) {
      v1Len = 128
      for (const k of ['title', 'artist', 'album', 'genre', 'year', 'trackNo'] as const) {
        if (tags[k] == null && v1[k] != null) (tags as Record<string, unknown>)[k] = v1[k]
      }
    }
  }
  const start = tsz > 0 && tsz < f.size ? tsz : 0
  const sample = new Uint8Array(await f.slice(start, start + 65536).arrayBuffer())
  const legacy = trackKey(f.size, start, sample)
  // MP4: отпечаток по аудиоданным (mdat), чтобы правка тегов его не меняла
  const key = kind === 'mp4' ? ((await mp4KeyFromFile(f)) ?? legacy) : legacy
  const d = isMp3 ? mp3Duration(sample, f.size - start - v1Len) : null
  const durationMs = mp4Duration || d?.ms || (await probeDuration(f))
  let art: LocalTrack['art'] = null
  if (tags.picture) {
    art = {
      hash: sha1Hex([tags.picture.data]).slice(0, 16),
      blob: new Blob([tags.picture.data.buffer as ArrayBuffer], { type: tags.picture.mime }),
    }
  }
  const slash = e.relPath.lastIndexOf('/')
  return {
    key,
    path: e.relPath,
    folder: slash >= 0 ? e.relPath.slice(0, slash + 1) : '',
    fileName: slash >= 0 ? e.relPath.slice(slash + 1) : e.relPath,
    size: f.size,
    mtime: Math.round(f.lastModified / 1000),
    mime: kind === 'mp4' ? 'audio/mp4' : isMp3 ? 'audio/mpeg' : f.type || 'audio/*',
    durationMs,
    bitrate: d?.bitrate ?? null,
    sampleRate: d?.sampleRate ?? null,
    tags,
    art,
    kind,
    legacyKey: legacy !== key ? legacy : undefined,
  }
}
