<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import CoverArt from '@/components/CoverArt.vue'
import { useLibrary } from '@/stores/library'
import { diaryFeed, milestones, onThisDay, type DiaryDay, type Milestone, type OnThisDay } from '@/data/repos/diary'
import { todayKey } from '@/domain/streaks'
import { dayLabel } from '@/domain/weeks'
import { formatDate, formatListen } from '@/domain/format'
import { moodOf } from './mood'
import { onPageShown } from '@/app/paging'

/**
 * Дневник: у каждого дня с музыкой своя запись — сколько слушал, трек дня, сколько нового.
 * Сверху — «в этот день» в прошлые годы и вехи.
 */
const library = useLibrary()
const router = useRouter()

const feed = shallowRef<DiaryDay[]>([])
const past = shallowRef<OnThisDay[]>([])
const marks = shallowRef<Milestone[]>([])
const more = ref(true)
const loading = ref(false)
const today = todayKey()

async function load() {
  const [f, p, m] = await Promise.all([diaryFeed('9999-12-31', 20), onThisDay(today), milestones()])
  feed.value = f
  past.value = p
  marks.value = m.slice(0, 12)
  more.value = f.length === 20
}
onMounted(load)
onPageShown(load)

async function loadMore() {
  if (loading.value || !more.value) return
  loading.value = true
  const last = feed.value[feed.value.length - 1]
  const next = last ? await diaryFeed(last.day, 20) : []
  feed.value = [...feed.value, ...next]
  more.value = next.length === 20
  loading.value = false
}

/** В этот день: по годам, лучший трек каждого года */
const pastByDay = computed(() => {
  const m = new Map<string, OnThisDay[]>()
  for (const r of past.value) m.set(r.day, [...(m.get(r.day) ?? []), r])
  return [...m.entries()].map(([day, rows]) => ({ day, rows, track: library.byKey.get(rows[0]!.key) }))
})

function yearsAgo(day: string): string {
  const y = Number(today.slice(0, 4)) - Number(day.slice(0, 4))
  if (y <= 0) return 'месяц назад'
  return y === 1 ? 'год назад' : y < 5 ? `${y} года назад` : `${y} лет назад`
}

function markText(m: Milestone): string {
  if (m.kind === 'plays') return `${m.value.toLocaleString('ru-RU')}-е прослушивание`
  if (m.kind === 'hours') return `${m.value.toLocaleString('ru-RU')} часов музыки`
  const t = m.key ? library.byKey.get(m.key) : null
  return `«${t?.title ?? 'трек'}» — ${m.value} раз`
}
</script>

<template>
  <section>
    <div v-if="pastByDay.length" class="section-title"><span>В этот день</span></div>
    <div v-if="pastByDay.length" class="past">
      <button v-for="p in pastByDay" :key="p.day" type="button" class="pcard" @click="router.push(`/day/${p.day}`)">
        <CoverArt v-if="p.track" :art="p.track.art" :seed="p.track.title" :label="p.track.title" size="s" class="cv" />
        <span class="text">
          <small>{{ yearsAgo(p.day) }} · {{ dayLabel(p.day, true) }}</small>
          <b class="ellipsis">{{ p.track?.title ?? 'трек' }}</b>
          <small class="ellipsis">и ещё {{ p.rows.length - 1 }}</small>
        </span>
      </button>
    </div>

    <template v-if="marks.length">
      <div class="section-title"><span>Вехи</span></div>
      <div class="marks">
        <div v-for="(m, i) in marks" :key="i" class="mark">
          <b>{{ markText(m) }}</b>
          <small>{{ formatDate(m.at) }}</small>
        </div>
      </div>
    </template>

    <div class="section-title"><span>Дни</span></div>
    <button v-for="d in feed" :key="d.day" type="button" class="day" @click="router.push(`/day/${d.day}`)">
      <div class="dhead">
        <b>{{ d.day === today ? 'Сегодня' : dayLabel(d.day, d.day.slice(0, 4) !== today.slice(0, 4)) }}</b>
        <span class="muted">{{ formatListen(d.listenedMs) }} · {{ d.plays }} прослуш.</span>
        <component :is="moodOf(d.mood)!.icon" v-if="moodOf(d.mood)" class="mood" :style="{ color: moodOf(d.mood)!.color }" />
      </div>
      <div v-if="d.topKey && library.byKey.get(d.topKey)" class="dtop">
        <CoverArt
          :art="library.byKey.get(d.topKey)!.art"
          :seed="library.byKey.get(d.topKey)!.title"
          :label="library.byKey.get(d.topKey)!.title"
          size="s"
          class="cv"
        />
        <span class="text">
          <small>трек дня</small>
          <span class="ellipsis">{{ library.byKey.get(d.topKey)!.title }}</span>
        </span>
        <span v-if="d.discoveries" class="new">+{{ d.discoveries }} нов.</span>
      </div>
      <p v-if="d.note" class="note">{{ d.note }}</p>
    </button>
    <button v-if="more && feed.length" type="button" class="btn block more" :disabled="loading" @click="loadMore">Раньше</button>
    <div v-if="!feed.length" class="empty">
      <h3>Дневник пуст</h3>
      <p>Каждый день с музыкой получит запись сам. Ты добавишь настроение и пару слов.</p>
    </div>
  </section>
</template>

<style scoped>
.past {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 0 var(--gutter) 4px;
  scrollbar-width: none;
}
.pcard {
  flex: none;
  width: 230px;
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 10px;
  align-items: center;
  padding: 10px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(var(--amber-rgb), 0.16), var(--surface) 70%);
  text-align: left;
}
.pcard .cv {
  width: 52px;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.text small {
  font-size: 11.5px;
  color: var(--ink-2);
}
.text b {
  font-weight: 600;
  font-size: 14px;
}
.marks {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 0 var(--gutter) 4px;
  scrollbar-width: none;
}
.mark {
  flex: none;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 220px;
}
.mark b {
  font: 600 13px/1.3 var(--f-body);
}
.mark small {
  font-size: 11.5px;
  color: var(--ink-2);
}
.day {
  width: calc(100% - 2 * var(--gutter));
  margin: 0 var(--gutter) 8px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
.dhead {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.dhead b {
  font: 600 15px/1.2 var(--f-body);
}
.mood {
  width: 22px;
  height: 22px;
  margin-left: auto;
}
.dtop {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 10px;
  align-items: center;
}
.dtop .cv {
  width: 40px;
}
.new {
  font: 600 12px/1 var(--f-body);
  color: var(--amber-ink);
}
.note {
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--ink-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.more {
  width: calc(100% - 2 * var(--gutter));
  margin: 4px var(--gutter);
}
</style>
