<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import ChipTabs from '@/components/ChipTabs.vue'
import CoverArt from '@/components/CoverArt.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { activeDays, artistPlays, byHour, periodTotals, topTracks, type PeriodTotals } from '@/data/repos/stats'
import DailyCalendar from './DailyCalendar.vue'
import { splitArtists } from '@/domain/names'
import { computeStreaks, todayKey } from '@/domain/streaks'
import { dayKey, parseDay } from '@/domain/weeks'
import { countLabel, formatListen } from '@/domain/format'
import { displayArtist, type Track } from '@/domain/track'
import { onPageShown } from '@/app/paging'
import { stampedLoad } from '@/app/data-rev'
import { LOCALE, $t, $tp } from '@/i18n'

/** Обзор: время, прослушивания, серия, календарь на 18 недель, часы, топ треков и исполнителей */
type Period = '7' | '30' | '90' | '180' | '365' | 'all' | 'custom'
const PERIODS: { id: Period; label: string }[] = [
  { id: '7', label: $t('7 дней') },
  { id: '30', label: $t('30 дней') },
  { id: '90', label: $t('3 месяца') },
  { id: '180', label: $t('6 месяцев') },
  { id: '365', label: $t('Год') },
  { id: 'all', label: $t('Всё время') },
  { id: 'custom', label: $t('Свой период') },
]

const library = useLibrary()
const player = usePlayer()
const period = ref<Period>('30')

const DAY = 86_400_000
/** Свой период: дни «с» и «по» включительно. По умолчанию — последние 30 дней */
const from = ref(dayKey(new Date(Date.now() - 29 * DAY)))
const to = ref(dayKey(new Date()))
const today = dayKey(new Date())

/** Границы периода в миллисекундах: [since, until). null — даты своего периода ещё не выбраны */
function range(now: number): { since: number; until: number; span: number } | null {
  if (period.value === 'all') return { since: 0, until: Number.MAX_SAFE_INTEGER, span: 0 }
  if (period.value === 'custom') {
    if (!from.value || !to.value) return null
    // Перепутали местами — считаем как есть, от меньшего к большему
    const [a, b] = from.value <= to.value ? [from.value, to.value] : [to.value, from.value]
    const since = parseDay(a).getTime()
    const until = parseDay(b).getTime() + DAY
    return { since, until, span: until - since }
  }
  const span = Number(period.value) * DAY
  return { since: now - span, until: Number.MAX_SAFE_INTEGER, span }
}
const totals = ref<PeriodTotals | null>(null)
const prevTotals = ref<PeriodTotals | null>(null)
const streak = ref({ current: 0, longest: 0 })
const hours = shallowRef<number[]>(Array(24).fill(0))
const top = shallowRef<{ track: Track; plays: number; listenedMs: number }[]>([])
/** Исполнители периода: по всем трекам, а не только по первой десятке */
const artists = shallowRef<[string, number][]>([])
const selectedHour = ref<number | null>(null)

/** Нажатие мимо часа снимает выделение (и подсказка возвращается к «чаще всего»); календарь — в DailyCalendar */
function clearOnOutside(e: PointerEvent) {
  const t = e.target as Element | null
  if (selectedHour.value != null && !t?.closest('.hours .hbar')) selectedHour.value = null
}
onMounted(() => document.addEventListener('pointerdown', clearOnOutside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', clearOnOutside, true))

/** Перечитываем, если история поменялась; смена периода — всегда (load(true)) */
const load = stampedLoad(async () => {
  const now = Date.now()
  const r = range(now)
  if (!r) return
  const { since, until, span } = r
  const [t, p, h, tt, ad, ap] = await Promise.all([
    periodTotals(since, until),
    // Сравнение — с таким же по длине отрезком прямо перед периодом
    span ? periodTotals(since - span, since) : Promise.resolve(null),
    byHour(since, until),
    topTracks(since, 10, until),
    activeDays(),
    artistPlays(since, until),
  ])
  totals.value = t
  prevTotals.value = p
  const hh = Array(24).fill(0) as number[]
  for (const r of h) hh[r.hour] = r.listenedMs
  hours.value = hh
  top.value = tt.flatMap((r) => {
    const track = library.byKey.get(r.key)
    return track ? [{ track, plays: r.plays, listenedMs: r.listenedMs }] : []
  })
  // Исполнители — как в медиатеке (с твоими правками тегов), а у трека, которого в ней нет, — из его тегов
  const am = new Map<string, number>()
  for (const r of ap) {
    const names = library.byKey.get(r.key)?.artists ?? splitArtists(r.artist)
    for (const a of names) am.set(a, (am.get(a) ?? 0) + r.plays)
  }
  artists.value = [...am.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  streak.value = computeStreaks(ad, todayKey())
})

onMounted(() => void load())
onPageShown(() => void load())
watch([period, from, to], () => void load(true))
// Медиатеку перечитали (новые треки, правки тегов) — названия и исполнители могли поменяться
watch(
  () => library.tracks,
  () => void load(),
)

/** Сравнение с прошлым таким же отрезком: рост — зелёным вверх, спад — красным вниз */
function delta(cur: number, prev: number | undefined): { text: string; dir: 'up' | 'down' | 'same' } | null {
  if (prev == null || prev === 0) return null
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return { text: $t('как раньше'), dir: 'same' }
  return { text: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%`, dir: pct > 0 ? 'up' : 'down' }
}
const timeDelta = computed(() =>
  totals.value && prevTotals.value ? delta(totals.value.listenedMs, prevTotals.value.listenedMs) : null,
)
const playsDelta = computed(() => (totals.value && prevTotals.value ? delta(totals.value.plays, prevTotals.value.plays) : null))

const hourMax = computed(() => Math.max(1, ...hours.value))
const peakHour = computed(() => hours.value.indexOf(Math.max(...hours.value)))
const hourText = computed(() => {
  const h = selectedHour.value ?? peakHour.value
  const ms = hours.value[h] ?? 0
  if (!ms) return $t('Пока нет данных')
  return `${selectedHour.value == null ? $t('Чаще всего') : $t('В')} ${h}:00–${h + 1}:00 · ${formatListen(ms)}`
})

const topArtists = artists
const artistMax = computed(() => Math.max(1, ...topArtists.value.map((a) => a[1])))
</script>

<template>
  <section class="ov">
    <ChipTabs v-model="period" :items="PERIODS" class="periods" />
    <div v-if="period === 'custom'" class="range">
      <label
        ><span>{{ $t('С') }}</span
        ><input v-model="from" type="date" class="field" :max="today" :aria-label="$t('Начало периода')"
      /></label>
      <label
        ><span>{{ $t('По') }}</span
        ><input v-model="to" type="date" class="field" :max="today" :aria-label="$t('Конец периода')"
      /></label>
    </div>
    <div v-if="totals" class="tiles">
      <div class="tile">
        <small>{{ $t('Время') }}</small
        ><b>{{ formatListen(totals.listenedMs) }}</b>
        <i v-if="timeDelta" :class="timeDelta.dir">{{ timeDelta.text }}</i>
      </div>
      <div class="tile">
        <small>{{ $t('Прослушивания') }}</small
        ><b>{{ totals.plays.toLocaleString(LOCALE) }}</b>
        <i v-if="playsDelta" :class="playsDelta.dir">{{ playsDelta.text }}</i>
      </div>
      <div class="tile">
        <small>{{ $t('Разных треков') }}</small
        ><b>{{ totals.uniqueTracks }}</b>
      </div>
      <div class="tile">
        <small>{{ $t('Серия') }}</small
        ><b>{{ countLabel(streak.current, $tp('день|дня|дней')) }}</b>
        <i class="plain">{{ $t('рекорд {0}', streak.longest) }}</i>
      </div>
    </div>

    <!-- .blk — блок целиком: на компьютере блоки расходятся по двум колонкам и не рвутся между ними -->
    <DailyCalendar />

    <div class="blk">
      <div class="section-title">
        <span>{{ $t('Когда слушаешь') }}</span
        ><span class="muted small">{{ $t('по часам') }}</span>
      </div>
      <div class="card">
        <div class="hours">
          <button
            v-for="(v, h) in hours"
            :key="h"
            type="button"
            class="hbar"
            :class="{ sel: selectedHour === h }"
            :aria-label="`${h}:00`"
            @click="selectedHour = selectedHour === h ? null : h"
          >
            <i :style="{ height: `${Math.max(v ? 4 : 0, (v / hourMax) * 100)}%` }" />
          </button>
        </div>
        <div class="axis num"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
        <p class="caption">{{ hourText }}</p>
      </div>
    </div>

    <div v-if="top.length" class="blk">
      <div class="section-title">
        <span>{{ $t('Топ треков') }}</span>
      </div>
      <button
        v-for="(r, i) in top"
        :key="r.track.key"
        type="button"
        class="trow"
        @click="
          player.playTracks(
            top.map((x) => x.track),
            i,
            { type: 'top', id: `period-${period}`, title: $t('Топ периода') },
            { shuffle: false },
          )
        "
      >
        <span class="pos display">{{ i + 1 }}</span>
        <CoverArt :art="r.track.art" :seed="r.track.title" :label="r.track.title" size="s" class="cv" />
        <span class="text">
          <span class="t ellipsis">{{ r.track.title }}</span>
          <span class="s ellipsis">{{ displayArtist(r.track) }}</span>
        </span>
        <span class="n num">{{ r.plays }}×</span>
      </button>
    </div>

    <div v-if="topArtists.length" class="blk">
      <div class="section-title">
        <span>{{ $t('Исполнители') }}</span>
      </div>
      <div class="card artists">
        <div v-for="[name, n] in topArtists" :key="name" class="arow">
          <span class="ellipsis">{{ name }}</span>
          <i><b :style="{ width: `${(n / artistMax) * 100}%` }" /></i>
          <span class="num">{{ n }}</span>
        </div>
      </div>
    </div>

    <div v-if="totals && !totals.starts" class="empty">
      <h3>{{ $t('История начнётся с первого трека') }}</h3>
      <p>{{ $t('Каждое прослушивание записывается, даже при выключенном экране.') }}</p>
    </div>
  </section>
</template>

<style scoped>
.periods :deep(.chip) {
  padding: 7px 12px;
  font-size: 12.5px;
}
.range {
  display: flex;
  gap: 10px;
  padding: 0 var(--gutter) 12px;
}
.range label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-2);
}
.range .field {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  color: var(--ink);
  font: 500 13.5px/1 var(--f-body);
}
.range .field:focus-visible {
  outline: none;
  border-color: rgba(var(--amber-rgb), 0.6);
}
:root.desktop .range .field {
  background: var(--glass-card);
}
:root.desktop .range {
  max-width: 460px;
}
.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 4px var(--gutter);
}
.tile {
  background: var(--surface);
  border-radius: 16px;
  padding: 12px 14px;
}
.tile small {
  display: block;
  font-size: 12px;
  color: var(--ink-2);
}
.tile b {
  display: block;
  margin-top: 4px;
  font: 600 20px/1.2 var(--f-body);
}
.tile i {
  display: block;
  margin-top: 3px;
  font-style: normal;
  font-size: 11.5px;
  color: var(--good);
}
.tile i.down {
  color: var(--bad);
}
.tile i.plain,
.tile i.same {
  color: var(--ink-3);
}
.small {
  font-size: 12.5px;
  font-weight: 500;
}

/* ---------- окно компьютера: числа в ряд, карточки в две колонки ---------- */
:root.desktop .tiles {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
:root.desktop .tile,
:root.desktop .card {
  background: var(--glass-card);
  box-shadow: var(--glass-hi);
}
:root.desktop .tile {
  padding: 16px 18px;
  border-radius: 20px;
}
:root.desktop .tile b {
  margin-top: 8px;
  font: 600 26px/1.1 var(--f-display);
  letter-spacing: -0.035em;
}
:root.desktop .card {
  border-radius: 20px;
  padding: 16px 16px 12px;
}
@container (min-width: 880px) {
  :root.desktop .ov {
    columns: 2;
    column-gap: 28px;
    padding-inline: var(--page-gutter);
    /* Внутри колонок поля считаются от колонки */
    --gutter: 0px;
  }
  :root.desktop .range {
    padding-inline: 0;
  }
  :root.desktop .periods,
  :root.desktop .range,
  :root.desktop .tiles,
  :root.desktop .empty {
    column-span: all;
  }
  :root.desktop .tiles {
    margin-bottom: 4px;
  }
  :root.desktop .blk {
    break-inside: avoid;
  }
  :root.desktop .blk:first-of-type .section-title {
    padding-top: 22px;
  }
}
.card {
  margin: 0 var(--gutter);
  padding: 12px 12px 10px;
  border-radius: 16px;
  background: var(--surface);
}
.caption {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.hours {
  height: 80px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  border-bottom: 1px solid var(--line);
}
.hbar {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.hbar i {
  display: block;
  width: 100%;
  background: rgba(var(--amber-rgb), 0.85);
  border-radius: 3px 3px 0 0;
}
.hbar.sel i {
  background: var(--ember);
}
.axis {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--ink-3);
  margin-top: 5px;
}
.trow {
  width: 100%;
  display: grid;
  grid-template-columns: 26px 44px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 7px var(--gutter);
  text-align: left;
}
.trow:active {
  background: var(--surface);
}
.pos {
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  color: var(--ink-2);
}
.cv {
  width: 44px;
}
.text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.t {
  font: 500 14.5px/1.25 var(--f-body);
}
.s {
  font-size: 12.5px;
  color: var(--ink-2);
}
.n {
  font: 600 13px/1 var(--f-body);
  color: var(--ink-2);
}
.artists {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.arow {
  display: grid;
  grid-template-columns: 38% 1fr 34px;
  gap: 10px;
  align-items: center;
  font-size: 13.5px;
}
.arow i {
  height: 8px;
  border-radius: 4px;
  background: var(--surface-2);
  overflow: hidden;
}
.arow b {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: rgba(var(--amber-rgb), 0.85);
}
.arow .num {
  text-align: right;
  color: var(--ink-2);
}
</style>
