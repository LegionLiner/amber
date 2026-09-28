<script setup lang="ts">
import {
  markRaw,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  provide,
  reactive,
  ref,
  shallowReactive,
  watch,
  type Component,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HomeView from '@/features/home/HomeView.vue'
import LibraryView from '@/features/library/LibraryView.vue'
import PageSlot from './PageSlot.vue'
import SectionHead from './SectionHead.vue'
import {
  OWN_GESTURES,
  PAGES,
  PAGE_SWIPES,
  SECTION_TABS,
  TABBED,
  pageIndex,
  pageLocation,
  scrollsSideways,
  type PageName,
  type TabbedSection,
} from '@/app/paging'
import { afterSlide, motionReduced } from '@/app/motion'
import { haptic } from '@/native/haptics'

/**
 * Лента главных экранов. Текущий экран и оба соседа уже отрисованы и лежат рядом, лента едет за пальцем
 * один в один: видно следующий экран, можно долистать, а можно вернуть. Отпустил дальше 40 % ширины
 * (или смахнул) — лента доезжает, и только тогда меняется адрес. Вкладки, чипсы и «назад» двигают ту же
 * ленту. Недавно открытые экраны не выгружаются и помнят прокрутку.
 *
 * У разделов с подвкладками (медиатека, топ, хроника) заголовок и чипсы общие и лежат над лентой: пока
 * листаются вкладки одного раздела, заголовок стоит, а подсветка чипса едет за пальцем. При переходе
 * в соседний раздел заголовок уезжает вместе со своими экранами. Большое название прячется, когда экран
 * прокручен вниз, чипсы остаются.
 */
const route = useRoute()
const router = useRouter()
provide(PAGE_SWIPES, ref(true))

const views = shallowReactive<Partial<Record<PageName, Component>>>({ home: HomeView, library: LibraryView })
void import('@/features/search/SearchView.vue').then((m) => (views.search = markRaw(m.default)))
void import('@/features/top/TopView.vue').then((m) => (views.top = markRaw(m.default)))
void import('@/features/chronicle/ChronicleView.vue').then((m) => (views.chronicle = markRaw(m.default)))

/** Экран, на котором лента стоит */
const settled = ref(Math.max(0, pageIndex(route)))
/** Куда лента сейчас едет: свайп отпущен за порогом или нажали вкладку */
const target = ref<number | null>(null)
/** Смонтированные экраны — по порядку ленты, чтобы узлы не переставлялись (перестановка сбрасывает прокрутку) */
const alive = ref<number[]>([settled.value])
const recent: number[] = [settled.value]

function keep(...ids: number[]) {
  for (const i of ids) {
    if (!PAGES[i]) continue
    const at = recent.indexOf(i)
    if (at >= 0) recent.splice(at, 1)
    recent.unshift(i)
  }
  recent.length = Math.min(recent.length, 6)
  const s = settled.value
  const want = new Set([...recent, s - 1, s, s + 1])
  if (target.value != null) want.add(target.value)
  alive.value = [...want].filter((i) => !!PAGES[i]).sort((a, b) => a - b)
}
/** Соседей монтируем после кадра: переход уже дорисован, новая работа его не задержит */
function keepSoon(...ids: number[]) {
  requestAnimationFrame(() => setTimeout(() => keep(...ids), 0))
}
onMounted(() => {
  setTimeout(() => keep(), 250)
  void nextTick(measureHeads)
})

/** Где экран стоит относительно текущего: −1, 0, 1 или null — спрятан */
function slotOf(i: number): number | null {
  const s = settled.value
  const t = target.value
  if (i === s) return 0
  if (t != null && Math.abs(t - s) > 1) return i === t ? Math.sign(t - s) : null
  return Math.abs(i - s) === 1 ? i - s : null
}

/* ---------------- движение ленты ---------------- */

const root = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
let x = 0
let token = 0
/** Лента доезжает или возвращается после свайпа — её можно поймать пальцем */
let catchable = false
/** Экран, до которого долистали, а адрес ещё не поменяли */
let pendingSync: number | null = null

const width = () => root.value?.clientWidth || window.innerWidth

const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)'

function setX(v: number, ms = 0) {
  x = v
  const el = track.value
  if (!el) return
  el.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none'
  el.style.transform = v ? `translate3d(${v}px, 0, 0)` : ''
  layoutHeads(ms)
}

/* ---------------- заголовки разделов ---------------- */

const headEls: Partial<Record<TabbedSection, HTMLElement>> = {}
const headPos = reactive<Record<TabbedSection, number>>({ library: 0, top: 0, chronicle: 0 })
const headMs = ref(0)
/** Высота заголовка раздела — такой отступ сверху у его экранов */
const headH = reactive<Record<TabbedSection, number>>({ library: 0, top: 0, chronicle: 0 })
/** Насколько может спрятаться большое название */
const titleH: Record<TabbedSection, number> = { library: 0, top: 0, chronicle: 0 }
/** Прокрутка экранов: от неё зависит, спрятано ли название */
const tops: Record<number, number> = {}

const sectionOf = (i: number) =>
  (TABBED as readonly string[]).includes(PAGES[i]!.name) ? (PAGES[i]!.name as TabbedSection) : null
const tabIndex = (i: number) => SECTION_TABS[PAGES[i]!.name as TabbedSection]?.indexOf(PAGES[i]!.tab ?? '') ?? 0

function layoutHeads(ms = 0) {
  const s = settled.value
  const W = width()
  const n = target.value ?? (x < 0 ? s + 1 : x > 0 ? s - 1 : null)
  const t = n != null && PAGES[n] ? n : null
  const p = t == null ? 0 : Math.min(1, Math.abs(x) / W)
  const hide = (i: number, sec: TabbedSection) => Math.min(tops[i] ?? 0, titleH[sec])
  headMs.value = ms
  for (const sec of TABBED) {
    const el = headEls[sec]
    if (!el) continue
    const inS = sectionOf(s) === sec
    const inT = t != null && sectionOf(t) === sec
    let hx: number | null = null
    let y = 0
    if (inS && inT) {
      // листаем вкладки внутри раздела: заголовок стоит, подсветка едет
      hx = 0
      y = hide(s, sec) + (hide(t!, sec) - hide(s, sec)) * p
      headPos[sec] = tabIndex(s) + (tabIndex(t!) - tabIndex(s)) * p
    } else if (inS) {
      hx = x
      y = hide(s, sec)
      headPos[sec] = tabIndex(s)
    } else if (inT) {
      hx = Math.sign(t! - s) * W + x
      y = hide(t!, sec)
      headPos[sec] = tabIndex(t!)
    }
    el.style.visibility = hx == null ? 'hidden' : ''
    el.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none'
    el.style.transform = `translate3d(${hx ?? 0}px, ${-y}px, 0)`
    const title = el.querySelector<HTMLElement>('.hd-title')
    if (title) {
      title.style.transition = ms ? `opacity ${ms}ms ${EASE}` : 'none'
      title.style.opacity = titleH[sec] ? String(Math.max(0, 1 - (y / titleH[sec]) * 1.3)) : ''
    }
  }
}

function measureHeads() {
  for (const sec of TABBED) {
    const el = headEls[sec]
    const title = el?.querySelector<HTMLElement>('.hd-title')
    if (!el || !title) continue
    headH[sec] = el.offsetHeight
    titleH[sec] = Math.max(0, title.offsetHeight - parseFloat(getComputedStyle(title).paddingTop))
  }
  if (phase !== 'drag' && target.value == null && !catchable) layoutHeads(0)
}
const headObserver = new ResizeObserver(measureHeads)
function headRef(sec: TabbedSection, el: unknown) {
  const node = (el as { $el?: HTMLElement } | null)?.$el
  if (!node || headEls[sec] === node) return
  headEls[sec] = node
  headObserver.observe(node)
}
onBeforeUnmount(() => headObserver.disconnect())

/** Прокрутили экран: название раздела прячется вслед за содержимым */
function onScroll(e: Event) {
  const el = e.target as HTMLElement
  const pg = el.closest?.<HTMLElement>('.pg')
  if (!pg || el.clientHeight < pg.clientHeight * 0.6) return
  tops[Number(pg.dataset.page)] = el.scrollTop
  if (phase !== 'drag' && target.value == null && !catchable) layoutHeads(0)
}

function currentX(): number {
  const el = track.value
  if (!el) return x
  return new DOMMatrixReadOnly(getComputedStyle(el).transform).m41
}

function glide(to: number, ms: number, done: () => void) {
  const t = ++token
  const el = track.value
  if (!el || motionReduced() || Math.abs(to - x) < 0.5) {
    setX(to)
    done()
    return
  }
  setX(to, ms)
  afterSlide(el, () => t === token && done(), ms + 250)
}

/** Лента доехала: экран-цель становится текущим. Сдвиг ленты и места экранов меняются в одном кадре */
function arrive(sync: boolean) {
  const t = target.value
  catchable = false
  if (t == null) return
  settled.value = t
  target.value = null
  setX(0)
  keepSoon(t)
  if (sync) syncRoute(t)
}

function syncRoute(i: number) {
  pendingSync = null
  const cur = pageIndex(route)
  if (cur < 0 || cur === i) return
  const to = pageLocation(i)
  // Внутри раздела (медиатека, топ, хроника) — замена адреса, между разделами — шаг истории: «назад» вернёт
  void (PAGES[cur]!.name === PAGES[i]!.name ? router.replace(to) : router.push(to))
}

/** Переход не пальцем: вкладка внизу, чипсы, «назад» */
function go(n: number) {
  if (target.value != null) arrive(false)
  phase = 'idle'
  if (motionReduced()) return jump(n)
  const dir = Math.sign(n - settled.value)
  target.value = n
  keep(n)
  // Цель появляется за краем в этом кадре, едет — со следующего
  void nextTick(() => {
    layoutHeads(0)
    requestAnimationFrame(() => {
      if (target.value !== n) return
      glide(-dir * width(), 320, () => arrive(false))
    })
  })
}

function jump(n: number) {
  ++token
  catchable = false
  target.value = null
  settled.value = n
  setX(0)
  keep(n)
}

watch(
  () => pageIndex(route),
  (n, o) => {
    if (n < 0 || n === target.value || (target.value == null && n === settled.value)) return
    // Вернулись в ленту из глубины (альбом, настройки) — сразу на нужный экран, переход рисует RouterView
    if (o == null || o < 0) return jump(n)
    go(n)
  },
)

onDeactivated(() => {
  phase = 'idle'
  if (target.value != null) arrive(false)
  ++token
  catchable = false
  setX(0)
})

/* ---------------- жест ---------------- */

let phase: 'idle' | 'pending' | 'drag' = 'idle'
let pid = -1
let sx = 0
let sy = 0
let base = 0
let lastX = 0
let lastT = 0
let vx = 0
let swallowClick = false

function onDown(e: PointerEvent) {
  phase = 'idle'
  // Касание, остановившее прокрутку, тоже может стать свайпом: палец сам решает, куда вести
  if (e.button !== 0 || !e.isPrimary) return
  const t = e.target as Element
  if (t.closest(OWN_GESTURES) || scrollsSideways(t, root.value!)) return
  base = 0
  if (target.value != null || catchable) {
    if (!catchable) return
    // Лента ещё едет после прошлого свайпа — ловим её там, где она сейчас
    const cur = currentX()
    ++token
    catchable = false
    if (target.value != null) {
      const dir = Math.sign(target.value - settled.value)
      const t2 = target.value
      settled.value = t2
      target.value = null
      pendingSync = t2
      base = cur + dir * width()
      keep(t2)
    } else base = cur
    setX(base)
  }
  pid = e.pointerId
  sx = lastX = e.clientX
  sy = e.clientY
  lastT = e.timeStamp
  vx = 0
  phase = 'pending'
}

function onMove(e: PointerEvent) {
  if (phase === 'idle' || e.pointerId !== pid) return
  const dx = e.clientX - sx
  const dy = e.clientY - sy
  if (phase === 'pending') {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      phase = 'idle'
      return settle()
    }
    if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return
    phase = 'drag'
    sx = e.clientX
  }
  const dt = Math.max(8, e.timeStamp - lastT)
  vx = 0.35 * vx + 0.65 * ((e.clientX - lastX) / dt)
  lastX = e.clientX
  lastT = e.timeStamp
  let v = base + (e.clientX - sx)
  const s = settled.value
  // У края ленты соседа нет: экран тянется с сопротивлением
  if ((v > 0 && !PAGES[s - 1]) || (v < 0 && !PAGES[s + 1])) v *= 0.3
  setX(v)
}

function onUp(e: PointerEvent) {
  if (phase === 'idle' || e.pointerId !== pid) return
  const was = phase
  phase = 'idle'
  if (was !== 'drag') return settle()
  swallowClick = true
  setTimeout(() => (swallowClick = false), 350)
  // Палец остановился перед отпусканием — скорости нет
  if (e.timeStamp - lastT > 90) vx = 0
  const W = width()
  const dir = x < 0 ? 1 : -1
  const next = settled.value + dir
  const along = Math.abs(vx) > 0.3 && vx * x > 0
  const against = Math.abs(vx) > 0.3 && vx * x < 0
  if (PAGES[next] && !against && (Math.abs(x) > W * 0.4 || (along && Math.abs(x) > 16))) {
    haptic.tick()
    target.value = next
    catchable = true
    const rest = W - Math.abs(x)
    const ms = Math.round(Math.min(340, Math.max(170, rest / Math.max(Math.abs(vx), 1.3))))
    glide(-dir * W, ms, () => arrive(true))
    return
  }
  settle()
}

/** Вернуть ленту на место */
function settle() {
  const done = () => {
    catchable = false
    if (pendingSync != null && pendingSync === settled.value) syncRoute(pendingSync)
  }
  if (Math.abs(x) < 0.5) return done()
  catchable = true
  glide(0, 240, done)
}

function onCancel(e: PointerEvent) {
  if (phase === 'idle' || e.pointerId !== pid) return
  phase = 'idle'
  settle()
}

/** После свайпа браузер может прислать click в кнопку, на которой начался жест */
function onClick(e: MouseEvent) {
  if (!swallowClick) return
  swallowClick = false
  e.stopPropagation()
  e.preventDefault()
}
</script>

<template>
  <div
    ref="root"
    class="pager"
    @pointerdown.capture="onDown"
    @pointermove.capture="onMove"
    @pointerup.capture="onUp"
    @pointercancel.capture="onCancel"
    @click.capture="onClick"
    @scroll.capture.passive="onScroll"
  >
    <SectionHead
      v-for="sec in TABBED"
      :key="sec"
      :ref="(el) => headRef(sec, el)"
      :section="sec"
      :pos="headPos[sec]"
      :ms="headMs"
    />
    <div ref="track" class="pg-track">
      <div
        v-for="i in alive"
        :key="i"
        class="pg"
        :class="{ off: slotOf(i) === null }"
        :style="{
          transform: `translateX(${(slotOf(i) ?? 0) * 100}%)`,
          '--head-h': sectionOf(i) ? `${headH[sectionOf(i)!]}px` : undefined,
        }"
        :inert="i !== settled || undefined"
        :data-page="i"
      >
        <PageSlot
          v-if="views[PAGES[i]!.name]"
          :index="i"
          :shown="i === settled && target === null"
          :view="views[PAGES[i]!.name]!"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pager {
  position: relative;
  height: 100%;
  overflow: hidden;
  /* Вбок ленту ведёт жест, браузеру — только вертикаль; иначе касание по едущей ленте браузер забирает себе */
  touch-action: pan-y;
}
.pg-track {
  position: absolute;
  inset: 0;
  will-change: transform;
}
.pg {
  position: absolute;
  inset: 0;
  contain: strict;
}
/* Дальние экраны лежат спрятанными: не рисуются, но помнят прокрутку и состояние */
.pg.off {
  visibility: hidden;
  content-visibility: hidden;
}
</style>
