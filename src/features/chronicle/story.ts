import type { Recap } from '@/data/repos/recap'
import type { Track } from '@/domain/track'
import { countLabel, formatListen } from '@/domain/format'
import { dayLabel } from '@/domain/weeks'
import { splitArtists } from '@/domain/names'
import { hexToLch, lchHex } from '@/domain/cover-colors'
import { coverPair } from '@/domain/palette'
import { LOCALE, $t, $tp } from '@/i18n'

/**
 * Слайды итогов. Одна структура и для экрана (StoryViewer), и для картинки (renderSlide).
 *
 * Вид слайда (kind) задаёт раскладку: обложки стеной (intro), крупное число (stat), трек (track),
 * пьедестал из трёх обложек и список (list), веер открытий (discover), часы суток (when).
 * Цвет слайда — по обложке его трека (accent): трек периода, первое место топа, главное открытие; у остальных —
 * по очереди обложки топа. Сами краски считает StoryViewer (по картинке обложки), здесь — их тёмная основа
 * для белого текста (slideTones).
 */
export type SlideKind = 'intro' | 'stat' | 'track' | 'list' | 'discover' | 'when'

export interface SlideItem {
  n: number
  title: string
  sub: string
  right: string
  track?: Track
}

export interface Slide {
  kind: SlideKind
  kicker: string
  big: string
  title?: string
  lines: string[]
  cover?: Track | null
  list?: SlideItem[]
  /** Обложки для стены (intro) или веера (discover) */
  collage?: Track[]
  /** Минуты по часам суток (when) */
  hours?: number[]
  /** Трек, по обложке которого раскрашен слайд */
  accent?: Track | null
  /** Запасная пара цветов (без обложек) */
  colors: [string, string]
}

/** Краски слайда: тёмная основа (для белого текста) и два световых пятна */
export interface SlideTones {
  bg1: string
  bg2: string
  g1: string
  g2: string
}

/**
 * Из пары тонов обложки (средней яркости) — тёмная основа: верх заметно темнее середины, низ почти чёрный,
 * но того же оттенка; пятна — сами тоны. Серое остаётся серым, кислотное — приглушается
 */
export function slideTones(pair: readonly [string, string]): SlideTones {
  const a = hexToLch(pair[0]) ?? { L: 0.6, C: 0.1, h: 1 }
  const b = hexToLch(pair[1]) ?? a
  return {
    bg1: lchHex(0.36, Math.min(0.14, a.C * 0.9), a.h),
    bg2: lchHex(0.14, Math.min(0.06, b.C * 0.6), b.h),
    g1: lchHex(Math.min(0.72, Math.max(0.55, a.L)), Math.min(0.2, a.C * 1.05), a.h),
    g2: lchHex(Math.min(0.7, Math.max(0.5, b.L)), Math.min(0.18, b.C), b.h),
  }
}

/** Тоны без обложки: сохранённые движком цвета трека или генеративная пара по названию */
export function fallbackPair(t: Track | null | undefined): [string, string] {
  if (t?.color1) return [t.color1, t.color2 ?? t.color1]
  return coverPair(t?.title ?? 'amber')
}

export function buildSlides(r: Recap, title: string, byKey: Map<string, Track>): Slide[] {
  const pick = (rows: { key: string; plays: number; listenedMs: number }[]) =>
    rows.flatMap((x) => {
      const t = byKey.get(x.key)
      return t ? [{ t, plays: x.plays, ms: x.listenedMs }] : []
    })
  /** Чаще всего — по числу прослушиваний; больше всего — по минутам */
  const top = pick(r.top)
  const byTime = pick(r.topByTime)
  // Исполнители — по всем трекам периода: как в медиатеке (с правками тегов), а у трека не из неё — по его тегам
  const artists = new Map<string, number>()
  for (const x of r.artistRows) {
    const names = byKey.get(x.key)?.artists ?? splitArtists(x.artist)
    for (const a of names) if (a) artists.set(a, (artists.get(a) ?? 0) + x.plays)
  }
  const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  /** Обложка исполнителя на слайде — его самый звучавший трек */
  const artistTrack = (name: string) => [...byTime, ...top].find((x) => x.t.artists.includes(name))?.t
  const disc = r.discoveries.map((k) => byKey.get(k)).filter((t): t is Track => !!t)
  const bestDisc = disc.map((t) => ({ t, p: top.find((x) => x.t.key === t.key)?.plays ?? 0 })).sort((a, b) => b.p - a.p)[0]
  const days = r.activeDays.length
  const minutes = Math.round(r.listenedMs / 60_000)
  // Трек периода — тот, что звучал дольше всех: длинный трек на пять раз весит больше короткой заставки на повторе
  const best = byTime[0] ?? top[0]

  /** Обложки периода без повторов: по минутам, потом по разам — для стены и для цвета «безобложечных» слайдов */
  const pool: Track[] = []
  for (const x of [...byTime, ...top]) if (!pool.some((t) => t.key === x.t.key)) pool.push(x.t)
  let next = 0
  const fromPool = () => (pool.length ? pool[next++ % pool.length]! : null)
  const colors = (t: Track | null | undefined) => fallbackPair(t)

  const slides: Slide[] = []
  const introAccent = fromPool()
  slides.push({
    kind: 'intro',
    kicker: $t('Итоги'),
    big: title,
    lines: [
      $t('{0} минут музыки', minutes.toLocaleString(LOCALE)),
      `${countLabel(r.plays, $tp('прослушивание|прослушивания|прослушиваний'))}`,
    ],
    collage: pool.slice(0, 12),
    accent: introAccent,
    colors: colors(introAccent),
  })
  const statAccent = fromPool()
  slides.push({
    kind: 'stat',
    kicker: $t('Время'),
    big: formatListen(r.listenedMs),
    lines: [
      $t('{0} с музыкой', countLabel(days, $tp('день|дня|дней'))),
      days ? $t('в среднем {0} мин в такой день', Math.round(minutes / days)) : '',
      `${countLabel(r.tracks, $tp('разный трек|разных трека|разных треков'))}`,
    ].filter(Boolean),
    accent: statAccent,
    colors: colors(statAccent),
  })
  if (best) {
    slides.push({
      kind: 'track',
      kicker: $t('Трек периода'),
      big: best.t.title,
      title: best.t.artist,
      lines: [`${formatListen(best.ms)} · ${countLabel(best.plays, $tp('раз|раза|раз'))}`],
      cover: best.t,
      accent: best.t,
      colors: colors(best.t),
    })
  }
  if (top.length) {
    slides.push({
      kind: 'list',
      kicker: $t('Топ-10'),
      big: $t('Чаще всего'),
      lines: [],
      list: top.slice(0, 10).map((x, i) => ({ n: i + 1, title: x.t.title, sub: x.t.artist, right: `${x.plays}×`, track: x.t })),
      accent: top[0]!.t,
      colors: colors(top[0]!.t),
    })
  }
  if (byTime.length) {
    // Первое место по минутам — обычно тот же трек периода: красим следующей обложкой, чтобы слайды не слились
    const accent = byTime[1]?.t ?? byTime[0]!.t
    slides.push({
      kind: 'list',
      kicker: $t('Топ-10 по минутам'),
      big: $t('Больше всего'),
      lines: [],
      list: byTime.slice(0, 10).map((x, i) => ({
        n: i + 1,
        title: x.t.title,
        sub: x.t.artist,
        right: $t('{0} мин', Math.max(1, Math.round(x.ms / 60_000)).toLocaleString(LOCALE)),
        track: x.t,
      })),
      accent,
      colors: colors(accent),
    })
  }
  if (topArtists.length) {
    const accent = artistTrack(topArtists[0]![0]) ?? fromPool()
    slides.push({
      kind: 'list',
      kicker: $t('Исполнители'),
      big: topArtists[0]![0],
      lines: [],
      list: topArtists.map(([name, n], i) => ({ n: i + 1, title: name, sub: '', right: `${n}×`, track: artistTrack(name) })),
      accent,
      colors: colors(accent),
    })
  }
  const discAccent = bestDisc?.t ?? fromPool()
  slides.push({
    kind: 'discover',
    kicker: $t('Открытия'),
    big: countLabel(disc.length, $tp('новый трек|новых трека|новых треков')),
    lines: [
      bestDisc ? $t('Главное открытие — «{0}»', bestDisc.t.title) : $t('Новое ещё впереди'),
      r.newFavorites ? $t('{0} в избранное', countLabel(r.newFavorites, $tp('трек|трека|треков'))) : '',
    ].filter(Boolean),
    cover: bestDisc?.t ?? null,
    collage: disc.slice(0, 5),
    accent: discAccent,
    colors: colors(discAccent),
  })
  const whenAccent = fromPool()
  slides.push({
    kind: 'when',
    kicker: $t('Когда'),
    big: r.peakHour != null ? `${r.peakHour}:00` : '—',
    title: $t('любимый час'),
    lines: [
      r.busiestDay
        ? $t('Самый музыкальный день — {0}: {1}', dayLabel(r.busiestDay.day), formatListen(r.busiestDay.listenedMs))
        : '',
    ].filter(Boolean),
    hours: r.hours,
    accent: whenAccent,
    colors: colors(whenAccent),
  })
  return slides
}

/* ---------------- картинка 1080×1920 ---------------- */

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/)
  const out: string[] = []
  let line = ''
  for (const w of words) {
    const t = line ? `${line} ${w}` : w
    if (ctx.measureText(t).width > maxW && line) {
      out.push(line)
      line = w
    } else line = t
  }
  if (line) out.push(line)
  return out
}

/** Строка в ширину с многоточием */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

function loadImage(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Обложка в скруглённом квадрате; нет картинки — градиент по названию */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  t: Track | undefined,
  x: number,
  y: number,
  size: number,
  r: number,
  shadow = true,
) {
  ctx.save()
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = size * 0.12
    ctx.shadowOffsetY = size * 0.05
  }
  ctx.beginPath()
  ctx.roundRect(x, y, size, size, r)
  ctx.fillStyle = '#000'
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, size, size, r)
  ctx.clip()
  if (img) ctx.drawImage(img, x, y, size, size)
  else {
    const [a, b] = fallbackPair(t)
    const g = ctx.createLinearGradient(x, y, x + size, y + size)
    g.addColorStop(0, a)
    g.addColorStop(1, b)
    ctx.fillStyle = g
    ctx.fillRect(x, y, size, size)
  }
  ctx.restore()
}

/** Слайд в картинку 1080×1920 (PNG, base64 без префикса). coverUrl — адрес обложки трека */
export async function renderSlide(
  s: Slide,
  tones: SlideTones,
  coverUrl: (t: Track) => string | null,
  footer: string,
): Promise<string> {
  const W = 1080
  const H = 1920
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const bg = ctx.createLinearGradient(0, 0, W * 0.35, H)
  bg.addColorStop(0, tones.bg1)
  bg.addColorStop(1, tones.bg2)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  // Световые пятна, как живой фон на экране
  const spots: [number, number, number, string, number][] = [
    [W * 0.15, H * 0.12, W * 0.75, tones.g1, 0.55],
    [W * 0.95, H * 0.55, W * 0.7, tones.g2, 0.4],
    [W * 0.3, H * 0.95, W * 0.6, tones.g1, 0.3],
  ]
  for (const [x, y, r, col, a] of spots) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, col)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = a
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
  ctx.globalAlpha = 1

  const pad = 96
  const inner = W - pad * 2
  const img = (t: Track | null | undefined) => loadImage(t ? coverUrl(t) : null)
  let y = 200
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = '600 40px Onest, system-ui, sans-serif'
  ctx.fillText(s.kicker.toUpperCase(), pad, y)
  y += 40

  if (s.kind === 'intro' && s.collage?.length) {
    // Стена обложек: 3 × 3, чуть повёрнута
    const tracks = s.collage.slice(0, 9)
    const imgs = await Promise.all(tracks.map(img))
    const size = 268
    const gap = 22
    ctx.save()
    ctx.translate(W / 2, y + 470)
    ctx.rotate(-0.07)
    tracks.forEach((t, i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      drawCover(ctx, imgs[i] ?? null, t, (col - 1.5) * (size + gap) + gap / 2, (row - 1.5) * (size + gap) + gap / 2, size, 26)
    })
    ctx.restore()
    y += 990
  } else if ((s.kind === 'track' || s.kind === 'discover') && s.cover) {
    const size = 600
    if (s.kind === 'discover' && s.collage && s.collage.length > 1) {
      const others = s.collage.filter((t) => t.key !== s.cover!.key).slice(0, 2)
      const im = await Promise.all(others.map(img))
      others.forEach((t, i) => {
        ctx.save()
        ctx.translate(W / 2 + (i ? 190 : -190), y + 60 + size / 2)
        ctx.rotate(i ? 0.14 : -0.14)
        ctx.globalAlpha = 0.85
        drawCover(ctx, im[i] ?? null, t, -size * 0.38, -size * 0.38, size * 0.76, 34)
        ctx.restore()
      })
    }
    drawCover(ctx, await img(s.cover), s.cover, (W - size) / 2, y + 60, size, 44)
    y += size + 120
  }

  // Крупное: число или название
  ctx.fillStyle = '#fff'
  const bigSize = s.kind === 'stat' || s.kind === 'when' ? 190 : s.kind === 'intro' ? 120 : 104
  ctx.font = `700 ${bigSize}px Unbounded, system-ui, sans-serif`
  if (s.kind === 'stat' || s.kind === 'when') y += 260
  for (const l of wrap(ctx, s.big, inner).slice(0, 3)) {
    y += bigSize * 1.08
    ctx.fillText(l, pad, y)
  }
  if (s.title) {
    y += 76
    ctx.font = '500 50px Onest, system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(fit(ctx, s.title, inner), pad, y)
  }
  ctx.font = '500 44px Onest, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  for (const line of s.lines) {
    for (const l of wrap(ctx, line, inner)) {
      y += 66
      ctx.fillText(l, pad, y)
    }
  }

  if (s.kind === 'when' && s.hours) {
    // Часы суток столбиками
    const hours = s.hours
    const max = Math.max(1, ...hours)
    const peak = hours.indexOf(max)
    const top = y + 90
    const h = 300
    const bw = inner / 24
    hours.forEach((v, i) => {
      const bh = Math.max(6, (v / max) * h)
      ctx.fillStyle = i === peak ? '#fff' : 'rgba(255,255,255,0.4)'
      ctx.beginPath()
      ctx.roundRect(pad + i * bw + 3, top + h - bh, bw - 6, bh, 6)
      ctx.fill()
    })
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '500 32px Onest, system-ui, sans-serif'
    for (const i of [0, 6, 12, 18]) ctx.fillText(String(i), pad + i * bw + 4, top + h + 50)
  }

  if (s.list) {
    const items = s.list
    const thumbs = await Promise.all(items.map((it) => img(it.track)))
    // Пьедестал: первые три — крупными обложками
    const podium = items.length >= 3 && items.slice(0, 3).every((x) => x.track)
    if (podium) {
      y += 50
      const big = 300
      const small = 230
      const cx = W / 2
      const places: [number, number, number, number][] = [
        [cx - big / 2 - small - 30, y + 60, small, 1],
        [cx + big / 2 + 30, y + 60, small, 2],
        [cx - big / 2, y, big, 0],
      ]
      for (const [x, yy, size, i] of places) {
        drawCover(ctx, thumbs[i] ?? null, items[i]!.track, x, yy, size, 28)
        ctx.fillStyle = '#fff'
        ctx.font = '700 44px Unbounded, system-ui, sans-serif'
        ctx.fillText(String(i + 1), x + 18, yy + size - 18)
      }
      y += big + 40
      ctx.font = '600 40px Onest, system-ui, sans-serif'
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.fillText(fit(ctx, items[0]!.title, inner), W / 2, y + 44)
      ctx.textAlign = 'left'
      y += 60
    }
    for (const it of podium ? items.slice(3) : items) {
      y += 106
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = '700 40px Unbounded, system-ui, sans-serif'
      ctx.fillText(String(it.n), pad, y)
      if (it.track) drawCover(ctx, thumbs[items.indexOf(it)] ?? null, it.track, pad + 76, y - 62, 80, 14, false)
      const tx = pad + (it.track ? 180 : 80)
      ctx.font = '600 40px Onest, system-ui, sans-serif'
      const rw = ctx.measureText(it.right).width
      ctx.fillStyle = '#fff'
      ctx.font = '600 44px Onest, system-ui, sans-serif'
      ctx.fillText(fit(ctx, it.title, W - pad - rw - 30 - tx), tx, y - (it.sub ? 12 : 0))
      if (it.sub) {
        ctx.fillStyle = 'rgba(255,255,255,0.65)'
        ctx.font = '500 32px Onest, system-ui, sans-serif'
        ctx.fillText(fit(ctx, it.sub, W - pad - rw - 30 - tx), tx, y + 30)
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = '600 40px Onest, system-ui, sans-serif'
      ctx.fillText(it.right, W - pad - rw, y)
    }
  }

  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = '600 40px Unbounded, system-ui, sans-serif'
  ctx.fillText('Amber', pad, H - 110)
  ctx.font = '500 34px Onest, system-ui, sans-serif'
  const fw = ctx.measureText(footer).width
  ctx.fillText(footer, W - pad - fw, H - 110)
  return c.toDataURL('image/png').split(',')[1]!
}
