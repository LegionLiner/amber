import { isHistoryFile, parseStreamingHistory, type SpotifyStream } from '@/domain/spotify'
import { listZip, readZipEntry } from '@/domain/zip'
import { $t } from '@/i18n'

/**
 * Читает выбранные файлы выгрузки Spotify: сам архив my_spotify_data.zip или JSON-файлы из него.
 * Всё разбирается на устройстве, никуда не отправляется.
 */
export async function readSpotifyFiles(files: File[]): Promise<{ streams: SpotifyStream[]; files: number }> {
  const streams: SpotifyStream[] = []
  let used = 0
  const text = new TextDecoder()
  const take = (name: string, json: string) => {
    if (!isHistoryFile(name)) return
    const parsed = parseStreamingHistory(JSON.parse(json))
    for (const s of parsed) streams.push(s)
    used++
  }
  for (const f of files) {
    if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
      const buf = await f.arrayBuffer()
      for (const e of listZip(buf)) {
        if (isHistoryFile(e.name)) take(e.name, text.decode(await readZipEntry(buf, e)))
      }
    } else {
      take(f.name, await f.text())
    }
  }
  if (!used) throw new Error($t('В файлах нет истории прослушиваний Spotify (Streaming_History_Audio_*.json)'))
  return { streams, files: used }
}
