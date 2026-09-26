<script setup lang="ts">
import { computed, onActivated, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import IconAdd from '~icons/solar/add-circle-linear'
import EraEditSheet from './EraEditSheet.vue'
import { useUi } from '@/stores/ui'
import { customEras, historyBounds, playsByDay, type EraRow } from '@/data/repos/eras'
import { seasonOf, seasonsBetween, type Season } from '@/domain/seasons'
import { dayLabel, parseDay } from '@/domain/weeks'
import { formatListen } from '@/domain/format'
import { todayKey } from '@/domain/streaks'

/**
 * Эпохи: сезоны собираются сами из истории, свои эпохи задаются датами.
 * У каждой — фирменное звучание и «машина времени».
 */
const router = useRouter()
const ui = useUi()
const eras = shallowRef<EraRow[]>([])
const days = shallowRef<{ day: string; plays: number; listenedMs: number }[]>([])
const bounds = shallowRef<{ first: string | null; last: string | null }>({ first: null, last: null })

async function load() {
  const [e, d, b] = await Promise.all([customEras(), playsByDay(), historyBounds()])
  eras.value = e
  days.value = d
  bounds.value = b
}
onMounted(load)
onActivated(load)

function sum(from: string, to: string) {
  let plays = 0
  let ms = 0
  for (const d of days.value) {
    if (d.day >= from && d.day <= to) {
      plays += d.plays
      ms += d.listenedMs
    }
  }
  return { plays, ms }
}

const today = todayKey()
const currentSeason = seasonOf(new Date())
const seasons = computed(() => {
  if (!bounds.value.first) return []
  return seasonsBetween(parseDay(bounds.value.first), new Date())
    .reverse()
    .map((s: Season) => ({ s, ...sum(s.startDay, s.endDay) }))
    .filter((x) => x.plays > 0 || x.s.id === currentSeason.id)
})
const mine = computed(() => eras.value.map((e) => ({ e, ...sum(e.startDay, e.endDay) })))

function create() {
  ui.openSheet(EraEditSheet, { onSaved: (id: number | null) => (id ? router.push(`/era/c-${id}`) : load()) })
}
</script>

<template>
  <section>
    <div class="section-title"><span>Твои эпохи</span></div>
    <button
      v-for="x in mine"
      :key="x.e.id"
      type="button"
      class="era"
      :style="{ '--ec': x.e.color ?? 'var(--amber)' }"
      @click="router.push(`/era/c-${x.e.id}`)"
    >
      <b>{{ x.e.title }}</b>
      <small>{{ dayLabel(x.e.startDay, true) }} — {{ dayLabel(x.e.endDay, true) }}</small>
      <span class="stat">{{ x.plays ? `${formatListen(x.ms)} · ${x.plays} прослуш.` : 'пока без музыки' }}</span>
    </button>
    <button type="button" class="add" @click="create"><IconAdd />Своя эпоха</button>

    <div class="section-title"><span>Сезоны</span></div>
    <button
      v-for="x in seasons"
      :key="x.s.id"
      type="button"
      class="era season"
      :class="{ now: x.s.id === currentSeason.id }"
      @click="router.push(`/era/s-${x.s.id}`)"
    >
      <b>{{ x.s.title }}</b>
      <small>{{
        x.s.id === currentSeason.id
          ? `идёт сейчас, до ${dayLabel(x.s.endDay)}`
          : `${dayLabel(x.s.startDay)} — ${dayLabel(x.s.endDay)}`
      }}</small>
      <span class="stat">{{ x.plays ? `${formatListen(x.ms)} · ${x.plays} прослуш.` : 'пока тихо' }}</span>
    </button>
    <p v-if="!seasons.length" class="lead muted">Сезоны появятся, когда накопится история. Сегодня {{ dayLabel(today) }}.</p>
  </section>
</template>

<style scoped>
.era {
  position: relative;
  width: calc(100% - 2 * var(--gutter));
  margin: 0 var(--gutter) 8px;
  padding: 14px 16px 14px 20px;
  border-radius: 16px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  overflow: hidden;
}
.era::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 5px;
  background: var(--ec);
}
.season {
  --ec: var(--line-strong);
}
.season.now {
  --ec: var(--amber);
  background: linear-gradient(135deg, rgba(var(--amber-rgb), 0.14), var(--surface) 70%);
}
.era b {
  font: 600 16px/1.2 var(--f-body);
}
.era small {
  font-size: 12.5px;
  color: var(--ink-2);
}
.stat {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--amber-ink);
}
.add {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 var(--gutter);
  padding: 12px 4px;
  color: var(--amber-ink);
  font: 500 14.5px/1 var(--f-body);
}
.add svg {
  width: 22px;
  height: 22px;
}
.lead {
  padding: 4px var(--gutter);
  font-size: 13px;
}
</style>
