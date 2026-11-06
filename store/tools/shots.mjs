// Скриншоты для Google Play: браузерная версия (npx vite --port 5179) с демо-медиатекой, наполненной историей и обложками.
// node store/tools/shots.mjs seed   — один раз: демо, обложки, год прослушиваний, оценки, эпохи (профиль Edge во временной папке)
// node store/tools/shots.mjs shoot [phone|tab7|tab10] [ru|en] — экраны → store/raw/<lang>/<size>-<name>.png
// Потом node store/tools/compose.mjs собирает из них картинки для магазина.
import puppeteer from 'puppeteer-core'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const RAW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../raw').split(path.sep).join('/')
const PROFILE = path.join(os.tmpdir(), 'amber-store-edge')
const URL = 'http://localhost:5179/'
const step = process.argv[2] ?? 'shoot'

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  userDataDir: PROFILE,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--hide-scrollbars'],
})
const p = await b.newPage()
p.on('pageerror', (e) => console.log('pageerror', e.message))
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const ev = (code) => p.evaluate(`(async () => { const s = ${S}; ${code} })()`)

async function phone(w, h, dpr) {
  await p.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: true, hasTouch: true })
}

if (step === 'seed') {
  await phone(390, 844, 1)
  await p.goto(URL, { waitUntil: 'networkidle0' })
  await wait(1500)
  // Первый запуск: демо-треки
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /демо|demo/i.test(x.textContent))?.click())
  await wait(5000)
  const r = await p.evaluate(async () => {
    const db = await import('/src/data/db.ts')
    const covers = await import('/src/native/web/web-covers.ts')
    const { localParts } = await import('/src/domain/counting.ts')
    let seed = 1234567
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const pick = (a) => a[Math.floor(rnd() * a.length)]

    // ---------- аккуратные теги у треков без тегов ----------
    const tracks = await db.all('SELECT key, title, artist, album, file_name AS f, duration_ms AS d FROM tracks')
    const ARTISTS = await db.all('SELECT DISTINCT artist, album, genre FROM tracks WHERE artist IS NOT NULL')
    const fixes = []
    for (const t of tracks) {
      if (t.title && t.artist) continue
      const base = t.f.replace(/\.mp3$/, '').replace(/\s*[\[(](zaycev\.net|muzmo\.ru)[\])]\s*/g, '')
      const [maybeArtist, maybeTitle] = base.includes(' - ') ? base.split(' - ') : [null, base]
      const a = ARTISTS.find((x) => x.artist === maybeArtist) ?? pick(ARTISTS)
      fixes.push({ sql: 'UPDATE tracks SET title = ?, artist = ?, album = ?, genre = ? WHERE key = ?', params: [maybeTitle.trim(), a.artist, a.album, a.genre, t.key] })
    }
    if (fixes.length) await db.batch(fixes)

    // ---------- обложки: своя у каждого альбома ----------
    const PAL = [
      ['#1d4b4f', '#d9b26a', '#f3e3c3'], ['#5b1320', '#f08a3c', '#ffd9a8'], ['#101b3a', '#8fb4d9', '#e9f1fb'],
      ['#2b1b2e', '#c9786e', '#f6c9b8'], ['#0f2e24', '#62b38e', '#d8f2e4'], ['#3b2412', '#e8c39a', '#fff1dc'],
      ['#241a3d', '#8e6cf0', '#e6dcff'], ['#3c0f14', '#e5484d', '#ffd3cf'], ['#13252e', '#3e9bff', '#d6ebff'],
      ['#2d2a12', '#c9b458', '#f4ecc0'], ['#1a1a1a', '#e3a13c', '#fbe8c4'], ['#2a1530', '#f06aa8', '#ffd9ea'],
    ]
    function cover(i) {
      const c = document.createElement('canvas')
      c.width = c.height = 600
      const g = c.getContext('2d')
      const [d, m, l] = PAL[i % PAL.length]
      const style = i % 6
      const lin = g.createLinearGradient(0, 0, 600, 600)
      lin.addColorStop(0, d)
      lin.addColorStop(1, style % 2 ? m : d)
      g.fillStyle = lin
      g.fillRect(0, 0, 600, 600)
      if (style === 0) {
        // солнце над полосами
        g.fillStyle = m
        g.beginPath(); g.arc(300, 270, 150, 0, Math.PI * 2); g.fill()
        g.fillStyle = d
        for (let y = 300; y < 600; y += 34) g.fillRect(0, y, 600, 8 + (y - 300) / 14)
      } else if (style === 1) {
        // волны
        for (let k = 0; k < 7; k++) {
          g.strokeStyle = k % 2 ? l : d
          g.globalAlpha = 0.55
          g.lineWidth = 18
          g.beginPath()
          for (let x = 0; x <= 600; x += 10) g.lineTo(x, 140 + k * 60 + Math.sin(x / 70 + k) * 28)
          g.stroke()
        }
        g.globalAlpha = 1
      } else if (style === 2) {
        // кольца
        for (let r = 280; r > 20; r -= 32) {
          g.strokeStyle = r % 64 ? m : l
          g.globalAlpha = 0.25 + (280 - r) / 400
          g.lineWidth = 12
          g.beginPath(); g.arc(300, 300, r, 0, Math.PI * 2); g.stroke()
        }
        g.globalAlpha = 1
      } else if (style === 3) {
        // мягкие пятна
        for (const [x, y, r, col] of [[180, 200, 260, m], [430, 380, 240, l], [300, 520, 200, m]]) {
          const rg = g.createRadialGradient(x, y, 0, x, y, r)
          rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)')
          g.fillStyle = rg; g.fillRect(0, 0, 600, 600)
        }
      } else if (style === 4) {
        // арка
        g.fillStyle = m
        g.beginPath(); g.moveTo(150, 600); g.lineTo(150, 300); g.arc(300, 300, 150, Math.PI, 0); g.lineTo(450, 600); g.fill()
        g.fillStyle = l
        g.beginPath(); g.arc(300, 300, 60, 0, Math.PI * 2); g.fill()
      } else {
        // диагональные полосы
        g.save(); g.translate(300, 300); g.rotate(-Math.PI / 5)
        for (let x = -500; x < 500; x += 70) { g.fillStyle = (x / 70) % 2 ? m : l; g.globalAlpha = 0.7; g.fillRect(x, -500, 34, 1000) }
        g.restore(); g.globalAlpha = 1
      }
      // зерно
      const img = g.getImageData(0, 0, 600, 600)
      for (let k = 0; k < img.data.length; k += 4) {
        const n = (rnd() - 0.5) * 22
        img.data[k] += n; img.data[k + 1] += n; img.data[k + 2] += n
      }
      g.putImageData(img, 0, 0)
      return new Promise((res) => c.toBlob(res, 'image/webp', 0.9))
    }
    const albums = await db.all('SELECT DISTINCT artist, album FROM tracks WHERE album IS NOT NULL ORDER BY artist, album')
    const artUpd = []
    for (let i = 0; i < albums.length; i++) {
      const hash = `demoart${String(i).padStart(3, '0')}`
      await covers.saveCover(hash, await cover(i + 3))
      artUpd.push({ sql: 'UPDATE tracks SET art = ? WHERE artist = ? AND album = ?', params: [hash, albums[i].artist, albums[i].album] })
    }
    await db.batch(artUpd)

    // ---------- год прослушиваний ----------
    const all = await db.all('SELECT key, duration_ms AS d FROM tracks ORDER BY key')
    // Любимые звучат чаще: вес по номеру в перемешанном списке
    const order = [...all].sort(() => rnd() - 0.5)
    const weight = order.map((_, i) => 1 / Math.pow(i + 3, 0.9))
    const total = weight.reduce((a, x) => a + x, 0)
    const pickTrack = () => {
      let x = rnd() * total
      for (let i = 0; i < order.length; i++) if ((x -= weight[i]) <= 0) return order[i]
      return order[0]
    }
    const HOURS = [0.2, 0.1, 0.05, 0.02, 0.02, 0.05, 0.3, 0.9, 1.3, 0.9, 0.6, 0.6, 0.8, 0.7, 0.6, 0.7, 0.8, 1.1, 1.4, 1.5, 1.6, 1.8, 1.5, 0.8]
    const hTotal = HOURS.reduce((a, x) => a + x, 0)
    const pickHour = () => {
      let x = rnd() * hTotal
      for (let h = 0; h < 24; h++) if ((x -= HOURS[h]) <= 0) return h
      return 21
    }
    const now = Date.now()
    const rows = []
    for (let dayBack = 330; dayBack >= 0; dayBack--) {
      if (rnd() < 0.12) continue
      const n = 6 + Math.floor(rnd() * (dayBack < 120 ? 34 : 22))
      for (let k = 0; k < n; k++) {
        const t = pickTrack()
        const day = new Date(now - dayBack * 86400000)
        day.setHours(pickHour(), Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0)
        const startedAt = Math.min(day.getTime(), now - 3600_000)
        const skip = rnd() < 0.08
        const listened = skip ? Math.round(t.d * 0.15) : t.d
        const lp = localParts(startedAt)
        rows.push({
          sql: `INSERT INTO play_events (track_key, started_at, ended_at, tz_offset, local_day, local_hour, weekday, listened_ms,
                pos_start_ms, pos_end_ms, duration_ms, end_reason, counted, source_type, output)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'library', 'web')`,
          params: [t.key, startedAt, startedAt + listened, lp.tzOffset, lp.localDay, lp.localHour, lp.weekday, listened, listened, t.d, skip ? 'skipped' : 'ended', skip ? 0 : 1],
        })
      }
    }
    for (let i = 0; i < rows.length; i += 400) await db.batch(rows.slice(i, i + 400))

    // ---------- оценки, избранное, эпохи ----------
    const user = []
    order.slice(0, 70).forEach((t, i) => {
      const rating = i < 8 ? 10 : i < 20 ? 9 : i < 40 ? 8 : 6 + Math.floor(rnd() * 3)
      user.push({
        sql: `INSERT OR REPLACE INTO track_user (key, rating, rated_at, favorite_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        params: [t.key, rating, now - i * 3600_000, i < 24 ? now - i * 86400000 : null, now],
      })
    })
    const dayKey = (ms) => localParts(ms).localDay
    user.push({ sql: `INSERT INTO eras (title, kind, start_day, end_day, color, created_at) VALUES (?, 'custom', ?, ?, ?, ?)`, params: ['Лето на даче', dayKey(now - 150 * 864e5), dayKey(now - 95 * 864e5), '#e8a13c', now] })
    user.push({ sql: `INSERT INTO eras (title, kind, start_day, end_day, color, created_at) VALUES (?, 'custom', ?, ?, ?, ?)`, params: ['Переезд', dayKey(now - 60 * 864e5), dayKey(now - 30 * 864e5), '#62b38e', now] })
    await db.batch(user)
    return { fixes: fixes.length, albums: albums.length, plays: rows.length }
  })
  console.log('seeded', JSON.stringify(r))
  await ev(`await s.get('library').load(); return 1`)
  await wait(1500)
  // База веб-версии сохраняется в IndexedDB при уходе со страницы
  await p.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await wait(3000)
}

/* ---------------- съёмка ---------------- */
async function shoot(lang, size, w, h, dpr) {
  await phone(w, h, dpr)
  await p.goto(URL, { waitUntil: 'networkidle0' })
  await wait(2500)
  await p.evaluate(async (l) => (await import('/src/i18n/index.ts')).setLang(l), lang)
  await wait(800)
  const dir = `${RAW}/${lang}`
  fs.mkdirSync(dir, { recursive: true })
  const snap = async (name, settle = 1400) => {
    await wait(settle)
    await p.screenshot({ path: `${dir}/${size}-${name}.png` })
    console.log(lang, size, name)
  }
  const go = async (hash) => {
    await ev(`s.get('ui').fullPlayer = false; s.get('ui').zen = false; s.get('ui').closeSheet(); return 1`)
    await p.evaluate((x) => (location.hash = x), hash)
  }
  // Играет любимый трек с красивой обложкой
  await ev(`
    const lib = s.get('library')
    const best = [...lib.tracks].filter((t) => t.art).sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0))
    const t = best[0]
    await s.get('player').playTracks(best.slice(0, 30), 0, { type: 'library' }, { shuffle: false })
    return t?.title`)
  await wait(1500)

  await go('#/')
  await snap('home')
  await go('#/chronicle')
  await ev(`const v = s.get('settings').s.dailyView; v.scale = 'year'; v.color = 'time'; return 1`)
  await snap('chronicle', 2200)
  await go('#/top')
  await snap('top')
  // Большой плеер
  await go('#/')
  await ev(`s.get('ui').fullPlayer = true; return 1`)
  await wait(2200)
  // В браузере вывод звука называется «Браузер» — на телефоне там «Динамик телефона»
  await p.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = w.nextNode())) {
      if (n.textContent.trim() === 'Браузер') n.textContent = 'Динамик телефона'
      if (n.textContent.trim() === 'Browser') n.textContent = 'Phone speaker'
    }
  })
  await snap('player', 300)
  // Звук и эффекты
  await ev(`s.get('ui').fullPlayer = false; return 1`)
  await ev(`const m = await import('/src/features/player/SpeedSheet.vue'); s.get('ui').openSheet(m.default); return 1`)
  await wait(900)
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^Slowed \+ reverb$/.test(x.textContent.trim()))?.click())
  await wait(300)
  await p.evaluate(() => [...document.querySelectorAll('button, label')].find((x) => /^(За стеной|Next door)/.test(x.textContent.trim()))?.click())
  await snap('sound', 1200)
  await ev(`s.get('ui').closeSheet(); return 1`)
  // Сцена
  await ev(`s.get('ui').zen = true; return 1`)
  await snap('stage', 3000)
  await ev(`s.get('ui').zen = false; return 1`)
  // Итоги года: «Топ-10»
  await go('#/chronicle')
  await wait(800)
  await p.evaluate(() => [...document.querySelectorAll('button, a')].find((x) => /^(Итоги|Recaps)$/.test(x.textContent.trim()))?.click())
  await wait(1200)
  await p.evaluate(() => document.querySelector('.tile.year')?.click())
  await wait(1800)
  const tap = () =>
    p.evaluate(() => {
      const st = document.querySelector('.story .stage')
      const r = st.getBoundingClientRect()
      const o = { bubbles: true, clientX: r.right - 15, clientY: r.top + r.height / 2 }
      st.dispatchEvent(new PointerEvent('pointerdown', o))
      st.dispatchEvent(new PointerEvent('pointerup', o))
    })
  await snap('recap-intro', 1600)
  for (let i = 0; i < 3; i++) {
    await tap()
    await wait(700)
  }
  // Даём слайду дорисоваться (строки въезжают ~1,7 с), потом держим
  await wait(2600)
  // Удержание — таймер на паузе, а слайд дорисовался
  await p.evaluate(() => {
    const st = document.querySelector('.story .stage')
    st.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
  })
  await snap('recap-top', 400)
  await p.evaluate(() => document.querySelector('.story .icon-btn')?.click())
}

if (step === 'shoot') {
  const only = process.argv[3]
  for (const lang of (process.argv[4] ? [process.argv[4]] : ['ru', 'en'])) {
    if (!only || only === 'phone') await shoot(lang, 'phone', 390, 844, 3)
    if (!only || only === 'tab7') await shoot(lang, 'tab7', 600, 1000, 2)
    if (!only || only === 'tab10') await shoot(lang, 'tab10', 800, 1280, 2)
  }
}
await b.close()
