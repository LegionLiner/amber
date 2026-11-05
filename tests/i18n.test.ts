import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN } from '@/i18n/en'

/**
 * Английский перевод полон: каждая строка интерфейса из исходников ($t('…'), $tp('…'), а в файлах,
 * где t/tp импортированы из @/i18n, и t('…'), tp('…')) есть в словаре, с теми же подстановками {n},
 * а формы числа — три через «|».
 */
const ROOT = join(__dirname, '..', 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(name)) out.push(p)
  }
  return out
}

function unescape(s: string): string {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g, (_, e: string) => {
    if (e[0] === 'u' && e.length > 1) return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16))
    if (e === 'n') return '\n'
    if (e === 't') return '\t'
    return e
  })
}

export function collectKeys(): { t: Map<string, string>; tp: Map<string, string> } {
  const t = new Map<string, string>()
  const tp = new Map<string, string>()
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8')
    const imp = /import \{([^}]*)\} from '(?:@\/i18n|\.\.?\/i18n|\.)'/.exec(src)?.[1] ?? ''
    const bare = /(^|[\s,])t([\s,]|$)/.test(imp)
    const bareP = /(^|[\s,])tp([\s,]|$)/.test(imp)
    const re = /(\$tp|\$t|(?<![\w.$])tp|(?<![\w.$])t)\(\s*'((?:[^'\\\n]|\\.)*)'/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const fn = m[1]!
      if (fn === 't' && !bare) continue
      if (fn === 'tp' && !bareP) continue
      const key = unescape(m[2]!)
      const where = relative(ROOT, file)
      ;(fn.endsWith('p') ? tp : t).set(key, where)
    }
  }
  return { t, tp }
}

const holes = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((x) => x[1]).sort()

describe('i18n', () => {
  const { t, tp } = collectKeys()

  it('находит строки интерфейса', () => {
    expect(t.size).toBeGreaterThan(500)
    expect(tp.size).toBeGreaterThan(10)
  })

  it('у каждой строки есть английский перевод', () => {
    const missing = [...t.keys()].filter((k) => !(k in EN)).map((k) => `${t.get(k)}: ${k}`)
    expect(missing).toEqual([])
  })

  it('подстановки совпадают', () => {
    const bad = [...t.keys()].filter((k) => k in EN && holes(k).join() !== holes(EN[k]!).join())
    expect(bad).toEqual([])
  })

  it('у форм числа по три варианта', () => {
    const missing = [...tp.keys()].filter((k) => !(k in EN))
    expect(missing).toEqual([])
    const bad = [...tp.keys()].filter((k) => k.split('|').length !== 3 || (EN[k] ?? '').split('|').length !== 3)
    expect(bad).toEqual([])
  })

  it('в переводе нет русских слов, кроме цитат из оригинала (голосовые команды, пример поиска)', () => {
    const bad = Object.entries(EN).filter(([k, v]) => (v.match(/[А-Яа-яЁё]+/g) ?? []).some((w) => !k.includes(w)))
    expect(bad).toEqual([])
  })

  it('в словаре нет лишних строк', () => {
    const used = new Set([...t.keys(), ...tp.keys()])
    expect(Object.keys(EN).filter((k) => !used.has(k))).toEqual([])
  })
})
