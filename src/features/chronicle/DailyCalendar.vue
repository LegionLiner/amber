<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSettings } from '@/stores/settings'
import { useLibrary } from '@/stores/library'
import { artistDays, dailyTime } from '@/data/repos/stats'
import {
  dayGrid,
  monthsGrid,
  sinceFor,
  yearsGrid,
  type ArtistDay,
  type CalCell,
  type CalColor,
  type CalScale,
} from '@/domain/calendar'
import { dayLabel, parseDay } from '@/domain/weeks'

import { dayRange, formatListen } from '@/domain/format'
import { stampedLoad } from '@/app/data-rev'
import { onPageShown } from '@/app/paging'
import { $t } from '@/i18n'

/**
 * «Каждый день»: календарь прослушиваний. Масштаб — 18 недель или год по дням, или все годы по неделям;
 * цвет — по времени (как раньше) или по исполнителю (domain/calendar.ts). Выбор запоминается.
 */
const settings = useSettings()
const router = useRouter()
const library = useLibrary()
const view = computed(() => settings.s.dailyView)

const SCALES: { id: CalScale; label: string; hint: string }[] = [
  { id: '18w', label: $t('18 недель'), hint: $t('по дням') },
  { id: 'year', label: $t('Год'), hint: $t('по дням') },
  { id: 'years', label: $t('Годы'), hint: $t('по неделям') },
]
const COLORS: { id: CalColor; label: string }[] = [
  { id: 'time', label: $t('Время') },
  { id: 'artists', label: $t('Исполнители') },
]

/**
 * Цвета трёх главных исполнителей — проверенная тройка (синий, оранжевый, бирюзовый): различима в соседних
 * клетках и при нарушениях цветовосприятия. Больше цветов рядом на глаз уже не различить
 */
const systemLight = window.matchMedia('(prefers-color-scheme: light)').matches
const light = computed(() => settings.s.theme === 'light' || (settings.s.theme === 'system' && systemLight))
const ARTIST_COLORS = computed(() => (light.value ? ['#2a78d6', '#eb6834', '#1baf7a'] : ['#3987e5', '#d95926', '#199e70']))

/** Ключ трека — 20 шестнадцатеричных знаков (отпечаток файла) */
const KEY_RE = /^[0-9a-f]{20}$/
/**
 * Загруженное — вместе с масштабом и цветом, для которых оно загружено. Сетка строится по нему, а не по
 * кнопкам: при смене масштаба она один раз перерисовывается уже с новыми данными, а не сначала со старыми
 */
const loaded = shallowRef<{ scale: CalScale; color: CalColor; days: Map<string, number>; artists: ArtistDay[] | null }>({
  scale: view.value.scale,
  color: view.value.color,
  days: new Map(),
  artists: null,
})
const load = stampedLoad(async () => {
  const { scale, color } = view.value
  const since = sinceFor(scale)
  const [d, a] = await Promise.all([dailyTime(since), color === 'artists' ? artistDays(since) : null])
  // Трек без исполнителя в тегах пришёл ключом: имя — как в медиатеке; нет его там — исполнитель неизвестен
  const artists =
    a?.map((r) => {
      const t = library.byKey.get(r.who)
      return { day: r.day, ms: r.ms, artist: t ? t.artists.join(', ') : KEY_RE.test(r.who) ? null : r.who }
    }) ?? null
  loaded.value = { scale, color, days: new Map(d.map((r) => [r.day, r.listenedMs])), artists }
})
onMounted(() => void load())
onPageShown(() => void load())
watch(
  () => [view.value.scale, view.value.color],
  () => {
    selected.value = null
    void load(true)
  },
)

const built = computed(() => {
  const { scale, color, days, artists } = loaded.value
  const a = color === 'artists' ? artists : null
  if (scale === 'years') return yearsGrid(days, new Date(), a)
  if (scale === 'year') return monthsGrid(days, new Date(), a)
  return dayGrid(days, 18, new Date(), a)
})
const grid = computed(() => built.value.grid)
const top = computed(() => built.value.top)
const shownColor = computed(() => loaded.value.color)
const allCells = computed(() => {
  const g = grid.value
  return g.kind === 'days' ? g.cells : g.kind === 'months' ? g.months.flatMap((m) => m.cells) : g.rows.flatMap((r) => r.cells)
})
const byKey = computed(() => new Map(allCells.value.map((c) => [c.key, c])))

/** Цвет клетки строкой: клеток сотни, без объектов классов и обработчиков на каждой */
function cellClass(c: CalCell): string {
  const tone = shownColor.value === 'artists' && c.ms > 0 ? (c.slot != null && c.slot >= 0 ? `a${c.slot}` : 'ao') : `l${c.level}`
  return c.future ? `cell ${tone} future` : `cell ${tone}`
}
/** Одно нажатие на всю сетку: клетка узнаётся по data-k */
function cellOf(e: Event): CalCell | null {
  const k = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-k]')?.dataset.k
  return k ? (byKey.value.get(k) ?? null) : null
}
function pick(e: Event) {
  const c = cellOf(e)
  // Будущее ещё не наступило — выбирать нечего
  if (c && !c.future) selected.value = c.key
}
function openDay(e: Event) {
  const c = cellOf(e)
  if (c && c.ms && c.from === c.to) void router.push(`/day/${c.key}`)
}

/* ---------------- выбранная клетка ---------------- */
const selected = ref<string | null>(null)
const selCell = computed(() => (selected.value ? (byKey.value.get(selected.value) ?? null) : null))
/** «14 октября 2026», неделя — «6–12 октября 2026» (на языке интерфейса) */
function rangeLabel(c: CalCell): string {
  return c.from === c.to ? dayLabel(c.from, true) : dayRange(parseDay(c.from), parseDay(c.to), true)
}
const caption = computed(() => {
  const c = selCell.value
  const unit = loaded.value.scale === 'years' ? $t('неделю') : $t('день')
  if (!c) return $t('Нажми на {0}, чтобы увидеть время{1}', unit, shownColor.value === 'artists' ? $t(' и исполнителя') : '')
  if (!c.ms) return $t('{0}: тишина', rangeLabel(c))
  return `${rangeLabel(c)}: ${formatListen(c.ms)}${shownColor.value === 'artists' && c.artist ? $t(' · больше всего {0}', c.artist) : ''}`
})
/** Нажатие мимо календаря снимает выбор */
function clearOnOutside(e: PointerEvent) {
  const t = e.target as Element | null
  if (selected.value && !t?.closest('.cal [data-k], .cal .open')) selected.value = null
}
onMounted(() => document.addEventListener('pointerdown', clearOnOutside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', clearOnOutside, true))

const hint = computed(() => SCALES.find((s) => s.id === view.value.scale)?.hint ?? '')
</script>

<template>
  <div class="blk">
    <div class="section-title">
      <span>{{ $t('Каждый день') }}</span
      ><span class="muted small">{{ hint }}</span>
    </div>
    <div class="card cal" :style="{ '--c0': ARTIST_COLORS[0], '--c1': ARTIST_COLORS[1], '--c2': ARTIST_COLORS[2] }">
      <div class="ctl">
        <div class="mini-seg" role="radiogroup" :aria-label="$t('Масштаб')">
          <button
            v-for="s in SCALES"
            :key="s.id"
            type="button"
            role="radio"
            :aria-checked="view.scale === s.id"
            :class="{ on: view.scale === s.id }"
            @click="settings.s.dailyView.scale = s.id"
          >
            {{ s.label }}
          </button>
        </div>
        <div class="mini-seg" role="radiogroup" :aria-label="$t('Цвет')">
          <button
            v-for="c in COLORS"
            :key="c.id"
            type="button"
            role="radio"
            :aria-checked="view.color === c.id"
            :class="{ on: view.color === c.id }"
            @click="settings.s.dailyView.color = c.id"
          >
            {{ c.label }}
          </button>
        </div>
      </div>

      <!-- Клетки — простые span: на одну сетку один обработчик (pick по data-k), так смена масштаба не подлагивает -->
      <div class="grid" role="img" :aria-label="$t('Календарь прослушиваний: {0}', hint)" @click="pick" @dblclick="openDay">
        <template v-if="grid.kind === 'days'">
          <div class="months" :style="{ gridTemplateColumns: `repeat(${grid.weeks}, 1fr)` }">
            <span v-for="m in grid.months" :key="m.col" :style="{ gridColumn: `${m.col + 1}` }">{{ m.label }}</span>
          </div>
          <div class="heat">
            <span
              v-for="c in grid.cells"
              :key="c.key"
              :class="selected === c.key ? cellClass(c) + ' sel' : cellClass(c)"
              :data-k="c.key"
            />
          </div>
        </template>
        <div v-else-if="grid.kind === 'months'" class="mgrid">
          <div v-for="m in grid.months" :key="m.key" class="mon">
            <span class="mt"
              >{{ m.label }}<small v-if="m.year" class="num"> {{ m.year }}</small></span
            >
            <div class="mdays">
              <i v-if="m.lead" class="lead" :style="{ gridColumn: `span ${m.lead}` }" />
              <span
                v-for="c in m.cells"
                :key="c.key"
                :class="selected === c.key ? cellClass(c) + ' sel' : cellClass(c)"
                :data-k="c.key"
              />
            </div>
          </div>
        </div>
        <template v-else>
          <div class="ymonths" :style="{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }">
            <span v-for="m in grid.months" :key="m.col" :style="{ gridColumn: `${m.col + 1}` }">{{ m.label }}</span>
          </div>
          <div v-for="r in grid.rows" :key="r.year" class="yrow">
            <span class="yl num">{{ r.year }}</span>
            <div class="ycells" :style="{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }">
              <span
                v-for="c in r.cells"
                :key="c.key"
                :class="selected === c.key ? cellClass(c) + ' sel' : cellClass(c)"
                :data-k="c.key"
              />
            </div>
          </div>
        </template>
      </div>

      <div class="legend">
        <template v-if="shownColor === 'time'">
          <span>{{ $t('меньше') }}</span
          ><span class="steps"><i class="cell l1" /><i class="cell l2" /><i class="cell l3" /><i class="cell l4" /></span
          ><span>{{ $t('больше') }}</span>
        </template>
        <template v-else>
          <span v-for="(a, i) in top" :key="a" class="who"
            ><i class="cell" :class="`a${i}`" /><span class="ellipsis">{{ a }}</span></span
          >
          <span class="who"
            ><i class="cell ao" /><span>{{ $t('другие') }}</span></span
          >
        </template>
      </div>
      <p class="caption">
        {{ caption }}
        <RouterLink v-if="selCell && selCell.ms && selCell.from === selCell.to" :to="`/day/${selCell.from}`" class="open">{{
          $t('открыть день')
        }}</RouterLink>
      </p>
    </div>
  </div>
</template>

<style scoped>
.card {
  margin: 0 var(--gutter);
  padding: 12px 12px 10px;
  border-radius: 16px;
  background: var(--surface);
}
.ctl {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.mini-seg {
  display: inline-flex;
  padding: 3px;
  border-radius: 10px;
  background: var(--surface-2);
}
.mini-seg button {
  padding: 5px 9px;
  border-radius: 8px;
  font: 500 12px/1.1 var(--f-body);
  color: var(--ink-2);
  white-space: nowrap;
}
.mini-seg button.on {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}
.months,
.ymonths {
  display: grid;
  font-size: 10px;
  color: var(--ink-3);
  height: 14px;
}
.months span,
.ymonths span {
  white-space: nowrap;
}
.ymonths {
  margin-left: 34px;
}
.heat {
  display: grid;
  grid-template-rows: repeat(7, 1fr);
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 3px;
}
/* Год: месяцы календариками — на телефоне по три в ряд, на компьютере сколько влезет */
.mgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 12px 14px;
}
.mt {
  display: block;
  margin-bottom: 4px;
  font: 600 11px/1.2 var(--f-body);
  color: var(--ink-2);
}
.mt small {
  margin-left: 3px;
  font-weight: 500;
  color: var(--ink-3);
}
.mdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.mdays .cell {
  border-radius: 2.5px;
}
.grid [data-k] {
  cursor: pointer;
}
.yrow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
}
.yl {
  width: 28px;
  flex: none;
  font-size: 10.5px;
  color: var(--ink-3);
  text-align: right;
}
.ycells {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 1.5px;
}
.ycells .cell {
  aspect-ratio: auto;
  height: 14px;
  border-radius: 2px;
}
.cell {
  display: block;
  aspect-ratio: 1;
  border-radius: 3px;
  background: var(--surface-2);
}
.cell.l1 {
  background: rgba(var(--amber-rgb), 0.25);
}
.cell.l2 {
  background: rgba(var(--amber-rgb), 0.45);
}
.cell.l3 {
  background: rgba(var(--amber-rgb), 0.7);
}
.cell.l4 {
  background: rgb(var(--amber-rgb));
}
.cell.a0 {
  background: var(--c0);
}
.cell.a1 {
  background: var(--c1);
}
.cell.a2 {
  background: var(--c2);
}
/* Остальные исполнители — нейтрально, но видно, что музыка была */
.cell.ao {
  background: color-mix(in srgb, var(--ink) 26%, transparent);
}
.cell.future {
  opacity: 0.25;
}
.cell.sel {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--ink-2);
}
.steps {
  display: inline-flex;
  gap: 3px;
}
.steps .cell {
  width: 11px;
  height: 11px;
}
.who {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 46%;
  min-width: 0;
}
.who .cell {
  flex: none;
  width: 11px;
  height: 11px;
}
.caption {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.open {
  margin-left: 8px;
  color: var(--amber-ink);
}
/* Компьютер: карточка — стекло, как остальные блоки обзора */
:root.desktop .card {
  background: var(--glass-card);
  box-shadow: var(--glass-hi);
  border-radius: 20px;
  padding: 16px 16px 12px;
}
.small {
  font-size: 12.5px;
  font-weight: 500;
}
</style>
