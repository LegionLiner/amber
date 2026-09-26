<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useViewRoute } from '@/app/view-route'
import IconPlay from '~icons/solar/play-bold'
import ScreenHeader from '@/components/ScreenHeader.vue'
import CoverArt from '@/components/CoverArt.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { dayTracks, diaryNote, saveDiaryNote, type DayTrack } from '@/data/repos/diary'
import { dayLabel } from '@/domain/weeks'
import { formatListen } from '@/domain/format'
import { MOODS } from './mood'
import { displayArtist, type Track } from '@/domain/track'

/** День в дневнике: что звучало, в каком порядке впервые, настроение и заметка */
const route = useViewRoute()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()
const day = computed(() => String(route.params.day))

const rows = shallowRef<DayTrack[]>([])
const mood = ref<number | null>(null)
const note = ref('')
let savedNote = ''

async function load() {
  const [r, n] = await Promise.all([dayTracks(day.value), diaryNote(day.value)])
  rows.value = r
  mood.value = n?.mood ?? null
  note.value = savedNote = n?.note ?? ''
}
onMounted(load)
watch(day, load)

const items = computed(() =>
  rows.value.flatMap((r) => {
    const t = library.byKey.get(r.key)
    return t ? [{ r, t }] : []
  }),
)
const total = computed(() => rows.value.reduce((s, r) => s + r.listenedMs, 0))
const firstTime = computed(() => items.value.filter((x) => x.r.isNew))
const firstAt = computed(() => Math.min(...rows.value.map((r) => r.firstAt)))

async function setMood(v: number) {
  mood.value = mood.value === v ? null : v
  await saveDiaryNote(day.value, mood.value, note.value || null)
}
async function saveNote() {
  if (note.value === savedNote) return
  savedNote = note.value
  await saveDiaryNote(day.value, mood.value, note.value.trim() || null)
  ui.toast('Заметка сохранена')
}
function play(list: Track[], i = 0) {
  void player.playTracks(
    list,
    i,
    { type: 'top', id: `day-${day.value}`, title: `Саундтрек ${dayLabel(day.value)}` },
    { shuffle: false },
  )
}
</script>

<template>
  <div class="scroll screen form">
    <ScreenHeader
      :title="dayLabel(day, true)"
      :subtitle="
        rows.length
          ? `${formatListen(total)} · с ${new Date(firstAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
          : ''
      "
      back
    />
    <section class="group">
      <h2 class="gtitle">Настроение</h2>
      <div class="moods">
        <button
          v-for="m in MOODS"
          :key="m.value"
          type="button"
          class="md"
          :class="{ on: mood === m.value }"
          :style="{ '--mc': m.color }"
          @click="setMood(m.value)"
        >
          <component :is="m.icon" /><small>{{ m.label }}</small>
        </button>
      </div>
      <textarea id="day-note" v-model="note" class="field" placeholder="Что было в этот день?" @blur="saveNote" />
    </section>

    <div v-if="items.length" class="section-title">
      <span>Саундтрек дня</span>
      <button type="button" class="btn small primary" @click="play(items.map((x) => x.t))"><IconPlay />Слушать</button>
    </div>
    <button
      v-for="(x, i) in items"
      :key="x.t.key"
      type="button"
      class="trow"
      @click="
        play(
          items.map((y) => y.t),
          i,
        )
      "
    >
      <CoverArt :art="x.t.art" :seed="x.t.title" :label="x.t.title" size="s" class="cv" />
      <span class="text">
        <span class="t ellipsis">{{ x.t.title }}<b v-if="x.r.isNew" class="new">впервые</b></span>
        <span class="s ellipsis">{{ displayArtist(x.t) }} · {{ formatListen(x.r.listenedMs) }}</span>
      </span>
      <span class="n num">{{ x.r.plays }}×</span>
    </button>
    <p v-if="firstTime.length" class="lead muted">Впервые в этот день: {{ firstTime.length }}.</p>
    <div v-if="!rows.length" class="empty"><h3>В этот день музыки не было</h3></div>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.moods {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}
.md {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  border-radius: 14px;
  color: var(--ink-3);
}
.md svg {
  width: 30px;
  height: 30px;
}
.md small {
  font-size: 10.5px;
}
.md.on {
  color: var(--mc);
  background: color-mix(in srgb, var(--mc) 16%, transparent);
}
.btn.small {
  min-height: 34px;
  padding: 0 14px;
  font-size: 13px;
}
.trow {
  width: 100%;
  display: grid;
  grid-template-columns: 44px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 7px var(--gutter);
  text-align: left;
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
.new {
  margin-left: 6px;
  font: 600 10.5px/1 var(--f-body);
  color: var(--amber-ink);
}
.n {
  font: 600 13px/1 var(--f-body);
  color: var(--ink-2);
}
.lead {
  padding: 8px var(--gutter);
  font-size: 13px;
}
</style>
