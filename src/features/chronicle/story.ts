import type { Recap } from '@/data/repos/recap'
import type { Track } from '@/domain/track'
import { countLabel, formatListen } from '@/domain/format'
import { dayLabel } from '@/domain/weeks'

/**
 * Слайды итогов. Одна структура и для экрана, и для картинки:
 * надпись сверху, крупное, строки, обложка.
 */
export interface Slide {
  kicker: string
  big: string
  title?: string
  lines: string[]
  cover?: Track | null
  list?: { n: number; title: string; sub: string; right: string; track?: Track }[]
  colors: [string, string]
}

const GRADS: [string, string][] = [
  ['#ff9a3e', '#7a2e12'],
  ['#8e6cf0', '#1d1640'],
  ['#2fbf8f', '#0f3a31'],
  ['#e5484d', '#3c0f14'],
  ['#3e9bff', '#0e2244'],
  ['#c9b458', '#3a3212'],
]

export function buildSlides(r: Recap, title: string, byKey: Map<string, Track>): Slide[] {
  const top = r.top.flatMap((x) => {
    const t = byKey.get(x.key)
    return t ? [{ t, plays: x.plays, ms: x.listenedMs }] : []
  })
  const artists = new Map<string, number>()
  for (const x of top)
    for (const a of x.t.artists.length ? x.t.artists : [x.t.artist]) if (a) artists.set(a, (artists.get(a) ?? 0) + x.plays)
  const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const disc = r.discoveries.map((k) => byKey.get(k)).filter((t): t is Track => !!t)
  const bestDisc = disc.map((t) => ({ t, p: top.find((x) => x.t.key === t.key)?.plays ?? 0 })).sort((a, b) => b.p - a.p)[0]
  const days = r.activeDays.length
  const minutes = Math.round(r.listenedMs / 60_000)
  const g = (i: number) => GRADS[i % GRADS.length]!
  const slides: Slide[] = [
    {
      kicker: 'Итоги',
      big: title,
      lines: [
        `${minutes.toLocaleString('ru-RU')} минут музыки`,
        `${countLabel(r.plays, ['прослушивание', 'прослушивания', 'прослушиваний'])}`,
      ],
      colors: g(0),
    },
    {
      kicker: 'Время',
      big: formatListen(r.listenedMs),
      lines: [
        `${countLabel(days, ['день', 'дня', 'дней'])} с музыкой`,
        days ? `в среднем ${Math.round(minutes / days)} мин в такой день` : '',
        `${countLabel(r.tracks, ['разный трек', 'разных трека', 'разных треков'])}`,
      ].filter(Boolean),
      colors: g(1),
    },
  ]
  if (top[0]) {
    slides.push({
      kicker: 'Трек периода',
      big: top[0].t.title,
      title: top[0].t.artist,
      lines: [`${countLabel(top[0].plays, ['раз', 'раза', 'раз'])} · ${formatListen(top[0].ms)}`],
      cover: top[0].t,
      colors: g(2),
    })
    slides.push({
      kicker: 'Топ-5',
      big: 'Чаще всего',
      lines: [],
      list: top.slice(0, 5).map((x, i) => ({ n: i + 1, title: x.t.title, sub: x.t.artist, right: `${x.plays}×`, track: x.t })),
      colors: g(3),
    })
  }
  if (topArtists.length) {
    slides.push({
      kicker: 'Исполнители',
      big: topArtists[0]![0],
      lines: [],
      list: topArtists.map(([name, n], i) => ({ n: i + 1, title: name, sub: '', right: `${n}×` })),
      colors: g(4),
    })
  }
  slides.push({
    kicker: 'Открытия',
    big: countLabel(disc.length, ['новый трек', 'новых трека', 'новых треков']),
    lines: [
      bestDisc ? `Главное открытие — «${bestDisc.t.title}»` : 'Новое ещё впереди',
      r.newFavorites ? `${countLabel(r.newFavorites, ['трек', 'трека', 'треков'])} в избранное` : '',
    ].filter(Boolean),
    cover: bestDisc?.t ?? null,
    colors: g(5),
  })
  slides.push({
    kicker: 'Когда',
    big: r.peakHour != null ? `${r.peakHour}:00` : '—',
    title: 'любимый час',
    lines: [
      r.busiestDay ? `Самый музыкальный день — ${dayLabel(r.busiestDay.day)}: ${formatListen(r.busiestDay.listenedMs)}` : '',
    ].filter(Boolean),
    colors: g(0),
  })
  return slides
}

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

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Слайд в картинку 1080×1920 (PNG, base64 без префикса) */
export async function renderSlide(s: Slide, coverUrl: string | null, footer: string): Promise<string> {
  const W = 1080
  const H = 1920
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H)
  bg.addColorStop(0, s.colors[0])
  bg.addColorStop(1, s.colors[1])
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  // Мягкий «перламутр» по диагонали
  const sheen = ctx.createLinearGradient(0, H * 0.2, W, H * 0.6)
  sheen.addColorStop(0, 'rgba(255,255,255,0)')
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.10)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, W, H)

  const pad = 96
  let y = 220
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = '600 44px Onest, system-ui, sans-serif'
  ctx.fillText(s.kicker.toUpperCase(), pad, y)
  y += 60

  if (coverUrl) {
    const img = await loadImage(coverUrl)
    if (img) {
      const size = 620
      const x = (W - size) / 2
      y += 30
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.45)'
      ctx.shadowBlur = 60
      ctx.shadowOffsetY = 24
      ctx.beginPath()
      ctx.roundRect(x, y, size, size, 40)
      ctx.clip()
      ctx.drawImage(img, x, y, size, size)
      ctx.restore()
      y += size + 60
    }
  }

  ctx.fillStyle = '#fff'
  ctx.font = '700 104px Unbounded, system-ui, sans-serif'
  for (const l of wrap(ctx, s.big, W - pad * 2).slice(0, 3)) {
    y += 116
    ctx.fillText(l, pad, y)
  }
  if (s.title) {
    y += 70
    ctx.font = '500 52px Onest, system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(s.title, pad, y)
  }
  ctx.font = '500 46px Onest, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  for (const line of s.lines) {
    for (const l of wrap(ctx, line, W - pad * 2)) {
      y += 70
      ctx.fillText(l, pad, y)
    }
  }
  if (s.list) {
    y += 40
    for (const it of s.list) {
      y += 120
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.font = '700 56px Unbounded, system-ui, sans-serif'
      ctx.fillText(String(it.n), pad, y)
      ctx.fillStyle = '#fff'
      ctx.font = '600 50px Onest, system-ui, sans-serif'
      const t = wrap(ctx, it.title, W - pad * 2 - 260)[0] ?? ''
      ctx.fillText(t, pad + 100, y - (it.sub ? 16 : 0))
      if (it.sub) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.font = '500 38px Onest, system-ui, sans-serif'
        ctx.fillText(wrap(ctx, it.sub, W - pad * 2 - 260)[0] ?? '', pad + 100, y + 34)
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = '600 44px Onest, system-ui, sans-serif'
      const rw = ctx.measureText(it.right).width
      ctx.fillText(it.right, W - pad - rw, y)
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.65)'
  ctx.font = '600 40px Unbounded, system-ui, sans-serif'
  ctx.fillText('Amber', pad, H - 120)
  ctx.font = '500 34px Onest, system-ui, sans-serif'
  const fw = ctx.measureText(footer).width
  ctx.fillText(footer, W - pad - fw, H - 120)
  return c.toDataURL('image/png').split(',')[1]!
}
