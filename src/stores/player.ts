import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { MusicCore } from '@/native/music-core'
import type { OutputsEvent, PlayerSnapshot, PlayerStateEvent, PlaySource, QueueEdit, QueueItem, RepeatMode } from '@/native/types'
import { coverFileUri } from '@/native/paths'
import { displayArtist, type Track } from '@/domain/track'
import { orderFor, shuffle, type ShuffleKind } from '@/domain/shuffle'
import { useLibrary } from './library'
import { useSettings } from './settings'

let qidSeq = 0
export function newQid(): string {
  return `${Date.now().toString(36)}${(qidSeq++).toString(36)}`
}

export function toQueueItem(t: Track, source: PlaySource, manual = false): QueueItem {
  return {
    qid: newQid(),
    key: t.key,
    uri: t.uri,
    title: t.title,
    artist: displayArtist(t),
    album: t.album || undefined,
    artUri: coverFileUri(t.art, 'l'),
    durationMs: t.durationMs,
    gainDb: t.gainOffsetDb,
    trimStartMs: t.trimStartMs ?? undefined,
    trimEndMs: t.trimEndMs ?? undefined,
    source,
    manual: manual || undefined,
    trackNo: t.trackNo ?? undefined,
  }
}

export type ShuffleMode = 'off' | ShuffleKind

/**
 * Зеркало движка. Истина о том, что играет, живёт в нативной части:
 * она продолжает работать, когда интерфейс спит. Здесь мы держим копию
 * и сверяем её по ревизии очереди.
 */
export const usePlayer = defineStore('player', () => {
  const library = useLibrary()
  const settings = useSettings()

  const queue = shallowRef<QueueItem[]>([])
  const rev = ref(0)
  const index = ref(-1)
  const playing = ref(false)
  const buffering = ref(false)
  const positionMs = ref(0)
  const positionAt = ref(0)
  const durationMs = ref(0)
  const repeat = ref<RepeatMode>('off')
  const shuffleMode = ref<ShuffleMode>('off')
  const sleepAt = ref(0)
  const sleepEndOfTrack = ref(false)
  const speed = ref(1)
  const pitch = ref(1)
  /** Идёт переход между треками: сколько он ещё продлится (для анимации смены обложки) */
  const transitionMs = ref(0)
  /** Куда идёт звук: bt:<имя>, wired, usb, speaker, web */
  const output = ref('speaker')
  const outputs = shallowRef<OutputsEvent | null>(null)
  /** Повтор отрезка текущего трека */
  const ab = ref<{ start: number; end: number | null } | null>(null)
  /** Порядок «после текущего» до перемешивания, чтобы вернуть его при выключении */
  let unshuffled: QueueItem[] | null = null
  let inflight = 0
  const queueLowHandlers = new Set<(left: number) => void>()

  const current = computed<QueueItem | null>(() => queue.value[index.value] ?? null)
  const currentTrack = computed<Track | null>(() => (current.value ? (library.byKey.get(current.value.key) ?? null) : null))
  const upcoming = computed(() => queue.value.slice(index.value + 1))
  const history = computed(() => queue.value.slice(0, Math.max(0, index.value)))
  const hasTrack = computed(() => current.value != null)

  /* ---------- плавная позиция: один цикл requestAnimationFrame на всё приложение ---------- */
  const now = ref(Date.now())
  let raf = 0
  const loop = () => {
    now.value = Date.now()
    raf = playing.value ? requestAnimationFrame(loop) : 0
  }
  const ensureLoop = () => {
    if (playing.value && !raf) raf = requestAnimationFrame(loop)
  }
  const position = computed(() => {
    if (!playing.value || buffering.value) return positionMs.value
    const p = positionMs.value + Math.max(0, now.value - positionAt.value) * speed.value
    return durationMs.value > 0 ? Math.min(p, durationMs.value) : p
  })

  function applyState(e: PlayerStateEvent) {
    index.value = e.index
    playing.value = e.playing
    buffering.value = e.buffering
    positionMs.value = e.positionMs
    positionAt.value = e.positionAt
    durationMs.value = e.durationMs || current.value?.durationMs || 0
    repeat.value = e.repeat
    sleepAt.value = e.sleepAt ?? 0
    sleepEndOfTrack.value = !!e.sleepEndOfTrack
    speed.value = e.speed ?? 1
    pitch.value = e.pitch ?? 1
    transitionMs.value = e.transitionMs ?? 0
    if (e.output) output.value = e.output
    now.value = Date.now()
    ensureLoop()
  }

  function applySnapshot(s: PlayerSnapshot) {
    queue.value = s.queue
    rev.value = s.rev
    applyState(s)
  }

  async function resync() {
    applySnapshot(await MusicCore.getState())
  }

  let attached = false
  async function attach() {
    if (attached) return
    attached = true
    await MusicCore.addListener('state', (e) => {
      if (e.rev !== rev.value && inflight === 0) void resync()
      else applyState(e)
    })
    await MusicCore.addListener('playLogged', (e) => library.onPlayLogged(e))
    await MusicCore.addListener('notificationAction', (e) => {
      if (e.action === 'favorite') library.patch(e.key, { favoriteAt: e.value ? Date.now() : null })
    })
    await MusicCore.addListener('outputs', (e) => {
      outputs.value = e
      output.value = e.current
    })
    await MusicCore.addListener('queueLow', (e) => queueLowHandlers.forEach((h) => h(e.left)))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void resync()
    })
    await resync()
  }

  // Отрезок A–B относится к одному треку: при смене трека сбрасываем
  watch(
    () => current.value?.qid,
    () => {
      if (ab.value) void clearAb()
    },
  )

  async function edit(edits: QueueEdit[], local: QueueItem[], localIndex = index.value) {
    inflight++
    try {
      queue.value = local
      index.value = localIndex
      const r = await MusicCore.editQueue({ edits })
      rev.value = r.rev
    } finally {
      inflight--
    }
  }

  /* ---------- команды ---------- */

  function ordered(list: Track[], kind: ShuffleKind = settings.s.shuffleKind): Track[] {
    return orderFor(kind, list)
  }

  /** Сыграть список, начиная с трека start. С перемешиванием start всё равно играет первым. */
  async function playTracks(
    list: Track[],
    start: number,
    source: PlaySource,
    opts: { shuffle?: boolean; kind?: ShuffleKind } = {},
  ) {
    if (!list.length) return
    const doShuffle = opts.shuffle ?? shuffleMode.value !== 'off'
    let order = list
    let startIndex = Math.max(0, Math.min(start, list.length - 1))
    if (doShuffle) {
      const kind = opts.kind ?? settings.s.shuffleKind
      const first = opts.shuffle && start < 0 ? null : list[startIndex]!
      const rest = list.filter((t) => t !== first && !t.noShuffle)
      order = first ? [first, ...ordered(rest, kind)] : ordered(rest.length ? rest : list, kind)
      startIndex = 0
      shuffleMode.value = kind
      unshuffled = null
    }
    await setQueue(
      order.map((t) => toQueueItem(t, source)),
      startIndex,
    )
  }

  /** Поставить готовую очередь (радио, миксы, лучшие моменты) */
  async function setQueue(items: QueueItem[], startIndex = 0, play = true, positionMs?: number) {
    inflight++
    try {
      queue.value = items
      index.value = startIndex
      const r = await MusicCore.setQueue({ items, index: startIndex, play, positionMs })
      rev.value = r.rev
    } finally {
      inflight--
    }
  }

  /** «Играть следующим»: сразу после текущего */
  async function playNext(list: Track[], source: PlaySource) {
    if (!hasTrack.value) return playTracks(list, 0, source, { shuffle: false })
    const items = list.map((t) => toQueueItem(t, source, true))
    const at = index.value + 1
    const local = queue.value.slice()
    local.splice(at, 0, ...items)
    await edit([{ op: 'insert', at, items }], local)
  }

  /** «В очередь»: в конец блока, добавленного вручную */
  async function addToQueue(list: Track[], source: PlaySource) {
    if (!hasTrack.value) return playTracks(list, 0, source, { shuffle: false })
    const items = list.map((t) => toQueueItem(t, source, true))
    let at = index.value + 1
    while (queue.value[at]?.manual) at++
    const local = queue.value.slice()
    local.splice(at, 0, ...items)
    await edit([{ op: 'insert', at, items }], local)
  }

  /** Дописать в самый конец (радио докладывает треки) */
  async function append(items: QueueItem[]) {
    if (!items.length) return
    const at = queue.value.length
    await edit([{ op: 'insert', at, items }], [...queue.value, ...items])
  }

  async function removeAt(i: number) {
    if (i === index.value) {
      await MusicCore.editQueue({ edits: [{ op: 'remove', index: i }] })
      await resync()
      return
    }
    const local = queue.value.slice()
    local.splice(i, 1)
    await edit([{ op: 'remove', index: i }], local, i < index.value ? index.value - 1 : index.value)
  }

  async function move(from: number, to: number) {
    if (from === to) return
    const local = queue.value.slice()
    const [item] = local.splice(from, 1)
    local.splice(to, 0, item!)
    let idx = index.value
    if (from === idx) idx = to
    else if (from < idx && to >= idx) idx--
    else if (from > idx && to <= idx) idx++
    await edit([{ op: 'move', from, to }], local, idx)
  }

  async function clearUpcoming() {
    const local = queue.value.slice(0, index.value + 1)
    await edit([{ op: 'replaceUpcoming', items: [] }], local)
  }

  /** Перемешать то, что после текущего; повторное нажатие возвращает исходный порядок */
  async function toggleShuffle(kind?: ShuffleKind) {
    const after = queue.value.slice(index.value + 1)
    const head = queue.value.slice(0, index.value + 1)
    let next: QueueItem[]
    if (shuffleMode.value === 'off' || (kind && kind !== shuffleMode.value)) {
      const k = kind ?? settings.s.shuffleKind
      if (shuffleMode.value === 'off') unshuffled = after
      const manual = after.filter((q) => q.manual)
      const rest = after.filter((q) => !q.manual)
      const tracks = rest.map((q) => library.byKey.get(q.key))
      const byKey = new Map(rest.map((q) => [q.key, q]))
      const order = tracks.every(Boolean) ? ordered(tracks as Track[], k).map((t) => byKey.get(t.key)!) : shuffle(rest)
      next = [...manual, ...order]
      shuffleMode.value = k
    } else {
      const still = new Set(after.map((q) => q.qid))
      const restored = (unshuffled ?? after).filter((q) => still.has(q.qid))
      const known = new Set(restored.map((q) => q.qid))
      next = [...restored, ...after.filter((q) => !known.has(q.qid))]
      unshuffled = null
      shuffleMode.value = 'off'
    }
    await edit([{ op: 'replaceUpcoming', items: next }], [...head, ...next])
  }

  const toggle = () => MusicCore.control({ action: 'toggle' })
  const play = () => MusicCore.control({ action: 'play' })
  const pause = () => MusicCore.control({ action: 'pause' })
  const next = () => MusicCore.control({ action: 'next' })
  const prev = () => MusicCore.control({ action: 'prev' })

  async function seek(ms: number) {
    positionMs.value = ms
    positionAt.value = Date.now()
    await MusicCore.seekTo({ positionMs: Math.round(ms) })
  }

  async function jump(i: number) {
    index.value = i
    await MusicCore.skipTo({ index: i, play: true })
  }

  /** Соседний трек очереди для свайпа: без перемотки текущего в начало, с кругом при повторе всего */
  function neighborIndex(dir: 1 | -1): number {
    const n = queue.value.length
    const j = index.value + dir
    if (j >= 0 && j < n) return j
    if (repeat.value === 'all' && n > 1) return (j + n) % n
    return -1
  }
  async function step(dir: 1 | -1) {
    const j = neighborIndex(dir)
    if (j >= 0) await jump(j)
  }

  /** minutes > 0 — таймер, 'end' — после этого трека, null — выключить */
  async function setSleep(v: number | 'end' | null) {
    await MusicCore.setSleepTimer(v === 'end' ? { endOfTrack: true } : v ? { minutes: v } : {})
  }

  async function cycleRepeat() {
    const order: RepeatMode[] = ['off', 'all', 'one']
    const mode = order[(order.indexOf(repeat.value) + 1) % order.length]!
    repeat.value = mode
    await MusicCore.setRepeat({ mode })
  }

  /* ---------- скорость, отрезок A–B, вывод звука ---------- */

  async function setPlaybackParams(s: number, p: number) {
    speed.value = s
    pitch.value = p
    await MusicCore.setPlaybackParams({ speed: s, pitch: p })
  }

  /** Первое нажатие ставит A, второе — B и включает повтор отрезка */
  async function markAb() {
    const pos = Math.round(position.value)
    if (!ab.value || ab.value.end != null) {
      ab.value = { start: pos, end: null }
      return
    }
    if (pos <= ab.value.start + 500) return
    await setAb(ab.value.start, pos)
    await seek(ab.value.start)
  }

  async function setAb(start: number, end: number) {
    ab.value = { start, end }
    await MusicCore.setAbLoop({ startMs: start, endMs: end })
  }

  async function clearAb() {
    ab.value = null
    await MusicCore.setAbLoop({})
  }

  async function refreshOutputs() {
    const o = await MusicCore.getOutputs()
    outputs.value = o
    output.value = o.current
    return o
  }

  async function setOutput(deviceId: number | null) {
    await MusicCore.setOutput({ deviceId })
    await refreshOutputs()
  }

  function onQueueLow(h: (left: number) => void): () => void {
    queueLowHandlers.add(h)
    return () => queueLowHandlers.delete(h)
  }

  /** Ключи треков очереди без повторов — для «Сохранить как плейлист» */
  function queueKeys(from: 'all' | 'current' = 'all'): string[] {
    const list = from === 'all' ? queue.value : queue.value.slice(Math.max(0, index.value))
    return [...new Set(list.map((q) => q.key))]
  }

  return {
    queue,
    rev,
    index,
    playing,
    buffering,
    position,
    positionMs,
    durationMs,
    repeat,
    shuffleMode,
    sleepAt,
    sleepEndOfTrack,
    speed,
    pitch,
    transitionMs,
    output,
    outputs,
    ab,
    setSleep,
    current,
    currentTrack,
    upcoming,
    history,
    hasTrack,
    attach,
    resync,
    playTracks,
    setQueue,
    playNext,
    addToQueue,
    append,
    removeAt,
    move,
    clearUpcoming,
    toggleShuffle,
    toggle,
    play,
    pause,
    next,
    prev,
    seek,
    jump,
    step,
    neighborIndex,
    cycleRepeat,
    setPlaybackParams,
    markAb,
    setAb,
    clearAb,
    refreshOutputs,
    setOutput,
    onQueueLow,
    queueKeys,
  }
})
