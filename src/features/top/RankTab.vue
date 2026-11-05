<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import IconPlay from '~icons/solar/play-bold'
import IconSort from '~icons/solar/sort-vertical-linear'
import IconUp from '~icons/solar/arrow-up-linear'
import IconDown from '~icons/solar/arrow-down-linear'
import RankRow from './RankRow.vue'
import RefineBucket from './RefineBucket.vue'
import TrackActionsSheet from '@/components/TrackActionsSheet.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { rankSnapshot } from '@/data/repos/charts'
import { dismiss, dismissedKeys } from '@/data/repos/tags'
import { sortTracks } from '@/domain/sort'
import { ratingSuggestions, starsLabel } from '@/domain/rating'
import { weekKey } from '@/domain/weeks'
import type { Track } from '@/domain/track'
import type { PlaySource } from '@/native/types'
import { onPageShown } from '@/app/paging'
import { $t } from '@/i18n'

/**
 * Мой рейтинг: все оценённые треки по местам. Стрелки — движение с начала недели.
 * «Уточнить» — перетаскивание внутри одинаковых звёзд.
 */
const emit = defineEmits<{ rate: [] }>()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()

const ranked = computed(() =>
  sortTracks(
    library.tracks.filter((t) => t.rating != null),
    'rating',
    'desc',
  ),
)
const source: PlaySource = { type: 'top', id: 'rank', title: $t('Мой рейтинг') }
const baseline = shallowRef(new Map<string, number>())
const refining = ref(false)
const skip = shallowRef(new Set<string>())

async function load() {
  baseline.value = await rankSnapshot(weekKey(new Date()))
  skip.value = await dismissedKeys('suggest')
}
onMounted(load)
onPageShown(load)

function move(t: Track, i: number): number | 'new' | null {
  if (!baseline.value.size) return null
  const was = baseline.value.get(t.key)
  return was == null ? 'new' : was - (i + 1)
}

const suggestions = computed(() =>
  ratingSuggestions(library.tracks)
    .filter((s) => !skip.value.has(`${s.key}:${s.to}`))
    .slice(0, 3)
    .map((s) => ({ ...s, track: library.byKey.get(s.key)! }))
    .filter((s) => s.track),
)

async function acceptSuggestion(key: string, to: number) {
  await library.setRating(key, to)
  ui.toast($t('Теперь {0}', starsLabel(to)))
}
async function rejectSuggestion(key: string, to: number) {
  await dismiss('suggest', [`${key}:${to}`])
  skip.value = new Set(skip.value).add(`${key}:${to}`)
}

const buckets = computed(() => {
  const out: { rating: number; tracks: Track[]; start: number }[] = []
  let pos = 1
  for (const t of ranked.value) {
    let b = out[out.length - 1]
    if (!b || b.rating !== t.rating) {
      b = { rating: t.rating!, tracks: [], start: pos }
      out.push(b)
    }
    b.tracks.push(t)
    pos++
  }
  return out
})

function more(t: Track) {
  ui.openSheet(TrackActionsSheet, { trackKey: t.key, source })
}
</script>

<template>
  <section>
    <div v-if="ranked.length" class="bar-row">
      <span class="muted">{{ $t('{0} с оценкой', ranked.length) }}</span>
      <span class="acts">
        <button type="button" class="btn small" :class="{ on: refining }" @click="refining = !refining">
          <IconSort />{{ refining ? $t('Готово') : $t('Уточнить') }}
        </button>
        <button type="button" class="btn primary small" @click="player.playTracks(ranked, 0, source, { shuffle: false })">
          <IconPlay />{{ $t('По порядку') }}
        </button>
      </span>
    </div>

    <div v-if="suggestions.length && !refining" class="suggest">
      <h3>{{ $t('Оценка расходится с тем, как ты слушаешь') }}</h3>
      <div v-for="s in suggestions" :key="s.key" class="srow">
        <span class="text">
          <b class="ellipsis">{{ s.track.title }}</b>
          <small>{{ starsLabel(s.from) }} → {{ starsLabel(s.to) }}: {{ s.reason }}</small>
        </span>
        <button type="button" class="btn small" @click="acceptSuggestion(s.key, s.to)">
          <component :is="s.to > s.from ? IconUp : IconDown" />{{ starsLabel(s.to) }}
        </button>
        <button type="button" class="x" :aria-label="$t('Не то')" @click="rejectSuggestion(s.key, s.to)">×</button>
      </div>
    </div>

    <template v-if="refining">
      <p class="lead muted">{{ $t('Перетаскивай за ручку внутри группы. Звёзды не меняются, меняется порядок мест.') }}</p>
      <RefineBucket v-for="b in buckets" :key="b.rating" :rating="b.rating" :tracks="b.tracks" :start-pos="b.start" />
    </template>
    <template v-else>
      <RankRow
        v-for="(t, i) in ranked"
        :key="t.key"
        :pos="i + 1"
        :track="t"
        :move="move(t, i)"
        :right="starsLabel(t.rating)"
        :first="i === 0"
        :now="player.current?.key === t.key"
        @tap="player.playTracks(ranked, i, source, { shuffle: false })"
        @more="more(t)"
      />
    </template>

    <div v-if="!ranked.length" class="empty">
      <h3>{{ $t('Рейтинг пока пуст') }}</h3>
      <p>{{ $t('Поставь звёзды трекам: в плеере, в карточке или во вкладке «Оценить». Места появятся сами.') }}</p>
      <button type="button" class="btn primary" @click="emit('rate')">{{ $t('Оценить треки') }}</button>
    </div>
  </section>
</template>

<style scoped>
.bar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px var(--gutter) 10px;
  font-size: 13px;
}
.acts {
  display: flex;
  gap: 8px;
}
.btn.small {
  min-height: 36px;
  padding: 0 14px;
  font-size: 13.5px;
}
.btn.small.on {
  color: var(--amber-ink);
}
.suggest {
  margin: 0 var(--gutter) 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(var(--amber-rgb), 0.14), var(--surface) 70%);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.suggest h3 {
  font: 600 14px/1.3 var(--f-body);
}
.srow {
  display: grid;
  grid-template-columns: 1fr auto 28px;
  gap: 8px;
  align-items: center;
}
.srow .text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.srow b {
  font-weight: 500;
  font-size: 14px;
}
.srow small {
  font-size: 12px;
  color: var(--ink-2);
}
.x {
  font-size: 20px;
  color: var(--ink-3);
}
.lead {
  padding: 0 var(--gutter) 6px;
  font-size: 13px;
  line-height: 1.45;
}
</style>
