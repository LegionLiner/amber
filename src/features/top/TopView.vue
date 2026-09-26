<script setup lang="ts">
import { computed, onActivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import IconPlay from '~icons/solar/play-bold'
import ChipTabs from '@/components/ChipTabs.vue'
import CoverArt from '@/components/CoverArt.vue'
import RatingStars from '@/components/RatingStars.vue'
import RankTab from './RankTab.vue'
import ChartsTab from './ChartsTab.vue'
import DuelsTab from './DuelsTab.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { displayArtist, type Track } from '@/domain/track'

type TopTab = 'rank' | 'rate' | 'charts' | 'duels'
const TABS: { id: TopTab; label: string }[] = [
  { id: 'rank', label: 'Мой рейтинг' },
  { id: 'duels', label: 'Дуэли' },
  { id: 'charts', label: 'Чарты' },
  { id: 'rate', label: 'Оценить' },
]

const route = useRoute()
const router = useRouter()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()
const scrollEl = ref<HTMLElement | null>(null)

const tab = ref<TopTab>((route.query.tab as TopTab) || 'rank')
watch(
  () => route.query.tab,
  (t) => t && (tab.value = t as TopTab),
)
function setTab(t: TopTab) {
  tab.value = t
  void router.replace({ query: { tab: t } })
}
watch(
  () => ui.reselect,
  (r) => r.tab === 'top' && scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' }),
)

/* ---- оценить: сначала то, что слушаешь чаще всего ---- */
const justRated = ref(new Set<string>())
const toRate = computed(() =>
  library.tracks
    .filter((t) => t.rating == null || justRated.value.has(t.key))
    .sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs)
    .slice(0, 60),
)
function rateInline(t: Track, v: number | null) {
  justRated.value = new Set(justRated.value).add(t.key)
  void library.setRating(t.key, v)
}
onActivated(() => (justRated.value = new Set()))
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <header class="hdr">
      <h1 class="display title">Топ</h1>
    </header>
    <ChipTabs :items="TABS" :model-value="tab" @update:model-value="setTab" />

    <RankTab v-if="tab === 'rank'" @rate="setTab('rate')" />
    <DuelsTab v-else-if="tab === 'duels'" />
    <ChartsTab v-else-if="tab === 'charts'" />
    <section v-else>
      <p class="lead muted">Сначала треки, которые ты слушаешь чаще всего. Проведи пальцем по звёздам.</p>
      <div v-for="t in toRate" :key="t.key" class="rate-row" :class="{ done: t.rating != null }">
        <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="s" class="cv" />
        <span class="text">
          <span class="t ellipsis">{{ t.title }}</span>
          <span class="s ellipsis"
            >{{ displayArtist(t) }}<template v-if="t.plays"> · {{ t.plays }}×</template></span
          >
          <RatingStars :model-value="t.rating" :size="24" @update:model-value="(v) => rateInline(t, v)" />
        </span>
        <button
          type="button"
          class="icon-btn"
          aria-label="Послушать"
          @click="player.playTracks([t], 0, { type: 'track', title: t.title }, { shuffle: false })"
        >
          <IconPlay />
        </button>
      </div>
      <div v-if="!toRate.length" class="empty">
        <h3>Всё оценено</h3>
        <p>Каждый трек в библиотеке уже со звёздами.</p>
      </div>
    </section>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.hdr {
  padding: calc(var(--safe-top) + 10px) var(--gutter) 6px;
}
.title {
  font-size: 26px;
  font-weight: 600;
  min-height: 48px;
  display: flex;
  align-items: center;
}
.lead {
  padding: 4px var(--gutter) 12px;
  font-size: 13.5px;
  line-height: 1.45;
}
.rate-row {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px var(--gutter);
  transition: opacity var(--t-mid) var(--ease);
}
.rate-row.done {
  opacity: 0.45;
}
.cv {
  width: 56px;
}
.text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.t {
  font: 500 15px/1.25 var(--f-body);
}
.s {
  font-size: 12.5px;
  color: var(--ink-2);
}
</style>
