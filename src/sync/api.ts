import type { SyncItem } from './kinds'
import type { SyncResponse } from './engine'

/** Запросы к серверу Amber (server/). Ошибки — с текстом для человека и видом: нет сети, нужно войти, прочее */

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
      throw new ApiError('offline', 'Сервер недоступен: нет сети или неверный адрес')
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
      const msg = (data as { error?: string } | null)?.error ?? `Сервер ответил ${res.status}`
      throw new ApiError(res.status === 401 ? 'auth' : 'server', msg)
    }
    if (data == null) throw new ApiError('server', 'По этому адресу не сервер Amber')
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
}
