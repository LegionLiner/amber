/**
 * «Исполнитель — Название» из заголовка ролика YouTube. Пометки вроде (Official Video), [HD], (клип) убираются.
 * Без тире исполнитель — канал (без « - Topic»). Так же делает YouTube.kt на телефоне.
 */
export function splitYoutubeTitle(name: string, uploader: string): [artist: string, title: string] {
  const clean = name
    .replace(
      /\s*[([](official\s*(music\s*)?(video|audio|lyric video|visualizer)|lyrics?|audio|hd|hq|4k|mv|клип|премьера[^)\]]*)[)\]]/gi,
      '',
    )
    .trim()
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(clean)
  if (m) return [m[1]!.trim(), m[2]!.trim()]
  return [uploader.replace(/ - Topic$/, '').trim() || 'YouTube', clean]
}
