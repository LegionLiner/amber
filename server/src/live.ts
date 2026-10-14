/**
 * Живая связь устройств одного аккаунта — через открытые потоки /v1/events.
 *
 * Поток открывает интерфейс приложения (role=ui: окно на компьютере, открытое приложение на телефоне) или
 * звуковой движок телефона (role=engine: служба воспроизведения, которая живёт и с погашенным экраном).
 * Устройство «на связи», пока у него открыт хотя бы один поток.
 *
 * Что ходит по потокам:
 *  - changed — другое устройство прислало изменения базы, пора делать /v1/sync (только интерфейсам);
 *  - player — что играет на другом устройстве (только интерфейсам: им это показывать);
 *  - command — команда этому устройству от другого: пауза, следующий трек, «играй отсюда».
 *    Управление плеером получает движок, если его поток открыт, иначе интерфейс (на компьютере движок
 *    и интерфейс — одно окно). «Играй отсюда» (takeover) собирает очередь из медиатеки — это умеет только
 *    интерфейс.
 *
 * Всё в памяти процесса: сервер один, а после его перезапуска устройства переподключатся и пришлют
 * своё состояние заново.
 */

export type Role = 'ui' | 'engine'

export interface Stream {
  deviceId: string
  role: Role
  send(event: string, data?: unknown): void
  end(): void
}

interface Presence {
  id: string
  name: string
  platform: string
  /** Что играет — как прислало устройство; null — плеер пуст */
  state: unknown
  /** Когда состояние пришло (часы сервера): получатель досчитает позицию без расхождения часов устройств */
  at: number
}

export interface DeviceRef {
  id: string
  name: string
  platform: string
}

/** Команды управления плеером: их выполняет движок */
const CONTROL = new Set(['play', 'pause', 'toggle', 'next', 'prev', 'seek'])
export const COMMANDS = new Set([...CONTROL, 'takeover'])

export class LiveHub {
  private readonly streams = new Map<string, Set<Stream>>()
  private readonly presence = new Map<string, Map<string, Presence>>()

  private devicesOf(userId: string): Map<string, Presence> {
    let m = this.presence.get(userId)
    if (!m) this.presence.set(userId, (m = new Map()))
    return m
  }

  private streamsOf(userId: string, deviceId?: string): Stream[] {
    const all = [...(this.streams.get(userId) ?? [])]
    return deviceId ? all.filter((s) => s.deviceId === deviceId) : all
  }

  private view(userId: string, p: Presence) {
    return {
      id: p.id,
      name: p.name,
      platform: p.platform,
      ui: this.streamsOf(userId, p.id).some((s) => s.role === 'ui'),
      state: p.state,
      ageMs: Math.max(0, Date.now() - p.at),
    }
  }

  /** Интерфейсам остальных устройств: устройство появилось, поменялось или ушло (gone) */
  private announce(userId: string, deviceId: string) {
    const p = this.presence.get(userId)?.get(deviceId)
    const data = p ? this.view(userId, p) : { id: deviceId, gone: true }
    for (const s of this.streamsOf(userId)) if (s.deviceId !== deviceId && s.role === 'ui') s.send('player', data)
  }

  open(userId: string, stream: Stream, device: DeviceRef) {
    let set = this.streams.get(userId)
    if (!set) this.streams.set(userId, (set = new Set()))
    set.add(stream)
    const devices = this.devicesOf(userId)
    const p = devices.get(device.id)
    if (p) {
      p.name = device.name
      p.platform = device.platform
    } else {
      devices.set(device.id, { ...device, state: null, at: Date.now() })
    }
    const others = [...devices.values()].filter((d) => d.id !== device.id).map((d) => this.view(userId, d))
    stream.send('hello', { you: device.id, devices: others })
    this.announce(userId, device.id)
  }

  close(userId: string, stream: Stream) {
    const set = this.streams.get(userId)
    if (!set?.delete(stream)) return
    if (!set.size) this.streams.delete(userId)
    if (!this.streamsOf(userId, stream.deviceId).length) {
      const devices = this.presence.get(userId)
      devices?.delete(stream.deviceId)
      if (devices && !devices.size) this.presence.delete(userId)
    }
    this.announce(userId, stream.deviceId)
  }

  /** Новое состояние плеера устройства. Без открытого потока устройство не на связи — состояние не храним */
  setState(userId: string, deviceId: string, state: unknown): boolean {
    const p = this.presence.get(userId)?.get(deviceId)
    if (!p) return false
    p.state = state
    p.at = Date.now()
    this.announce(userId, deviceId)
    return true
  }

  /** Изменения базы: интерфейсы остальных устройств идут за ними */
  changed(userId: string, exceptDevice: string) {
    for (const s of this.streamsOf(userId)) if (s.deviceId !== exceptDevice && s.role === 'ui') s.send('changed')
  }

  /** Команда устройству. offline — оно не на связи; no-ui — команда только для интерфейса, а он закрыт */
  command(userId: string, from: DeviceRef, to: string, cmd: string, args: unknown): 'ok' | 'offline' | 'no-ui' {
    const target = this.streamsOf(userId, to)
    if (!target.length) return 'offline'
    const engine = target.filter((s) => s.role === 'engine')
    const ui = target.filter((s) => s.role === 'ui')
    const to_ = CONTROL.has(cmd) ? (engine.length ? engine : ui) : ui
    if (!to_.length) return 'no-ui'
    for (const s of to_) s.send('command', { from: { id: from.id, name: from.name }, cmd, args: args ?? null })
    return 'ok'
  }

  /** Устройство вышло или его отключили: его потоки закрываются */
  drop(userId: string, deviceId: string) {
    for (const s of this.streamsOf(userId, deviceId)) s.end()
  }

  closeAll() {
    for (const set of this.streams.values()) for (const s of set) s.end()
    this.streams.clear()
    this.presence.clear()
  }
}
