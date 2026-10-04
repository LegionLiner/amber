import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Пароли — scrypt из стандартной библиотеки Node (без нативных модулей в образе).
 * Строка в базе: scrypt$N$r$p$соль$хеш, параметры хранятся рядом — их можно усилить, старые пароли продолжат работать.
 *
 * Вход выдаёт устройству токен: 32 случайных байта. В базе лежит только его SHA-256, так что утечка базы
 * не даёт войти. Выйти на устройстве — удалить строку устройства.
 */
const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const key = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p))
  return key.length === expected.length && timingSafeEqual(key, expected)
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
