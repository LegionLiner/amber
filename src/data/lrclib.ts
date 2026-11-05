import { APP_VERSION } from '@/app/version'
import { rank, type LrclibRecord, type LyricsQuery } from '@/domain/lrclib'
import { $t } from '@/i18n'

/**
 * Запросы к LRCLIB. Без ключей и аккаунтов; браузер не даёт подменить User-Agent,
 * поэтому приложение представляется заголовком Lrclib-Client, как просит LRCLIB.
 */
const BASE = 'https://lrclib.net/api'
const HEADERS = { 'Lrclib-Client': `Amber ${APP_VERSION} (https://github.com/LegionLiner/amber)` }

async function get<T>(path: string, params: Record<string, string>, timeoutMs = 12000): Promise<T | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: HEADERS, signal: ctl.signal })
    if (res.status === 404) return null
    if (!res.ok) throw new Error($t('LRCLIB ответил {0}', res.status))
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Все подходящие варианты, лучший первым. Сначала точный запрос (название + исполнитель + альбом + длительность),
 * затем поиск по названию и исполнителю — у многих треков точной записи нет, а похожие есть.
 */
export async function lrclibFind(q: LyricsQuery): Promise<LrclibRecord[]> {
  const seen = new Map<number, LrclibRecord>()
  const exact = await get<LrclibRecord>('/get', {
    track_name: q.title,
    artist_name: q.artist,
    ...(q.album ? { album_name: q.album } : {}),
    ...(q.durationMs > 0 ? { duration: String(Math.round(q.durationMs / 1000)) } : {}),
  }).catch(() => null)
  if (exact) seen.set(exact.id, exact)
  const found = await get<LrclibRecord[]>('/search', { track_name: q.title, ...(q.artist ? { artist_name: q.artist } : {}) })
  for (const r of found ?? []) seen.set(r.id, r)
  // Ничего по названию с исполнителем — пробуем свободный поиск (исполнитель записан иначе)
  if (!seen.size) {
    for (const r of (await get<LrclibRecord[]>('/search', { q: `${q.artist} ${q.title}`.trim() })) ?? []) seen.set(r.id, r)
  }
  return rank([...seen.values()], q)
}
