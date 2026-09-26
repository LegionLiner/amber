<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import IconPlay from '~icons/solar/play-bold'
import IconStop from '~icons/solar/stop-bold'
import ScreenHeader from '@/components/ScreenHeader.vue'
import WaveStrip from '@/components/WaveStrip.vue'
import { useLibrary } from '@/stores/library'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { playlistItems, setItemTransition, type PlaylistItemRow } from '@/data/repos/playlists'
import { loadWaveform } from '@/data/repos/library'
import { DEFAULT_MIX_TRANSITION, parseTransition, TRANSITION_LABEL, type MixTransition } from '@/domain/mix'
import { formatDuration } from '@/domain/format'
import { MusicCore } from '@/native/music-core'
import type { Track } from '@/domain/track'
import type { TransitionType } from '@/native/types'

/**
 * Редактор стыков микса. Для каждой пары соседних треков: хвост A и начало B волной,
 * где начинается переход, с какого места входит B, какой переход и сколько длится.
 * «Послушать стык» играет 6 секунд до перехода и сам переход.
 */
const route = useRoute()
const library = useLibrary()
const playlists = usePlaylists()
const ui = useUi()
const id = computed(() => Number(route.params.id))
const info = computed(() => playlists.list.find((p) => p.id === id.value))

const items = shallowRef<PlaylistItemRow[]>([])
const waves = reactive(new Map<string, Uint8Array | null>())
const open = ref(1)
const edits = reactive(new Map<number, MixTransition>())
const playing = ref<number | null>(null)

const TYPES: TransitionType[] = ['gapless', 'crossfade', 'overlay', 'fadeOutIn', 'cut']
const TAIL = 40_000
const HEAD = 30_000

const pairs = computed(() => {
  const out: { i: number; item: PlaylistItemRow; a: Track; b: Track }[] = []
  for (let i = 1; i < items.value.length; i++) {
    const a = library.byKey.get(items.value[i - 1]!.trackKey)
    const b = library.byKey.get(items.value[i]!.trackKey)
    if (a && b) out.push({ i, item: items.value[i]!, a, b })
  }
  return out
})

onMounted(async () => {
  if (!playlists.loaded) await playlists.refresh()
  items.value = await playlistItems(id.value)
  for (const it of items.value) {
    const tx = parseTransition(it.transition)
    if (tx) edits.set(it.id, tx)
  }
  ensureDefaults()
  const keys = [...new Set(items.value.map((i) => i.trackKey))]
  const missing = keys.filter((k) => !library.byKey.get(k)?.analyzed)
  if (missing.length) void MusicCore.analyze({ keys: missing, priority: 'now' })
  await loadWaves()
})
watch(
  () => library.tracks,
  () => void loadWaves(),
)

async function loadWaves() {
  for (const it of items.value) {
    if (waves.get(it.trackKey)) continue
    waves.set(it.trackKey, await loadWaveform(it.trackKey).catch(() => null))
  }
}

function defaultFor(a: Track): MixTransition {
  return { ...DEFAULT_MIX_TRANSITION, outAtMs: Math.max(0, a.durationMs - DEFAULT_MIX_TRANSITION.durationMs - 2000), cueMs: 0 }
}
/** Стыки без своего перехода получают начальные значения заранее, а не во время отрисовки */
function ensureDefaults() {
  for (const p of pairs.value) if (!edits.has(p.item.id)) edits.set(p.item.id, defaultFor(p.a))
}
function tx(p: { item: PlaylistItemRow; a: Track }): MixTransition {
  return edits.get(p.item.id) ?? defaultFor(p.a)
}
function outAt(p: { item: PlaylistItemRow; a: Track }) {
  const t = tx(p)
  return t.outAtMs ?? Math.max(0, p.a.durationMs - t.durationMs)
}

async function save(p: { item: PlaylistItemRow }) {
  const t = edits.get(p.item.id)
  await setItemTransition(p.item.id, t ? JSON.stringify(t) : null)
  await playlists.refresh()
  ui.toast('Стык сохранён')
}
async function reset(p: { item: PlaylistItemRow; a: Track }) {
  edits.set(p.item.id, defaultFor(p.a))
  await setItemTransition(p.item.id, null)
  ui.toast('Стык по общим настройкам')
}

async function listen(p: { i: number; item: PlaylistItemRow; a: Track; b: Track }) {
  if (playing.value === p.i) {
    await MusicCore.previewStop()
    playing.value = null
    return
  }
  const t = tx(p)
  playing.value = p.i
  await MusicCore.previewJunction({
    aUri: p.a.uri,
    atMs: outAt(p),
    bUri: p.b.uri,
    cueMs: t.cueMs ?? 0,
    type: t.type,
    durationMs: Math.max(1, t.durationMs),
    curve: t.curve,
    duckDb: t.duckDb ?? -9,
    leadMs: 6000,
    tailMs: t.durationMs + 5000,
  })
}
let endHandle: { remove: () => Promise<void> } | null = null
onMounted(async () => {
  endHandle = await MusicCore.addListener('previewEnded', () => (playing.value = null))
})
onBeforeUnmount(() => {
  void endHandle?.remove()
  void MusicCore.previewStop()
})
</script>

<template>
  <div class="scroll screen form">
    <ScreenHeader title="Стыки" :subtitle="info?.name" back />
    <p v-if="!pairs.length" class="empty">В миксе меньше двух треков.</p>
    <section v-for="p in pairs" :key="p.item.id" class="group junction" :class="{ open: open === p.i }">
      <button type="button" class="jhead" @click="open = open === p.i ? -1 : p.i">
        <span class="n num">{{ p.i }}</span>
        <span class="names">
          <span class="ellipsis">{{ p.a.title }}</span>
          <span class="ellipsis arrow">→ {{ p.b.title }}</span>
        </span>
        <span class="kind"
          >{{ TRANSITION_LABEL[tx(p).type]
          }}<template v-if="tx(p).type !== 'gapless' && tx(p).type !== 'cut'">
            · {{ Math.round(tx(p).durationMs / 1000) }} с</template
          ></span
        >
      </button>
      <template v-if="open === p.i">
        <div class="pills">
          <button
            v-for="t in TYPES"
            :key="t"
            type="button"
            class="pill"
            :class="{ on: tx(p).type === t }"
            @click="tx(p).type = t"
          >
            {{ TRANSITION_LABEL[t] }}
          </button>
        </div>
        <div class="lbl">
          <span>Конец «{{ p.a.title }}»</span><output class="num">переход с {{ formatDuration(outAt(p)) }}</output>
        </div>
        <WaveStrip
          :wave="waves.get(p.a.key) ?? null"
          :duration-ms="p.a.durationMs"
          :from-ms="Math.max(0, p.a.durationMs - TAIL)"
          :to-ms="p.a.durationMs"
          :pick="outAt(p)"
          :zone="[outAt(p), Math.min(p.a.durationMs, outAt(p) + tx(p).durationMs)]"
          @pick="(ms) => (tx(p).outAtMs = Math.min(ms, p.a.durationMs - 500))"
        />
        <div class="lbl">
          <span>Начало «{{ p.b.title }}»</span><output class="num">вход с {{ formatDuration(tx(p).cueMs ?? 0) }}</output>
        </div>
        <WaveStrip
          :wave="waves.get(p.b.key) ?? null"
          :duration-ms="p.b.durationMs"
          :from-ms="0"
          :to-ms="Math.min(p.b.durationMs, HEAD)"
          :pick="tx(p).cueMs ?? 0"
          :zone="[tx(p).cueMs ?? 0, (tx(p).cueMs ?? 0) + tx(p).durationMs]"
          @pick="(ms) => (tx(p).cueMs = ms)"
        />
        <div v-if="tx(p).type !== 'gapless' && tx(p).type !== 'cut'" class="slider-row">
          <header>
            <span>Длительность</span><output>{{ (tx(p).durationMs / 1000).toFixed(1).replace('.0', '') }} с</output>
          </header>
          <input
            :id="`mix-dur-${p.i}`"
            v-model.number="tx(p).durationMs"
            type="range"
            class="range"
            min="1000"
            max="20000"
            step="500"
            :style="{ '--p': `${((tx(p).durationMs - 1000) / 19000) * 100}%` }"
          />
        </div>
        <div v-if="tx(p).type === 'crossfade'" class="seg three">
          <button type="button" :class="{ on: tx(p).curve === 'equalPower' }" @click="tx(p).curve = 'equalPower'">Плавная</button>
          <button type="button" :class="{ on: tx(p).curve === 'linear' }" @click="tx(p).curve = 'linear'">Прямая</button>
          <button type="button" :class="{ on: tx(p).curve === 'sCurve' }" @click="tx(p).curve = 'sCurve'">S-кривая</button>
        </div>
        <div v-if="tx(p).type === 'overlay'" class="slider-row">
          <header>
            <span>A тише на</span><output>{{ -(tx(p).duckDb ?? -9) }} дБ</output>
          </header>
          <input
            :id="`mix-duck-${p.i}`"
            type="range"
            class="range"
            min="-18"
            max="-3"
            step="1"
            :value="tx(p).duckDb ?? -9"
            :style="{ '--p': `${(((tx(p).duckDb ?? -9) + 18) / 15) * 100}%` }"
            @input="tx(p).duckDb = Number(($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="btns">
          <button type="button" class="btn" @click="listen(p)">
            <component :is="playing === p.i ? IconStop : IconPlay" />{{ playing === p.i ? 'Стоп' : 'Послушать' }}
          </button>
          <button type="button" class="btn" @click="reset(p)">Сбросить</button>
          <button type="button" class="btn primary" @click="save(p)">Сохранить</button>
        </div>
      </template>
    </section>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.jhead {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  gap: 10px;
  align-items: center;
  text-align: left;
  width: 100%;
}
.n {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--surface-2);
  font-size: 12px;
  color: var(--ink-2);
}
.names {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 14px;
}
.arrow {
  color: var(--ink-2);
}
.kind {
  font-size: 12.5px;
  color: var(--amber-ink);
}
.lbl {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.lbl span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lbl output {
  color: var(--amber-ink);
  flex: none;
}
</style>
