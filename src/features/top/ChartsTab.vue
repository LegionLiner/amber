<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import IconLeft from '~icons/solar/alt-arrow-left-linear'
import IconRight from '~icons/solar/alt-arrow-right-linear'
import RankRow from './RankRow.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { archivedWeek, archivedWeeks, chartHistory, liveWeekChart, type ChartEntry } from '@/data/repos/charts'
import { prevWeek, weekKey, weekLabel } from '@/domain/weeks'
import { displayArtist, type Track } from '@/domain/track'
import { onPageShown } from '@/app/paging'
import { $t } from '@/i18n'

/**
 * Чарты по прослушиваниям. Неделя — топ-20 с понедельника; закрытые недели хранятся в архиве,
 * поэтому видно движение (▲▼), новичков (NEW), возвращения (RE), пик и сколько недель трек в чарте.
 */
const library = useLibrary()
const player = usePlayer()
const current = weekKey(new Date())
const week = ref(current)
const weeks = ref<string[]>([])
const entries = shallowRef<{ track: Track; e: ChartEntry }[]>([])
const prev = shallowRef(new Map<string, number>())
const history = shallowRef<Awaited<ReturnType<typeof chartHistory>>>(new Map())

async function load() {
  weeks.value = [current, ...(await archivedWeeks()).filter((w) => w !== current)]
  history.value = await chartHistory()
  await loadWeek()
}
async function loadWeek() {
  const rows = week.value === current ? await liveWeekChart(week.value) : await archivedWeek(week.value)
  entries.value = rows.flatMap((e) => {
    const t = library.byKey.get(e.key)
    return t ? [{ track: t, e }] : []
  })
  const p = await archivedWeek(prevWeek(week.value))
  prev.value = new Map(p.map((r, i) => [r.key, i + 1]))
}
onMounted(load)
onPageShown(load)
watch(week, loadWeek)

const idx = computed(() => weeks.value.indexOf(week.value))
function step(d: number) {
  const w = weeks.value[idx.value + d]
  if (w) week.value = w
}

function move(key: string, pos: number): number | 'new' | 're' | null {
  const was = prev.value.get(key)
  if (was != null) return was - pos
  const h = history.value.get(key)
  // Был в чарте раньше, но не на прошлой неделе — возвращение
  if (h && [...h.positions.keys()].some((w) => w < prevWeek(week.value))) return 're'
  return prev.value.size || history.value.size ? 'new' : null
}
function sub(t: Track): string {
  const h = history.value.get(t.key)
  return h ? $t('{0} · пик {1}, {2} нед.', displayArtist(t), h.peak, h.weeks) : displayArtist(t)
}

const allTime = computed(() =>
  [...library.tracks]
    .filter((t) => t.plays > 0)
    .sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs)
    .slice(0, 100),
)
</script>

<template>
  <section>
    <div class="weekbar">
      <button
        type="button"
        class="icon-btn"
        :disabled="idx >= weeks.length - 1"
        :aria-label="$t('Неделя раньше')"
        @click="step(1)"
      >
        <IconLeft />
      </button>
      <div class="wk">
        <b>{{ week === current ? $t('Эта неделя') : weekLabel(week) }}</b>
        <small class="muted">{{ week === current ? $t('{0}, идёт сейчас', weekLabel(week)) : week }}</small>
      </div>
      <button type="button" class="icon-btn" :disabled="idx <= 0" :aria-label="$t('Неделя позже')" @click="step(-1)">
        <IconRight />
      </button>
    </div>
    <RankRow
      v-for="(c, i) in entries"
      :key="c.track.key"
      :pos="i + 1"
      :track="c.track"
      :move="move(c.track.key, i + 1)"
      :sub="sub(c.track)"
      :right="`${c.e.plays}×`"
      :first="i === 0"
      :now="player.current?.key === c.track.key"
      @tap="
        player.playTracks(
          entries.map((x) => x.track),
          i,
          { type: 'top', id: `week-${week}`, title: $t('Чарт недели') },
          { shuffle: false },
        )
      "
    />
    <p v-if="!entries.length" class="lead muted">{{ $t('За эту неделю ещё ничего не засчитано.') }}</p>

    <div class="section-title">
      <span>{{ $t('Вечный чарт') }}</span
      ><span class="muted small">{{ $t('за всё время') }}</span>
    </div>
    <RankRow
      v-for="(t, i) in allTime"
      :key="t.key"
      :pos="i + 1"
      :track="t"
      :right="`${t.plays}×`"
      :now="player.current?.key === t.key"
      @tap="player.playTracks(allTime, i, { type: 'top', id: 'all', title: $t('Вечный чарт') }, { shuffle: false })"
    />
    <p v-if="!allTime.length" class="lead muted">{{ $t('Послушай что-нибудь, и здесь появится твой вечный чарт.') }}</p>
  </section>
</template>

<style scoped>
.weekbar {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
  gap: 8px;
  padding: 0 var(--gutter) 8px;
}
.wk {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wk b {
  font: 600 15px/1.2 var(--f-body);
}
.wk small {
  font-size: 12px;
}
.icon-btn:disabled {
  opacity: 0.3;
}
.lead {
  padding: 4px var(--gutter) 12px;
  font-size: 13.5px;
}
.small {
  font-size: 12.5px;
  font-weight: 500;
}
</style>
