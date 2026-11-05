<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useElementSize } from '@vueuse/core'
import IconClose from '~icons/solar/close-circle-linear'
import IconShuffle from '~icons/solar/shuffle-linear'
import IconClear from '~icons/solar/trash-bin-minimalistic-linear'
import IconDrag from '~icons/solar/hamburger-menu-linear'
import IconRemove from '~icons/solar/minus-circle-linear'
import IconSave from '~icons/solar/add-square-linear'
import IconHistory from '~icons/solar/history-linear'
import IconDown from '~icons/solar/alt-arrow-down-linear'
import ShuffleSheet from './ShuffleSheet.vue'
import NameSheet from '@/components/NameSheet.vue'
import { usePlaylists } from '@/stores/playlists'
import { SHUFFLE_KINDS } from '@/domain/shuffle'
import CoverArt from '@/components/CoverArt.vue'
import EqBars from '@/components/EqBars.vue'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { sourceLabel } from '@/domain/sources'
import { formatDuration } from '@/domain/format'
import { haptic } from '@/native/haptics'
import { LOCALE, $t } from '@/i18n'

/**
 * Очередь. Сверху то, что играет, ниже «добавлено вручную», дальше — из источника.
 * Порядок меняется перетаскиванием за ручку, трек убирается кнопкой «минус».
 */
const player = usePlayer()
const library = useLibrary()
const ui = useUi()
const playlists = usePlaylists()

const ROW_H = 60
const showHistory = ref(false)
const history = computed(() => player.history)
const shuffleLabel = computed(() =>
  player.shuffleMode === 'off'
    ? $t('Перемешать')
    : (SHUFFLE_KINDS.find((k) => k.id === player.shuffleMode)?.label ?? $t('Перемешано')),
)

function saveAsPlaylist() {
  const keys = player.queueKeys('all')
  if (!keys.length) return
  ui.openSheet(NameSheet, {
    title: $t('Сохранить очередь'),
    initial: $t('Очередь {0}', new Date().toLocaleDateString(LOCALE)),
    confirm: $t('Сохранить'),
    onDone: async (name: string) => {
      await playlists.create(name, keys)
      ui.toast($t('Плейлист «{0}»: {1} треков', name, keys.length))
    },
  })
}
const upcoming = computed(() => player.upcoming)
const current = computed(() => player.current)
const manualCount = computed(() => {
  let n = 0
  while (upcoming.value[n]?.manual) n++
  return n
})
const restLabel = computed(() => {
  const first = upcoming.value[manualCount.value]
  return first ? sourceLabel(first.source) : ''
})
const totalLeft = computed(() => upcoming.value.reduce((s, q) => s + q.durationMs, 0))

const scrollEl = ref<HTMLElement | null>(null)
const headEl = ref<HTMLElement | null>(null)
const { height: headH } = useElementSize(headEl, undefined, { box: 'border-box' })

const virt = useVirtualizer(
  computed(() => ({
    count: upcoming.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => ROW_H,
    overscan: 8,
    scrollMargin: headH.value,
    getItemKey: (i: number) => upcoming.value[i]?.qid ?? i,
  })),
)
const rows = computed(() => virt.value.getVirtualItems())

/* ---- перетаскивание ---- */
const dragFrom = ref<number | null>(null)
const dragTo = ref<number | null>(null)
const dragDy = ref(0)
let startY = 0
let startScroll = 0
let lastY = 0
let raf = 0

function offsetFor(i: number): number {
  const from = dragFrom.value
  const to = dragTo.value
  if (from == null || to == null || i === from) return 0
  if (from < to && i > from && i <= to) return -ROW_H
  if (from > to && i >= to && i < from) return ROW_H
  return 0
}

function recompute() {
  if (dragFrom.value == null) return
  const scrolled = (scrollEl.value?.scrollTop ?? 0) - startScroll
  dragDy.value = lastY - startY + scrolled
  const t = dragFrom.value + Math.round(dragDy.value / ROW_H)
  const clamped = Math.max(0, Math.min(upcoming.value.length - 1, t))
  if (clamped !== dragTo.value) {
    dragTo.value = clamped
    haptic.tick()
  }
}

function autoScroll() {
  const el = scrollEl.value
  if (!el || dragFrom.value == null) return
  const r = el.getBoundingClientRect()
  const edge = 70
  let v = 0
  if (lastY < r.top + edge) v = -Math.ceil((r.top + edge - lastY) / 6)
  else if (lastY > r.bottom - edge) v = Math.ceil((lastY - (r.bottom - edge)) / 6)
  if (v) {
    el.scrollTop += v
    recompute()
  }
  raf = requestAnimationFrame(autoScroll)
}

function dragStart(e: PointerEvent, i: number) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragFrom.value = i
  dragTo.value = i
  dragDy.value = 0
  startY = lastY = e.clientY
  startScroll = scrollEl.value?.scrollTop ?? 0
  haptic.press()
  raf = requestAnimationFrame(autoScroll)
}
function dragMove(e: PointerEvent) {
  if (dragFrom.value == null) return
  lastY = e.clientY
  recompute()
}
async function dragEnd() {
  cancelAnimationFrame(raf)
  const from = dragFrom.value
  const to = dragTo.value
  dragFrom.value = null
  dragTo.value = null
  dragDy.value = 0
  if (from == null || to == null || from === to) return
  const base = player.index + 1
  await player.move(base + from, base + to)
}
onBeforeUnmount(() => cancelAnimationFrame(raf))

function jump(i: number) {
  void player.jump(player.index + 1 + i)
}
function remove(i: number) {
  haptic.tick()
  void player.removeAt(player.index + 1 + i)
}
function clear() {
  void player.clearUpcoming()
  ui.toast($t('Очередь очищена'))
}
</script>

<template>
  <Transition name="queue">
    <div v-if="ui.queueOpen" class="queue" role="dialog" :aria-label="$t('Очередь')">
      <div ref="scrollEl" class="scroll body">
        <div ref="headEl" class="head">
          <div class="bar">
            <h2 class="display">{{ $t('Очередь') }}</h2>
            <button type="button" class="icon-btn" :aria-label="$t('Закрыть')" @click="ui.queueOpen = false">
              <IconClose />
            </button>
          </div>
          <div class="tools">
            <button type="button" class="tool" :class="{ on: player.shuffleMode !== 'off' }" @click="ui.openSheet(ShuffleSheet)">
              <IconShuffle />{{ shuffleLabel }}
            </button>
            <button
              type="button"
              class="tool"
              :disabled="!player.queue.length"
              :aria-label="$t('Сохранить как плейлист')"
              @click="saveAsPlaylist"
            >
              <IconSave />
            </button>
            <button type="button" class="tool" :disabled="!upcoming.length" :aria-label="$t('Очистить')" @click="clear">
              <IconClear />
            </button>
            <span class="left num">{{ upcoming.length }} · {{ formatDuration(totalLeft) }}</span>
          </div>
          <template v-if="history.length">
            <button type="button" class="label hist-toggle" @click="showHistory = !showHistory">
              <IconHistory />{{ $t('Уже звучало · {0}', history.length) }}<IconDown class="chev" :class="{ open: showHistory }" />
            </button>
            <div v-if="showHistory" class="hist">
              <button
                v-for="(q, i) in history.slice(-50)"
                :key="q.qid"
                type="button"
                class="hrow"
                @click="player.jump(history.length - Math.min(50, history.length) + i)"
              >
                <CoverArt :art="library.byKey.get(q.key)?.art" :seed="q.title" :label="q.title" size="s" class="cv" />
                <span class="text">
                  <span class="t ellipsis">{{ q.title }}</span>
                  <span class="s ellipsis">{{ q.artist }}</span>
                </span>
              </button>
            </div>
          </template>
          <template v-if="current">
            <div class="label">{{ $t('Сейчас играет') }}</div>
            <div class="now">
              <CoverArt
                :art="library.byKey.get(current.key)?.art"
                :seed="current.title"
                :label="current.title"
                size="s"
                class="cv"
              />
              <div class="text">
                <div class="t ellipsis">{{ current.title }}</div>
                <div class="s ellipsis">{{ current.artist }}</div>
              </div>
              <EqBars :playing="player.playing" />
            </div>
          </template>
          <div v-if="upcoming.length" class="label">
            {{ $t('Далее') }}<template v-if="restLabel"> · {{ $t('из «{0}»', restLabel) }}</template>
          </div>
          <div v-if="!upcoming.length" class="empty-q">
            {{ $t('Дальше ничего нет. Добавь треки свайпом вправо в любом списке.') }}
          </div>
        </div>

        <div class="rows" :style="{ height: `${virt.getTotalSize()}px` }">
          <div
            v-for="r in rows"
            :key="String(r.key)"
            class="vrow"
            :class="{ dragging: dragFrom === r.index }"
            :style="{
              transform: `translateY(${r.start - headH + (dragFrom === r.index ? dragDy : offsetFor(r.index))}px)`,
              height: `${ROW_H}px`,
            }"
          >
            <div class="row" @click="jump(r.index)">
              <CoverArt
                :art="library.byKey.get(upcoming[r.index]!.key)?.art"
                :seed="upcoming[r.index]!.title"
                :label="upcoming[r.index]!.title"
                size="s"
                class="cv"
              />
              <div class="text">
                <div class="t ellipsis">{{ upcoming[r.index]!.title }}</div>
                <div class="s ellipsis">
                  <b v-if="upcoming[r.index]!.manual" class="tag">{{ $t('вручную') }}</b
                  >{{ upcoming[r.index]!.artist }}
                </div>
              </div>
              <button type="button" class="mini-btn" :aria-label="$t('Убрать')" @click.stop="remove(r.index)">
                <IconRemove />
              </button>
              <span
                class="handle"
                :aria-label="$t('Перетащить')"
                @click.stop
                @pointerdown.stop="dragStart($event, r.index)"
                @pointermove="dragMove"
                @pointerup="dragEnd"
                @pointercancel="dragEnd"
                ><IconDrag
              /></span>
            </div>
          </div>
        </div>
        <div class="pad" />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.queue {
  position: fixed;
  inset: 0;
  z-index: 35;
  background: var(--bg);
  transition: transform var(--t-mid) var(--ease-out);
}
.queue-enter-from,
.queue-leave-to {
  transform: translateY(100%);
}
.body {
  height: 100%;
}
.head {
  padding: calc(var(--safe-top) + 8px) var(--gutter) 0;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
}
.bar h2 {
  font-size: 24px;
  font-weight: 600;
}
.tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 8px;
}
.tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--chip);
  font: 500 13px/1 var(--f-body);
}
.tool.on {
  color: var(--amber-ink);
}
.tool svg {
  width: 16px;
  height: 16px;
}
.hist-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
}
.hist-toggle svg {
  width: 16px;
  height: 16px;
}
.chev {
  margin-left: auto;
  transition: transform var(--t-fast) var(--ease);
}
.chev.open {
  transform: rotate(180deg);
}
.hist {
  display: flex;
  flex-direction: column;
  opacity: 0.75;
}
.hrow {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 12px;
  align-items: center;
  padding: 5px 0;
  text-align: left;
}
.hrow .cv {
  width: 38px;
}
.left {
  margin-left: auto;
  color: var(--ink-3);
  font-size: 12.5px;
}
.label {
  margin: 14px 0 8px;
  font: 600 13px/1 var(--f-body);
  color: var(--ink-2);
}
.now {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border-radius: 16px;
  background: var(--surface);
}
.now .cv {
  width: 48px;
}
.now .t {
  color: var(--amber-ink);
}
.empty-q {
  padding: 24px 0;
  color: var(--ink-2);
  font-size: 14px;
}
.rows {
  position: relative;
}
.vrow {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  transition: transform 180ms var(--ease-out);
}
.vrow.dragging {
  transition: none;
  z-index: 2;
}
.vrow.dragging .row {
  background: var(--surface-2);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  border-radius: 14px;
}
.tag {
  font-weight: 600;
  color: var(--amber-ink);
  margin-right: 6px;
}
.row {
  height: 100%;
  display: grid;
  grid-template-columns: 42px 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 0 6px 0 var(--gutter);
  background: var(--bg);
  cursor: pointer;
}
.row .cv {
  width: 42px;
}
/* Название над исполнителем: в «Уже звучало» это строчные span — без колонки они слипались в одну строку */
.text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.t {
  font: 500 14.5px/1.25 var(--f-body);
}
.s {
  margin-top: 2px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.mini-btn,
.handle {
  width: 40px;
  height: 44px;
  display: grid;
  place-items: center;
  color: var(--ink-3);
}
.handle {
  touch-action: none;
  cursor: grab;
}
.mini-btn svg,
.handle svg {
  width: 20px;
  height: 20px;
}
.pad {
  height: calc(var(--safe-bottom) + 40px);
}
</style>
