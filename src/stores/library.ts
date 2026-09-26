import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { MusicCore } from '@/native/music-core'
import type { DamagedFile, PlayLoggedEvent, ScanProgress, ScanResult } from '@/native/types'
import { loadAnalysis, loadTrackRows, saveRating, upsertTrackUser } from '@/data/repos/library'
import { toTrack, type Track } from '@/domain/track'
import { buildFolderTree, groupAlbums, groupArtists, groupGenres } from '@/domain/groups'
import { scoreForRating } from '@/domain/rating'
import { useSettings } from './settings'

/**
 * Версия чтения библиотеки. 2 — формат определяется по байтам (у многих «.mp3» внутри MP4/AAC,
 * их теги теперь читаются правильно). 3 — отпечаток MP4 по аудиоданным (история переезжает на новый ключ).
 * После обновления один раз перечитываем всё.
 */
export const SCANNER_VERSION = 3

export const useLibrary = defineStore('library', () => {
  const settings = useSettings()

  /** Все треки. shallowRef: массив меняется целиком, отдельные треки не отслеживаются */
  const tracks = shallowRef<Track[]>([])
  const byKey = shallowRef(new Map<string, Track>())
  const loaded = ref(false)
  const scanning = ref(false)
  const progress = ref<ScanProgress | null>(null)
  const lastScan = ref<ScanResult | null>(null)
  /** Файлы, испорченные старой записью тегов (ID3 перед MP4): их можно починить */
  const damaged = shallowRef<DamagedFile[]>([])
  /** Фоновый анализ громкости и волны: сколько сделано из скольких */
  const analysis = ref<{ done: number; total: number } | null>(null)
  const analyzedPending = new Set<string>()
  let analysisTimer: ReturnType<typeof setTimeout> | undefined

  function setAll(list: Track[]) {
    tracks.value = list
    byKey.value = new Map(list.map((t) => [t.key, t]))
  }

  async function load() {
    const rows = await loadTrackRows()
    const opts = { albumFromFolder: settings.s.albumFromFolder }
    setAll(rows.map((r) => toTrack(r, opts)))
    loaded.value = true
  }

  async function scan(full = false): Promise<ScanResult | null> {
    if (scanning.value) return null
    scanning.value = true
    progress.value = null
    const handle = await MusicCore.addListener('scanProgress', (p) => (progress.value = p))
    try {
      const res = await MusicCore.scan({
        full,
        minDurationMs: settings.s.scan.minDurationMs,
        excludeFolders: settings.s.scan.excludeFolders,
      })
      lastScan.value = res
      damaged.value = res.damaged ?? []
      settings.s.scan.lastScanAt = Date.now()
      if (full) settings.s.scan.version = SCANNER_VERSION
      await load()
      void scheduleAnalysis()
      return res
    } finally {
      scanning.value = false
      progress.value = null
      await handle.remove()
    }
  }

  let attached = false
  async function attach() {
    if (attached) return
    attached = true
    await MusicCore.addListener('analysisProgress', (p) => {
      analysis.value = p.done >= p.total ? null : { done: p.done, total: p.total }
      analyzedPending.add(p.key)
      clearTimeout(analysisTimer)
      analysisTimer = setTimeout(() => void flushAnalysis(), p.done >= p.total ? 0 : 2500)
    })
  }

  /** Всё, что ещё не анализировали, — в фоновую очередь (на телефоне: на зарядке или при открытом приложении) */
  async function scheduleAnalysis() {
    const keys = tracks.value.filter((t) => !t.analyzed).map((t) => t.key)
    if (keys.length) await MusicCore.analyze({ keys, priority: 'night' })
  }

  async function flushAnalysis() {
    const keys = [...analyzedPending]
    analyzedPending.clear()
    const rows = await loadAnalysis(keys)
    patchMany(new Map(rows.map((r) => [r.key, { lufs: r.lufs, bpm: r.bpm, energy: r.energy, analyzed: true }])))
  }

  /** Починить испорченные файлы: Android один раз спросит разрешение, потом библиотека пересканируется */
  async function repairDamaged(): Promise<{ written: number; failed: number }> {
    const items = damaged.value.map((d) => ({ key: d.key, uri: d.uri, path: d.path }))
    if (!items.length) return { written: 0, failed: 0 }
    const r = await MusicCore.repairFiles({ items })
    await scan(false)
    return { written: r.written, failed: r.failed.length }
  }

  function get(key: string): Track | undefined {
    return byKey.value.get(key)
  }

  /** Заменить один трек новым объектом, чтобы Vue увидел изменение */
  function patch(key: string, changes: Partial<Track>) {
    const t = byKey.value.get(key)
    if (!t) return
    const next = { ...t, ...changes }
    const map = new Map(byKey.value)
    map.set(key, next)
    byKey.value = map
    tracks.value = tracks.value.map((x) => (x.key === key ? next : x))
  }

  /** Много изменений за один проход: один новый массив вместо сотни */
  function patchMany(changes: Map<string, Partial<Track>>) {
    if (!changes.size) return
    const map = new Map(byKey.value)
    tracks.value = tracks.value.map((t) => {
      const c = changes.get(t.key)
      if (!c) return t
      const next = { ...t, ...c }
      map.set(t.key, next)
      return next
    })
    byKey.value = map
  }

  async function setRating(key: string, rating: number | null) {
    const t = get(key)
    if (!t) return
    const rankScore = scoreForRating(rating, t.rating, t.rankScore)
    patch(key, { rating, rankScore })
    await saveRating(key, rating, rankScore)
  }

  async function toggleFavorite(key: string): Promise<boolean> {
    const t = get(key)
    if (!t) return false
    const favoriteAt = t.favoriteAt ? null : Date.now()
    patch(key, { favoriteAt })
    await upsertTrackUser(key, { favoriteAt })
    void MusicCore.setFavoriteState({ key, value: favoriteAt != null }).catch(() => undefined)
    return favoriteAt != null
  }

  function onPlayLogged(e: PlayLoggedEvent) {
    const t = get(e.key)
    if (!t) return
    patch(e.key, {
      plays: t.plays + (e.counted ? 1 : 0),
      skips: t.skips + (e.endReason === 'skipped' && !e.counted ? 1 : 0),
      listenedMs: t.listenedMs + e.listenedMs,
      lastPlayedAt: e.counted ? e.startedAt : t.lastPlayedAt,
      firstPlayedAt: t.firstPlayedAt ?? (e.counted ? e.startedAt : null),
      lastStartedAt: e.startedAt,
    })
  }

  const albums = computed(() => groupAlbums(tracks.value))
  const artists = computed(() => groupArtists(tracks.value))
  const genres = computed(() => groupGenres(tracks.value))
  const folderTree = computed(() => buildFolderTree(tracks.value))
  const favorites = computed(() =>
    tracks.value.filter((t) => t.favoriteAt).sort((a, b) => (b.favoriteAt ?? 0) - (a.favoriteAt ?? 0)),
  )
  const totalDurationMs = computed(() => tracks.value.reduce((s, t) => s + t.durationMs, 0))

  return {
    tracks,
    byKey,
    loaded,
    scanning,
    progress,
    lastScan,
    damaged,
    repairDamaged,
    analysis,
    attach,
    scheduleAnalysis,
    load,
    scan,
    get,
    patch,
    patchMany,
    setRating,
    toggleFavorite,
    onPlayLogged,
    albums,
    artists,
    genres,
    folderTree,
    favorites,
    totalDurationMs,
  }
})
