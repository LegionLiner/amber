import type { PlaySource, RepeatMode } from '../native/types'

/**
 * Что играет на устройстве — так его видят остальные устройства аккаунта (POST /v1/player, событие player).
 * Тот же вид присылает движок телефона из Kotlin (online/RemoteLink.kt): поля менять вместе.
 */
export interface DeviceState {
  key: string
  title: string
  artist: string
  album?: string
  durationMs: number
  /** Позиция в момент отправки */
  positionMs: number
  playing: boolean
  /** Окно очереди ключами вокруг текущего трека (на другом устройстве по ним собирается та же очередь) */
  queue: string[]
  /** Место текущего трека в этом окне */
  index: number
  source?: PlaySource
  repeat?: RepeatMode
}

/** Другое устройство на связи */
export interface LiveDevice {
  id: string
  name: string
  platform: string
  /** Открыт интерфейс приложения: устройство может само собрать очередь («играй отсюда») */
  ui: boolean
  state: DeviceState | null
  /** Сколько состояние пролежало на сервере до отправки нам (часы устройств не сравниваем) */
  ageMs: number
}

/** Команды другому устройству */
export type LiveCommand = 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'seek' | 'takeover'

export interface CommandEvent {
  from: { id: string; name: string }
  cmd: LiveCommand
  args: { ms?: number; state?: DeviceState } | null
}

export interface HelloEvent {
  you: string
  devices: LiveDevice[]
}
