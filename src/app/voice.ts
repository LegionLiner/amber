import { reactive, watch } from 'vue'
import type { Model, KaldiRecognizer } from 'vosk-browser'
import { desktop } from '@/native/desktop/bridge'
import { ARMED_MS, COMMAND_LABELS, parseVoice, voiceGrammar, type VoiceCommand } from '@/domain/voice'
import { setVolume, volume } from './desktop'
import { useSettings } from '@/stores/settings'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'

/**
 * Голосовые команды на компьютере: «Эмбер, стоп», «Эмбер, следующий», «Эмбер, тише».
 * Всё офлайн: модель Vosk (~45 МБ) скачивается при первом включении, звук с микрофона никуда не уходит.
 *
 * Услышав «Эмбер», приложение приглушает музыку на несколько секунд — команда звучит отчётливее,
 * и её можно сказать отдельной фразой. Микрофон — с эхоподавлением: свою музыку он слышит слабее.
 * Распознаватель (vosk-browser, WebAssembly) загружается только при включении: в обычном запуске его нет.
 */

export type VoiceState = 'off' | 'loading' | 'listening' | 'error'

export const voice = reactive({
  state: 'off' as VoiceState,
  /** Подготовка модели: 0…1 при скачивании, null — распаковка или загрузка в распознаватель */
  progress: null as number | null,
  stage: '' as string,
  error: '',
  /** Когда прозвучало «Эмбер» (значок микрофона в это время светится) */
  wakeAt: 0,
  /** Последняя выполненная команда — для подписи в настройках */
  last: '' as string,
})

let model: Model | null = null
let recognizer: KaldiRecognizer | null = null
let ctx: AudioContext | null = null
let stream: MediaStream | null = null
let node: ScriptProcessorNode | null = null
let armedUntil = 0
/** Отладка: localStorage.amberVoiceDebug = '1' — в консоль идёт услышанное и уровень микрофона */
const debug = (() => {
  try {
    return localStorage.getItem('amberVoiceDebug') === '1'
  } catch {
    return false
  }
})()
let levelAt = 0
let duck: { from: number; to: number; timer: ReturnType<typeof setTimeout> } | null = null
let run = 0

/** Включение и выключение — по настройке; вызывается при запуске компьютерной версии */
export function setupVoice(): void {
  if (!desktop) return
  desktop.onVoiceProgress((p) => {
    voice.progress = p.stage === 'download' && p.total ? p.done / p.total : null
    voice.stage = p.stage === 'download' ? 'Скачиваю модель речи' : 'Готовлю модель речи'
  })
  const settings = useSettings()
  watch(
    () => settings.s.voice,
    (on) => void (on ? startVoice() : stopVoice()),
    { immediate: true },
  )
}

async function startVoice() {
  if (!desktop || voice.state === 'loading' || voice.state === 'listening') return
  const my = ++run
  voice.state = 'loading'
  voice.error = ''
  voice.stage = 'Готовлю модель речи'
  voice.progress = null
  try {
    const url = await desktop.voicePrepare()
    voice.stage = 'Загружаю распознаватель'
    voice.progress = null
    const { createModel } = await import('vosk-browser')
    const m = await createModel(url, debug ? 0 : -1)
    if (my !== run) return m.terminate()
    model = m
    const rec = new m.KaldiRecognizer(16000, JSON.stringify(voiceGrammar()))
    rec.on('result', (msg) => onResult((msg as { result: { text: string } }).result.text))
    rec.on('partialresult', (msg) => onPartial((msg as { result: { partial: string } }).result.partial))
    recognizer = rec
    // Отладка: звук можно подать прямо в распознаватель (проверка без микрофона)
    if (debug) {
      Object.assign(window, {
        amberVoiceFeed: (pcm: Float32Array) => recognizer?.acceptWaveformFloat(pcm, 16000),
        amberVoiceModel: m,
      })
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    })
    if (my !== run) return
    ctx = new AudioContext({ sampleRate: 16000 })
    const source = ctx.createMediaStreamSource(stream)
    node = ctx.createScriptProcessor(4096, 1, 1)
    node.onaudioprocess = (e) => {
      if (debug && performance.now() - levelAt > 2000) {
        levelAt = performance.now()
        const d = e.inputBuffer.getChannelData(0)
        let sum = 0
        for (let i = 0; i < d.length; i++) sum += d[i]! * d[i]!
        console.info('[voice] уровень', Math.sqrt(sum / d.length).toFixed(4), 'частота', e.inputBuffer.sampleRate)
      }
      try {
        recognizer?.acceptWaveform(e.inputBuffer)
      } catch {
        /* распознаватель занят или выключается */
      }
    }
    source.connect(node)
    // Без выхода в destination обработчик в Chromium не вызывается; сам он ничего не пишет — тишина
    node.connect(ctx.destination)
    voice.state = 'listening'
  } catch (e) {
    if (my !== run) return
    release()
    voice.state = 'error'
    voice.error = humanError(e)
  }
}

function humanError(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError')
    return 'Нет доступа к микрофону: разреши его в параметрах Windows (Конфиденциальность → Микрофон)'
  if (name === 'NotFoundError') return 'Микрофон не найден'
  return e instanceof Error ? e.message : String(e)
}

function release() {
  node?.disconnect()
  node = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  void ctx?.close().catch(() => undefined)
  ctx = null
  try {
    recognizer?.remove()
  } catch {
    /* уже убран */
  }
  recognizer = null
  model?.terminate()
  model = null
  endDuck()
}

function stopVoice() {
  run++
  release()
  voice.state = 'off'
  voice.progress = null
}

/* ---------- что услышали ---------- */

function onPartial(text: string) {
  if (debug && text) console.info('[voice] …', text)
  if (parseVoice(text).wake) wake()
}

function onResult(text: string) {
  if (debug && text) console.info('[voice] =', text)
  const h = parseVoice(text)
  if (!h.wake && !h.command) return
  const now = Date.now()
  if (h.wake && !h.command) {
    wake()
    return
  }
  // Команда без «Эмбер» — только сразу после него (или после предыдущей команды: «тише… ещё тише»)
  if (!h.wake && now > armedUntil) return
  armedUntil = now + 2500
  exec(h.command!)
}

function wake() {
  const now = Date.now()
  voice.wakeAt = now
  armedUntil = now + ARMED_MS
  startDuck()
  setTimeout(() => {
    if (voice.wakeAt === now) voice.wakeAt = 0
  }, ARMED_MS)
}

/** Музыку — тише, пока ждём команду; без команды громкость возвращается сама */
function startDuck() {
  if (duck) {
    clearTimeout(duck.timer)
  } else {
    const from = volume.value
    const to = Math.round(Math.min(from, Math.max(0.04, from * 0.3)) * 100) / 100
    duck = { from, to, timer: 0 as unknown as ReturnType<typeof setTimeout> }
    setVolume(to)
  }
  duck.timer = setTimeout(endDuck, ARMED_MS + 500)
}

function endDuck() {
  if (!duck) return
  clearTimeout(duck.timer)
  // Громкость поменяли вручную, пока музыка была приглушена, — не трогаем
  if (volume.value === duck.to) setVolume(duck.from)
  duck = null
}

function exec(cmd: VoiceCommand) {
  const player = usePlayer()
  const base = duck?.from ?? volume.value
  if (cmd === 'quieter' || cmd === 'louder') {
    if (duck) clearTimeout(duck.timer)
    duck = null
    setVolume(base + (cmd === 'louder' ? 0.1 : -0.1))
  } else {
    endDuck()
    if (cmd === 'pause') void player.pause()
    else if (cmd === 'play') void player.play()
    else if (cmd === 'next') void player.next()
    else if (cmd === 'prev') void player.prev()
    else if (cmd === 'like' && player.current) {
      const title = player.current.title
      void useLibrary()
        .toggleFavorite(player.current.key)
        .then((on) => useUi().toast(on ? `«${title}» в избранном` : `«${title}» убран из избранного`))
    }
  }
  voice.last = COMMAND_LABELS[cmd]
  voice.wakeAt = 0
  if (cmd !== 'like') {
    const label =
      cmd === 'quieter' || cmd === 'louder' ? `${COMMAND_LABELS[cmd]}: ${Math.round(volume.value * 100)}%` : COMMAND_LABELS[cmd]
    useUi().toast(`Голос: ${label}`, undefined, 1600)
  }
}
