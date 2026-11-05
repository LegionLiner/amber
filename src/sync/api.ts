import type { SyncItem } from './kinds'
import type { SyncResponse } from './engine'
import type { DeviceState, LiveCommand } from './live'
import { $t } from '@/i18n'

/** Запросы к серверу Amber (server/). Ошибки — с текстом для человека и видом: нет сети, нужно войти, прочее */

/** Сколько поток событий может молчать, прежде чем считается мёртвым (сервер подаёт голос раз в 25 с) */
const SILENCE_MS = 70_000

export type ApiErrorKind = 'offline' | 'auth' | 'server'

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message)
  }
}

export interface DeviceInfo {
  id: string
  name: string
  platform: string
  lastSeenAt: string
  current: boolean
}

export interface Me {
  email: string
  items: number
  devices: DeviceInfo[]
}

/** «music.example.com» → «https://music.example.com», без косой черты в конце */
export function normalizeUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`
  return u
}

export class SyncApi {
  constructor(
    readonly base: string,
    private token: string | null = null,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown, timeoutMs = 60000): Promise<T> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      })
    } catch {
      throw new ApiError('offline', $t('Сервер недоступен: нет сети или неверный адрес'))
    } finally {
      clearTimeout(timer)
    }
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      /* не JSON — например, страница nginx */
    }
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error ?? $t('Сервер ответил {0}', res.status)
      throw new ApiError(res.status === 401 ? 'auth' : 'server', msg)
    }
    if (data == null) throw new ApiError('server', $t('По этому адресу не сервер Amber'))
    return data as T
  }

  health() {
    return this.req<{ ok: boolean; version: string }>('GET', '/v1/health', undefined, 15000)
  }

  register(email: string, password: string, device: { name: string; platform: string }, code?: string) {
    return this.req<{ token: string; email: string }>('POST', '/v1/auth/register', { email, password, device, code })
  }

  login(email: string, password: string, device: { name: string; platform: string }) {
    return this.req<{ token: string; email: string }>('POST', '/v1/auth/login', { email, password, device })
  }

  logout() {
    return this.req<{ ok: boolean }>('POST', '/v1/auth/logout', {}, 15000)
  }

  me() {
    return this.req<Me>('GET', '/v1/me', undefined, 20000)
  }

  forgetDevice(id: string) {
    return this.req<{ ok: boolean }>('DELETE', `/v1/devices/${encodeURIComponent(id)}`)
  }

  deleteAccount(password: string) {
    return this.req<{ ok: boolean }>('DELETE', '/v1/me', { password })
  }

  sync(body: { cursor: number; changes: SyncItem[] }) {
    return this.req<SyncResponse>('POST', '/v1/sync', body, 120000)
  }

  /** Что играет на этом устройстве (null — ничего). live: false — поток событий ещё не открыт, сервер не запомнил */
  player(state: DeviceState | null) {
    return this.req<{ ok: boolean; live?: boolean }>('POST', '/v1/player', { state }, 15000)
  }

  /** Команда другому устройству: пауза, следующий трек, «играй отсюда» */
  command(to: string, cmd: LiveCommand, args?: unknown) {
    return this.req<{ ok: boolean }>('POST', '/v1/command', { to, cmd, args }, 15000)
  }

  /**
   * Поток событий сервера (SSE): «hello» — поток открыт (с тем, что играет на других устройствах),
   * «changed» — другое устройство прислало изменения, «player» — что играет на другом устройстве,
   * «command» — команда этому устройству. Возвращается, когда поток закрылся. Сервер раз в 25 с шлёт пустую строку; тишина дольше SILENCE_MS —
   * соединение мертво (сеть сменилась, телефон спал), рвём его сами.
   * Ошибка вида 'server' — сервер старый и потока не знает.
   */
  async events(onEvent: (name: string, data: unknown) => void, signal: AbortSignal): Promise<void> {
    const ctl = new AbortController()
    const stop = () => ctl.abort()
    signal.addEventListener('abort', stop)
    let watchdog = 0
    const alive = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(stop, SILENCE_MS) as unknown as number
    }
    try {
      alive()
      let res: Response
      try {
        res = await fetch(`${this.base}/v1/events?role=ui`, {
          headers: { Accept: 'text/event-stream', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
          cache: 'no-store',
          signal: ctl.signal,
        })
      } catch {
        throw new ApiError('offline', $t('Сервер недоступен: нет сети или неверный адрес'))
      }
      if (res.status === 401) throw new ApiError('auth', $t('Вход устарел: войди снова'))
      if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        throw new ApiError('server', $t('Сервер не умеет мгновенную доставку: обнови его'))
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let name = ''
      let data = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          alive()
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('event:')) name = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
            else if (line === '' && name) {
              // Пустая строка закрывает событие
              let parsed: unknown = null
              try {
                parsed = data ? JSON.parse(data) : null
              } catch {
                /* старый сервер или обрезанные данные — событие без данных */
              }
              const ev = name
              name = ''
              data = ''
              try {
                onEvent(ev, parsed)
              } catch (e) {
                console.warn('live event failed', ev, e)
              }
            }
          }
        }
      } catch {
        // Оборвалось посреди потока — для вызывающего это просто «поток закрылся»
        return
      }
    } finally {
      clearTimeout(watchdog)
      signal.removeEventListener('abort', stop)
    }
  }
}
