import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { isNative } from '@/native/paths'
import type { QueueItem } from '@/native/types'
import { ApiError } from '@/sync/api'
import type { CommandEvent, DeviceState, HelloEvent, LiveCommand, LiveDevice } from '@/sync/live'
import { useSync } from './sync'
import { toQueueItem, usePlayer } from './player'
import { useLibrary } from './library'
import { useUi } from './ui'

/** Другое устройство и момент (по нашим часам), к которому относится позиция в его состоянии */
export interface RemoteDevice extends LiveDevice {
  at: number
}

/** Сколько очереди вокруг текущего трека отправлять: этого хватает, чтобы продолжить слушать с того же места */
const QUEUE_BEFORE = 20
const QUEUE_AFTER = 300

/**
 * Другие устройства аккаунта: что на них играет, управление ими и перенос музыки между ними.
 *
 * Всё идёт через сервер синхронизации (server/src/live.ts) по уже открытому потоку событий (stores/sync.ts):
 *  - это устройство отправляет, что играет (POST /v1/player), когда меняется трек, пауза или место в треке;
 *    на телефоне это делает движок из Kotlin (online/RemoteLink.kt), чтобы работало и с погашенным экраном;
 *  - остальные получают событие player и показывают его (RemoteStrip, DevicesSheet);
 *  - команды (пауза, следующий, перемотка) идут конкретному устройству и выполняются его плеером;
 *  - «Слушать здесь»: очередь другого устройства собирается из своей медиатеки по ключам треков и играет
 *    с того же места, а то устройство встаёт на паузу. «Перенести туда» — то же в обратную сторону:
 *    устройство получает нашу очередь (takeover), начинает играть и само ставит нас на паузу.
 *
 * Играть одновременно на двух устройствах никто не мешает: каждое устройство играет своё, пока его не попросят.
 */
export const useRemote = defineStore('remote', () => {
  const sync = useSync()
  const player = usePlayer()
  const library = useLibrary()
  const ui = useUi()

  const selfId = ref<string | null>(null)
  const devices = shallowRef<RemoteDevice[]>([])
  /** Тикает, пока на другом устройстве что-то играет: полоски прогресса едут */
  const now = ref(Date.now())
  /** Устройство, которым только что управляли отсюда: его полоска не пропадает после паузы */
  const lastControlled = ref<string | null>(null)
  /** Полоску «играет на …» закрыли для этого трека этого устройства */
  const dismissed = ref(new Set<string>())

  /** Это устройство само сообщает, что играет, и само выполняет команды. На телефоне это делает движок */
  const selfPublishes = !isNative

  const online = computed(() => sync.live && selfId.value != null)
  const playingElsewhere = computed(() => devices.value.filter((d) => d.state?.playing))

  /** Что показать полоской: играющее устройство или то, которым только что управляли */
  const strip = computed<RemoteDevice | null>(() => {
    const shown = devices.value.filter(
      (d) => d.state && (d.state.playing || d.id === lastControlled.value) && !dismissed.value.has(`${d.id}:${d.state.key}`),
    )
    return shown.sort((a, b) => Number(b.state!.playing) - Number(a.state!.playing) || b.at - a.at)[0] ?? null
  })

  let ticker = 0
  watch(
    () => devices.value.some((d) => d.state?.playing),
    (on) => {
      clearInterval(ticker)
      if (on) ticker = window.setInterval(() => (now.value = Date.now()), 500)
    },
  )

  function positionOf(d: RemoteDevice, at = now.value): number {
    const s = d.state
    if (!s) return 0
    const p = s.positionMs + (s.playing ? Math.max(0, at - d.at) : 0)
    return s.durationMs > 0 ? Math.min(p, s.durationMs) : p
  }

  /* ---------------- события сервера ---------------- */

  function withAt(d: LiveDevice): RemoteDevice {
    return { ...d, at: Date.now() - (d.ageMs || 0) }
  }

  function upsert(d: RemoteDevice) {
    const list = devices.value.filter((x) => x.id !== d.id)
    devices.value = [...list, d].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }

  sync.onLiveEvent((name, data) => {
    if (name === 'hello') {
      const h = data as HelloEvent | null
      // Старый сервер присылает пустой hello: устройств он не знает
      if (!h?.you) return
      selfId.value = h.you
      devices.value = (h.devices ?? []).filter((d) => d.id !== h.you).map(withAt)
      void publishNow(true)
    } else if (name === 'player') {
      const d = data as (LiveDevice & { gone?: boolean }) | null
      if (!d?.id || d.id === selfId.value) return
      if (d.gone) devices.value = devices.value.filter((x) => x.id !== d.id)
      else upsert(withAt(d))
    } else if (name === 'command') {
      void execute(data as CommandEvent)
    }
  })
  // Поток оборвался: что играет на других устройствах, мы больше не знаем
  watch(
    () => sync.live,
    (v) => {
      if (v) return
      devices.value = []
      selfId.value = null
      lastSent = null
    },
  )

  /* ---------------- что играет здесь ---------------- */

  function stateNow(): DeviceState | null {
    const q = player.queue
    const i = player.index
    const cur = q[i]
    if (!cur) return null
    const from = Math.max(0, i - QUEUE_BEFORE)
    const to = Math.min(q.length, i + QUEUE_AFTER)
    const moving = player.playing && !player.buffering
    const pos = moving ? player.positionMs + Math.max(0, Date.now() - player.positionAt) * player.speed : player.positionMs
    const dur = player.durationMs || cur.durationMs
    return {
      key: cur.key,
      title: cur.title,
      artist: cur.artist,
      album: cur.album,
      durationMs: dur,
      positionMs: Math.round(dur > 0 ? Math.min(pos, dur) : pos),
      playing: player.playing,
      queue: q.slice(from, to).map((x) => x.key),
      index: i - from,
      source: cur.source,
      repeat: player.repeat,
    }
  }

  let lastSent: { sig: string; pos: number; at: number; playing: boolean } | null = null
  let publishTimer = 0

  /** Отправить, что играет. Повтор того же не отправляется: только смена трека, паузы, очереди или перемотка */
  async function publishNow(force = false) {
    if (!selfPublishes || !online.value) return
    const st = stateNow()
    const sig = st ? `${st.key}|${st.playing}|${st.index}|${st.queue.length}|${player.rev}|${st.repeat}` : 'none'
    if (!force && lastSent && lastSent.sig === sig) {
      if (!st) return
      const expected = lastSent.pos + (lastSent.playing ? Date.now() - lastSent.at : 0)
      // Позиция ушла от ожидаемой (перемотали) — отправляем; иначе только раз в полминуты, сверить ход
      if (Math.abs(expected - st.positionMs) < 2000 && Date.now() - lastSent.at < 30_000) return
    }
    lastSent = { sig, pos: st?.positionMs ?? 0, at: Date.now(), playing: !!st?.playing }
    try {
      await sync.client().player(st)
    } catch {
      // Нет сети — не страшно: при переподключении (hello) состояние уйдёт заново
      lastSent = null
    }
  }

  function publishSoon() {
    clearTimeout(publishTimer)
    publishTimer = window.setTimeout(() => void publishNow(), 150)
  }

  if (selfPublishes) {
    watch(
      [() => player.current?.qid, () => player.playing, () => player.rev, () => player.index, () => player.repeat],
      publishSoon,
    )
    watch(() => player.positionMs, publishSoon)
    window.setInterval(() => {
      if (player.playing) void publishNow()
    }, 30_000)
  }

  /* ---------------- команды этому устройству ---------------- */

  async function execute(e: CommandEvent | null) {
    if (!e?.cmd) return
    switch (e.cmd) {
      case 'play':
        await player.play()
        break
      case 'pause':
        await player.pause()
        break
      case 'toggle':
        await player.toggle()
        break
      case 'next':
        await player.next()
        break
      case 'prev':
        await player.prev()
        break
      case 'seek':
        if (typeof e.args?.ms === 'number') await player.seek(e.args.ms)
        break
      case 'takeover': {
        const st = e.args?.state
        if (!st) return
        if (await startFrom(st, st.positionMs)) {
          // Заиграло здесь — то устройство замолкает (а если не заиграло, пусть играет дальше)
          void send(e.from.id, 'pause', undefined, true)
          ui.toast(`Продолжаю то, что играло на «${e.from.name}»`)
        }
        break
      }
    }
  }

  /** Собрать очередь другого устройства из своей медиатеки и играть с того же места */
  async function startFrom(st: DeviceState, positionMs: number): Promise<boolean> {
    const source = st.source ?? { type: 'library' as const }
    const items: QueueItem[] = []
    let start = -1
    let pos = Math.max(0, Math.round(positionMs))
    st.queue.forEach((key, j) => {
      const t = library.byKey.get(key)
      if (!t) return
      if (j === st.index) start = items.length
      // Текущего трека здесь нет — начинаем со следующего, который есть, с его начала
      else if (start < 0 && j > st.index) {
        start = items.length
        pos = 0
      }
      items.push(toQueueItem(t, source))
    })
    if (!items.length || start < 0) {
      ui.toast('Этих треков нет на этом устройстве')
      return false
    }
    if (st.queue[st.index] && !library.byKey.has(st.queue[st.index]!)) ui.toast('Этого трека здесь нет — играет следующий')
    await player.setQueue(items, start, true, pos || undefined)
    return true
  }

  /* ---------------- управление другими устройствами ---------------- */

  /** Команда устройству. quiet — без сообщения об ошибке (служебная пауза после переноса) */
  async function send(to: string, cmd: LiveCommand, args?: unknown, quiet = false): Promise<boolean> {
    try {
      await sync.client().command(to, cmd, args)
      return true
    } catch (e) {
      if (!quiet) ui.toast(e instanceof ApiError ? e.message : 'Устройство не ответило')
      return false
    }
  }

  /** Сразу показываем ожидаемое (пауза, перемотка), настоящее состояние придёт следом */
  function optimistic(d: RemoteDevice, patch: Partial<DeviceState>) {
    if (!d.state) return
    const positionMs = positionOf(d, Date.now())
    upsert({ ...d, at: Date.now(), state: { ...d.state, positionMs, ...patch } })
  }

  async function control(d: RemoteDevice, cmd: 'toggle' | 'next' | 'prev') {
    lastControlled.value = d.id
    if (cmd === 'toggle') optimistic(d, { playing: !d.state?.playing })
    await send(d.id, cmd)
  }

  async function seek(d: RemoteDevice, ms: number) {
    lastControlled.value = d.id
    optimistic(d, { positionMs: Math.round(ms) })
    await send(d.id, 'seek', { ms: Math.round(ms) })
  }

  /** «Слушать здесь»: то, что играет там, продолжает играть здесь с того же места, а там — пауза */
  async function continueHere(d: RemoteDevice) {
    const st = d.state
    if (!st) return
    const ok = await startFrom(st, positionOf(d, Date.now()))
    if (!ok) return
    if (st.playing) {
      optimistic(d, { playing: false })
      await send(d.id, 'pause', undefined, true)
    }
    dismissed.value = new Set(dismissed.value).add(`${d.id}:${st.key}`)
  }

  /** «Перенести туда»: то устройство начнёт играть нашу очередь с этого места и само поставит нас на паузу */
  async function sendTo(d: RemoteDevice) {
    const st = stateNow()
    if (!st) return
    if (await send(d.id, 'takeover', { state: { ...st, playing: true } })) ui.toast(`Переношу на «${d.name}»`)
  }

  function dismiss(d: RemoteDevice) {
    if (!d.state) return
    dismissed.value = new Set(dismissed.value).add(`${d.id}:${d.state.key}`)
    if (lastControlled.value === d.id) lastControlled.value = null
  }

  return {
    selfId,
    devices,
    online,
    now,
    strip,
    playingElsewhere,
    positionOf,
    control,
    seek,
    continueHere,
    sendTo,
    dismiss,
    stateNow,
  }
})
