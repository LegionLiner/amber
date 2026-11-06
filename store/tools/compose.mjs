// Картинки для Google Play из скриншотов store/raw (их снимает браузерная версия с демо-медиатекой).
// node store/tools/compose.mjs [phone|tab7|tab10|feature]  (нужен puppeteer-core и Edge; вход — store/raw/<lang>/<size>-<name>.png)
// Выход — store/play/<lang>/…: телефон 1080×1920, планшет 7″ 1080×1920, планшет 10″ 1440×2560, графика 1024×500.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const store = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/')
/** Тире не уезжает в начало строки */
const nb = (s) => s.replace(/ — /g, '&nbsp;— ')

/** Сюжеты: какой скриншот, цвет свечения и подписи */
const SLIDES = [
  {
    shot: 'player',
    glow: ['#3fa37a', '#e8a13c'],
    ru: { kicker: 'Amber', title: 'Твоя музыка.<br><em>Твоя история.</em>', sub: 'Плеер для своих mp3, который помнит каждое прослушивание' },
    en: { kicker: 'Amber', title: 'Your music.<br><em>Your story.</em>', sub: 'A player for your own music that remembers every listen' },
  },
  {
    shot: 'chronicle',
    glow: ['#ffb23e', '#e8681e'],
    ru: { kicker: 'Хроника', title: 'Каждый день — <em>в календаре</em>', sub: 'Время, серии, любимые часы, эпохи и дневник' },
    en: { kicker: 'Chronicle', title: 'Every day <em>on a calendar</em>', sub: 'Time, streaks, favorite hours, eras and a diary' },
  },
  {
    shot: 'recap-top',
    glow: ['#8e6cf0', '#3fa37a'],
    ru: { kicker: 'Итоги', title: 'Месяц и год — <em>историями</em>', sub: 'Трек года, топ‑10, открытия — и любой слайд картинкой' },
    en: { kicker: 'Recaps', title: 'Your year <em>as a story</em>', sub: 'Track of the year, top 10, discoveries — save any slide as an image' },
  },
  {
    shot: 'sound',
    glow: ['#e8a13c', '#c34a5a'],
    ru: { kicker: 'Звук', title: 'Slowed, эхо, <em>«за стеной»</em>', sub: 'Восемь эффектов с силой каждого, эквалайзер и кроссфейд' },
    en: { kicker: 'Sound', title: 'Slowed, echo, <em>“next door”</em>', sub: 'Eight effects with their own strength, equalizer and crossfade' },
  },
  {
    shot: 'top',
    glow: ['#ffb23e', '#5b7fd6'],
    ru: { kicker: 'Рейтинг', title: 'Личный топ <em>и дуэли</em>', sub: 'Оценки с половинками звёзд, а спорные места решает дуэль' },
    en: { kicker: 'Ratings', title: 'Your top <em>and duels</em>', sub: 'Half-star ratings, and duels settle the close calls' },
  },
  {
    shot: 'stage',
    phoneOnly: true, // на планшете это просто огромная обложка
    glow: ['#3fa37a', '#1d6b7a'],
    ru: { kicker: 'Сцена', title: 'Только обложка <em>и свет</em>', sub: 'Мягкие краски обложки дышат в такт музыке' },
    en: { kicker: 'Stage', title: 'Just the cover <em>and light</em>', sub: "The cover's soft colors breathe with the music" },
  },
  {
    shot: 'home',
    glow: ['#ffb23e', '#8e6cf0'],
    ru: { kicker: 'Подборки', title: 'Умный микс <em>и моё радио</em>', sub: 'Любимое, забытое и новое — вперемешку, без конца' },
    en: { kicker: 'Mixes', title: 'Smart mix <em>and my radio</em>', sub: 'Favorites, forgotten gems and new finds — endlessly' },
  },
  {
    shot: null,
    glow: ['#4fc08d', '#ffb23e'],
    ru: { kicker: 'Телефон и компьютер', title: 'Одна медиатека <em>по Wi‑Fi</em>', sub: 'Без облака и аккаунтов — напрямую, дома' },
    en: { kicker: 'Phone and computer', title: 'One library <em>over Wi‑Fi</em>', sub: 'No cloud, no accounts — directly, at home' },
  },
]

/** Знак Amber «A-волна» — тот же, что у приложения (store/src/logos.html, #e-monogram) */
const DROP = (size) => `<svg viewBox="76 56 360 400" width="${size}" height="${size}" style="display:block;overflow:visible;flex:none;filter:drop-shadow(0 0 30px rgba(255,160,60,.45))">
  <defs><linearGradient id="dr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".5" stop-color="#ffb23e"/><stop offset="1" stop-color="#e8681e"/></linearGradient></defs>
  <path d="M128 412 L256 104 L384 412" fill="none" stroke="url(#dr)" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="166,318 200,318 220,284 244,346 268,272 290,336 310,318 346,318" fill="none" stroke="#fff3df" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const ICON = {
  sync: '<path d="M4 10a8 8 0 0 1 14.3-4.3L20 8M20 14a8 8 0 0 1-14.3 4.3L4 16"/><path d="M20 3v5h-5M4 21v-5h5"/>',
  play: '<path d="M3 7h6M3 12h4M3 17h6"/><path d="M12 5.5l9 6.5-9 6.5z"/>',
  note: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
}

/** Слайд «телефон и компьютер»: ноутбук, телефон, связь и три обещания. Размеры в em, 1em = масштаб макета */
function bridge(lang, playerImg) {
  const L =
    lang === 'ru'
      ? {
          pc: 'Amber для&nbsp;Windows',
          free: 'бесплатно',
          rows: [
            ['sync', 'Оценки, история, плейлисты и&nbsp;дневник&nbsp;— общие'],
            ['play', 'Начал на компьютере&nbsp;— продолжи на&nbsp;телефоне с&nbsp;того же места'],
            ['note', 'Новая музыка из&nbsp;папки на&nbsp;компьютере приходит сама'],
          ],
        }
      : {
          pc: 'Amber for&nbsp;Windows',
          free: 'free',
          rows: [
            ['sync', 'Ratings, history, playlists and the&nbsp;diary&nbsp;— shared'],
            ['play', 'Started on the computer&nbsp;— continue on your phone from the&nbsp;same spot'],
            ['note', 'New music from the folder on your computer arrives by&nbsp;itself'],
          ],
        }
  const phoneW = 250
  const phoneH = Math.round(phoneW * (2532 / 1170))
  return `
  <div style="height:100%;display:flex;flex-direction:column;justify-content:center;gap:64em">
    <div style="position:relative;height:${phoneH + 90}em">
      <!-- ноутбук -->
      <div style="position:absolute;left:0;top:90em;width:690em">
        <div style="height:430em;border-radius:26em;background:#050505;padding:16em;box-shadow:0 0 0 2px #2b2722,0 50px 100px -30px #000">
          <div style="height:100%;border-radius:12em;background:radial-gradient(70% 80% at 50% 45%,#3a2410,#141110 70%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22em">
            ${DROP('150em')}
            <div style="font:700 44em/1 Unbounded,system-ui;letter-spacing:-.03em;color:#f5f1ea;text-align:center">${L.pc}</div>
            <div style="font:500 26em/1 Onest,system-ui;color:#ffb23e;letter-spacing:.12em;text-transform:uppercase">${L.free}</div>
          </div>
        </div>
        <div style="margin:0 -46em;height:26em;border-radius:0 0 22em 22em;background:linear-gradient(#2b2722,#141210);box-shadow:0 30px 60px -20px #000"></div>
      </div>
      <!-- связь -->
      <svg viewBox="0 0 950 ${phoneH + 90}" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible" fill="none">
        <path d="M470 84 C 500 20, 560 4, 600 8" stroke="#ffb23e" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 14"/>
        <path d="M724 8 C 770 12, 800 40, 812 84" stroke="#ffb23e" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 14"/>
      </svg>
      <div style="position:absolute;left:606em;top:-47em;width:112em;height:112em;border-radius:50%;background:#16251d;box-shadow:0 0 0 3px #4fc08d55,0 0 60px rgba(79,192,141,.35);display:grid;place-items:center">
        <svg viewBox="0 0 24 24" width="60em" height="60em" fill="none" stroke="#4fc08d" stroke-width="2.2" stroke-linecap="round"><path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1.2" fill="#4fc08d" stroke="none"/></svg>
      </div>
      <!-- телефон -->
      <div style="position:absolute;right:0;top:90em;width:${phoneW + 20}em;height:${phoneH + 20}em;padding:10em;border-radius:46em;background:#050505;box-shadow:0 0 0 2px #2b2722,0 50px 100px -30px #000,0 0 160px -40px rgba(255,160,50,.4)">
        <img src="${playerImg}" style="display:block;width:100%;height:100%;object-fit:cover;border-radius:36em">
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:18em">
      ${L.rows
        .map(
          ([ic, t]) => `<div style="display:flex;align-items:center;gap:28em;padding:26em 34em;border-radius:30em;background:rgba(255,255,255,.045);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)">
        <span style="flex:none;width:76em;height:76em;border-radius:22em;background:rgba(255,178,62,.14);display:grid;place-items:center">
          <svg viewBox="0 0 24 24" width="40em" height="40em" fill="none" stroke="#ffb23e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[ic]}</svg></span>
        <span style="font:500 33em/1.3 Onest,system-ui;color:#f5f1ea;text-wrap:pretty">${t}</span></div>`,
        )
        .join('')}
    </div>
  </div>`
}

/** Графика 1024×500: знак, название, обещание и два телефона */
function feature(lang, a, b) {
  const line = lang === 'ru' ? 'Музыка, которая <em>помнит</em>' : 'Music that <em>remembers</em>'
  const sub = lang === 'ru' ? 'Плеер для своих mp3 · без рекламы' : 'A player for your own music · no ads'
  return `
  <div style="position:absolute;inset:0;background:radial-gradient(60% 90% at 78% 40%, #ff9f3a44, transparent 70%),radial-gradient(50% 80% at 10% 100%, #8e6cf033, transparent 70%),#0e0d0c"></div>
  <div class="grain"></div>
  <div style="position:absolute;left:56px;top:112px;width:560px">
    <div style="display:flex;align-items:center;gap:10px">
      ${DROP('96px')}
      <span style="font:700 76px/1 Unbounded,system-ui;letter-spacing:-.04em;color:#f5f1ea">Amber</span>
    </div>
    <h1 style="font-size:46px;margin-top:28px">${line}</h1>
    <p style="font:500 24px/1.3 Onest,system-ui;color:#c9bfb1;margin-top:14px">${sub}</p>
  </div>
  <div style="position:absolute;right:232px;top:60px;width:230px;height:500px;border-radius:34px;padding:9px;background:#050505;box-shadow:0 0 0 2px #2b2722,0 40px 80px -20px #000;transform:rotate(-8deg)">
    <img src="${b}" style="width:100%;height:100%;object-fit:cover;object-position:top;border-radius:26px">
  </div>
  <div style="position:absolute;right:40px;top:30px;width:250px;height:540px;border-radius:36px;padding:10px;background:#050505;box-shadow:0 0 0 2px #2b2722,0 40px 80px -20px #000,0 0 120px -20px rgba(255,160,50,.4);transform:rotate(6deg)">
    <img src="${a}" style="width:100%;height:100%;object-fit:cover;object-position:top;border-radius:27px">
  </div>`
}

const b = await puppeteer.launch({ executablePath: EDGE, headless: true })
const p = await b.newPage()
await p.goto(fileUrl(path.join(store, 'src/frame.html')), { waitUntil: 'networkidle0' })
// Шрифты грузятся только когда нужны — без этого первая раскладка мерится по запасному шрифту
await p.evaluate(() =>
  Promise.all(['700 76px Unbounded', '600 76px Unbounded', '400 36px Onest', '500 36px Onest', '600 26px Onest', '700 36px Onest'].map((f) => document.fonts.load(f, 'АаZz'))),
)

async function shot(file, w, h) {
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  await p.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r))))))
  await new Promise((r) => setTimeout(r, 150))
  const el = await p.$('#shot')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await el.screenshot({ path: file })
  console.log(path.relative(store, file), `${Math.round(fs.statSync(file).size / 1024)} КБ`)
}

const SIZES = [
  { id: 'phone', w: 1080, h: 1920, device: 'phone', ratio: 2532 / 1170, slides: SLIDES },
  { id: 'tab7', w: 1080, h: 1920, device: 'tablet', ratio: 2000 / 1200, slides: SLIDES.filter((s) => !s.phoneOnly) },
  { id: 'tab10', w: 1440, h: 2560, device: 'tablet', ratio: 2560 / 1600, slides: SLIDES.filter((s) => !s.phoneOnly) },
]
const only = process.argv[2] // phone | tab7 | tab10 | feature — переделать один вид
for (const lang of ['ru', 'en']) {
  const raw = (size, name) => fileUrl(path.join(store, 'raw', lang, `${size}-${name}.png`))
  for (const sz of SIZES) {
    if (only && only !== sz.id) continue
    fs.rmSync(path.join(store, 'play', lang, sz.id), { recursive: true, force: true })
    let n = 0
    for (const s of sz.slides) {
      n++
      const txt = s[lang]
      await p.setViewport({ width: sz.w, height: sz.h, deviceScaleFactor: 1 })
      await p.evaluate((o) => window.render(o), {
        w: sz.w,
        h: sz.h,
        kicker: txt.kicker,
        title: nb(txt.title),
        sub: nb(txt.sub),
        glow: s.glow,
        device: s.shot ? sz.device : 'none',
        ratio: sz.ratio,
        img: s.shot ? raw(sz.id, s.shot) : null,
        art: s.shot ? null : bridge(lang, raw('phone', 'player')),
      })
      await shot(path.join(store, 'play', lang, sz.id, `${String(n).padStart(2, '0')}-${s.shot ?? 'wifi'}.png`), sz.w, sz.h)
    }
  }
  if (only && only !== 'feature') continue
  // Графика 1024×500
  await p.evaluate((html) => {
    const s = document.getElementById('shot')
    s.style.width = '1024px'
    s.style.height = '500px'
    s.innerHTML = html
  }, feature(lang, raw('phone', 'player'), raw('phone', 'recap-top')))
  await shot(path.join(store, 'play', lang, `feature-1024x500.png`), 1024, 500)
}
await b.close()
