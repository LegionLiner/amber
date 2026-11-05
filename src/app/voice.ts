import { reactive, watch } from 'vue'
import type { Model, KaldiRecognizer } from 'vosk-browser'
import { desktop } from '@/native/desktop/bridge'
import { ARMED_MS, commandLabel, parseVoice, voiceGrammar, type VoiceCommand, type VoiceLang } from '@/domain/voice'
import { setVolume, volume } from './desktop'
import { useSettings } from '@/stores/settings'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { $t } from '@/i18n'

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
  /** Каким микрофоном слушаем сейчас */
  mic: '' as string,
  /** Выбранный в настройках микрофон не подключён: слушаем основным, пока он не появится */
  micMissing: false,
})

let model: Model | null = null
let recognizer: KaldiRecognizer | null = null
let ctx: AudioContext | null = null
let stream: MediaStream | null = null
let node: ScriptProcessorNode | null = null
let armedUntil = 0
/** Язык, на котором сейчас слушаем */
let lang: VoiceLang = 'ru'
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
    voice.stage = p.stage === 'download' ? $t('Скачиваю модель речи') : $t('Готовлю модель речи')
  })
  const settings = useSettings()
  watch(
    () => settings.s.voice,
    (on) => void (on ? startVoice() : stopVoice()),
    { immediate: true },
  )
  // Выбрали другой микрофон или язык команд — переслушиваем (у каждого языка своя модель)
  watch(
    () => [settings.s.voiceMic?.id, settings.s.voiceLang],
    () => {
      if (settings.s.voice && voice.state === 'listening') restartVoice()
    },
  )
  // Подключили или отключили устройство: если ждём выбранный микрофон и он появился — переходим на него
  navigator.mediaDevices?.addEventListener('devicechange', () => {
    if (settings.s.voice && voice.state === 'listening' && voice.micMissing) restartVoice()
  })
}

/**
 * Распознаватель с моделью. Распакованную модель vosk держит в IndexedDB («/vosk»); если этот кэш испорчен
 * («Data lost due to missing file»), загрузка молча висит без ошибки. Тогда через минуту сбрасываем кэш
 * и пробуем ещё раз — модель заново распакуется из скачанного файла
 */
async function loadModel(url: string): Promise<Model> {
  const { Model } = await import('vosk-browser')
  for (let attempt = 0; ; attempt++) {
    const m = new Model(url, debug ? 0 : -1)
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 60_000)
      m.on('load', (msg) => {
        clearTimeout(timer)
        resolve('result' in msg && msg.result)
      })
    })
    if (ok) return m
    m.terminate()
    if (attempt > 0) throw new Error($t('Не удалось загрузить распознаватель речи'))
    await new Promise((done) => {
      const q = indexedDB.deleteDatabase('/vosk')
      q.onsuccess = q.onerror = q.onblocked = done
    })
  }
}

function restartVoice() {
  stopVoice()
  void startVoice()
}

const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
const gum = (audio: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ audio, video: false })
const missingDevice = (e: unknown) => ['OverconstrainedError', 'NotFoundError'].includes((e as { name?: string })?.name ?? '')

/**
 * Микрофон для голоса: выбранный в настройках, если он подключён, иначе основной в Windows.
 * Номер устройства у Chromium постоянный, но после переподключения может смениться — тогда ищем по имени
 */
async function openMic(): Promise<MediaStream> {
  const want = useSettings().s.voiceMic
  voice.micMissing = false
  if (!want) return gum(MIC)
  try {
    return await gum({ ...MIC, deviceId: { exact: want.id } })
  } catch (e) {
    if (!missingDevice(e)) throw e
  }
  const fallback = await gum(MIC)
  const same = (await navigator.mediaDevices.enumerateDevices()).find(
    (d) => d.kind === 'audioinput' && d.label === want.label && d.deviceId !== 'default' && d.deviceId !== 'communications',
  )
  if (same) {
    fallback.getTracks().forEach((t) => t.stop())
    return gum({ ...MIC, deviceId: { exact: same.deviceId } })
  }
  voice.micMissing = true
  return fallback
}

/** Микрофоны для выбора в настройках (имена видны, когда доступ к микрофону уже дан) */
export async function listMics(): Promise<{ id: string; label: string }[]> {
  const all = await navigator.mediaDevices?.enumerateDevices().catch(() => [])
  return (all ?? [])
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, label: d.label || $t('Микрофон {0}', i + 1) }))
}

async function startVoice() {
  if (!desktop || voice.state === 'loading' || voice.state === 'listening') return
  const my = ++run
  voice.state = 'loading'
  voice.error = ''
  voice.stage = $t('Готовлю модель речи')
  voice.progress = null
  try {
    lang = useSettings().s.voiceLang
    const url = await desktop.voicePrepare(lang)
    voice.stage = $t('Загружаю распознаватель')
    voice.progress = null
    const m = await loadModel(url)
    if (my !== run) return m.terminate()
    model = m
    const rec = new m.KaldiRecognizer(16000, JSON.stringify(voiceGrammar(lang)))
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

    stream = await openMic()
    if (my !== run) return
    const track = stream.getAudioTracks()[0]
    voice.mic = track?.label ?? ''
    // Микрофон выдернули посреди работы — переслушиваем: основным, а когда выбранный вернётся, снова им
    track?.addEventListener('ended', () => {
      if (my === run && voice.state === 'listening') restartVoice()
    })
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
    return $t('Нет доступа к микрофону: разреши его в параметрах Windows (Конфиденциальность → Микрофон)')
  if (name === 'NotFoundError') return $t('Микрофон не найден')
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
  if (parseVoice(text, lang).wake) wake()
}

function onResult(text: string) {
  if (debug && text) console.info('[voice] =', text)
  const h = parseVoice(text, lang)
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
        .then((on) => useUi().toast(on ? $t('«{0}» в избранном', title) : $t('«{0}» убран из избранного', title)))
    }
  }
  voice.last = commandLabel(cmd)
  voice.wakeAt = 0
  if (cmd !== 'like') {
    const label =
      cmd === 'quieter' || cmd === 'louder' ? `${commandLabel(cmd)}: ${Math.round(volume.value * 100)}%` : commandLabel(cmd)
    useUi().toast($t('Голос: {0}', label), undefined, 1600)
  }
}
