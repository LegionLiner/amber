import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { loadNeighbors, neighborsAge, rebuildNeighbors } from '@/data/repos/neighbors'
import { allBookmarks } from '@/data/repos/bookmarks'
import { normalizeNeighbors, pickRadio, type Neighbors } from '@/domain/radio'
import type { Track } from '@/domain/track'
import type { PlaySource, QueueItem } from '@/native/types'
import { toQueueItem, usePlayer } from './player'
import { useLibrary } from './library'
import { useSettings } from './settings'

const WEEK = 7 * 86_400_000

/**
 * Радио и режим лучших моментов: очереди, которые собирает само приложение.
 * Радио докладывает треки, когда движок сообщает, что в очереди осталось мало (queueLow).
 */
export const useRadio = defineStore('radio', () => {
  const player = usePlayer()
  const library = useLibrary()
  const settings = useSettings()

  const seeds = ref<string[]>([])
  const title = ref('')
  const busy = ref(false)
  let neighbors: Neighbors | null = null
  let neighborsAt = 0

  const active = computed(() => player.current?.source.type === 'radio')

  async function ensureNeighbors(): Promise<Neighbors> {
    if (neighbors && Date.now() - neighborsAt < 3_600_000) return neighbors
    const age = await neighborsAge()
    if (age == null || age > WEEK) await rebuildNeighbors()
    neighbors = normalizeNeighbors(await loadNeighbors())
    neighborsAt = Date.now()
    return neighbors
  }

  function source(): PlaySource {
    return { type: 'radio', id: seeds.value[0], title: title.value }
  }

  async function pick(count: number, recentKeys: string[], exclude: Set<string>): Promise<Track[]> {
    const nb = await ensureNeighbors()
    const byKey = library.byKey
    const seedTracks = seeds.value.map((k) => byKey.get(k)).filter((t): t is Track => !!t)
    const recent = recentKeys.map((k) => byKey.get(k)).filter((t): t is Track => !!t)
    return pickRadio(
      library.tracks,
      { seeds: seedTracks, recent, exclude, neighbors: nb, dials: settings.s.radio, now: Date.now() },
      count,
    )
  }

  /** Радио от одного или нескольких треков: первым звучит само зерно */
  async function start(seedTracks: Track[], name?: string) {
    if (!seedTracks.length || busy.value) return
    busy.value = true
    try {
      seeds.value = seedTracks.slice(0, 5).map((t) => t.key)
      title.value = name ?? `Радио: ${seedTracks[0]!.title}`
      const first = seedTracks[0]!
      // Исключаем только то, что звучит первым: остальные зёрна — самое любимое, им место в эфире
      const picks = await pick(24, [first.key], new Set([first.key]))
      const items: QueueItem[] = [first, ...picks].map((t) => toQueueItem(t, source()))
      await player.setQueue(items, 0, true)
    } finally {
      busy.value = false
    }
  }

  /** «Моё радио»: зёрна — самое любимое и самое слушаемое за последний месяц */
  async function startMine() {
    const monthAgo = Date.now() - 30 * 86_400_000
    const list = library.tracks
      .filter((t) => (t.lastPlayedAt ?? 0) > monthAgo || t.favoriteAt)
      .sort((a, b) => b.plays + (b.favoriteAt ? 5 : 0) + (b.rating ?? 0) - (a.plays + (a.favoriteAt ? 5 : 0) + (a.rating ?? 0)))
    const top = list.slice(0, 12)
    const shuffled = top.sort(() => Math.random() - 0.5).slice(0, 5)
    const seedsList = shuffled.length ? shuffled : library.tracks.slice(0, 5)
    await start(seedsList, 'Моё радио')
  }

  async function topUp() {
    if (!active.value || busy.value) return
    busy.value = true
    try {
      const q = player.queue
      // Не повторяем последние 40 треков эфира; более ранние могут вернуться — радио бесконечное
      const exclude = new Set(q.slice(-40).map((x) => x.key))
      const recent = q.slice(Math.max(0, player.index - 4), player.index + 1).map((x) => x.key)
      const picks = await pick(15, recent, exclude)
      if (picks.length) await player.append(picks.map((t) => toQueueItem(t, source())))
    } finally {
      busy.value = false
    }
  }

  player.onQueueLow(() => void topUp())

  /**
   * Лучшие моменты: отрывки, отмеченные как «лучший момент» (метки типа best),
   * подряд с переходами. Отрезок: от метки (−2 с) до конца отметки или 40 секунд.
   */
  async function startHighlights(): Promise<number> {
    const marks = (await allBookmarks()).filter((b) => b.kind === 'best')
    const items: QueueItem[] = []
    for (const b of marks.sort(() => Math.random() - 0.5)) {
      const t = library.byKey.get(b.trackKey)
      if (!t) continue
      const from = Math.max(0, b.positionMs - 2000)
      const to = Math.min(t.durationMs, b.endMs ?? b.positionMs + 40_000)
      if (to - from < 8000) continue
      const item = toQueueItem(t, { type: 'smart', id: 'highlights', title: 'Лучшие моменты' })
      item.trimStartMs = from
      item.trimEndMs = to
      item.transitionIn = { type: 'crossfade', durationMs: 3000, curve: 'equalPower' }
      items.push(item)
    }
    if (items.length) await player.setQueue(items, 0, true)
    return items.length
  }

  return { seeds, title, busy, active, start, startMine, topUp, startHighlights, ensureNeighbors }
})
