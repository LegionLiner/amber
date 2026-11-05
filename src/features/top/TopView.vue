<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import IconPlay from '~icons/solar/play-bold'
import HeadSpace from '@/components/HeadSpace.vue'
import CoverArt from '@/components/CoverArt.vue'
import RatingStars from '@/components/RatingStars.vue'
import RankTab from './RankTab.vue'
import ChartsTab from './ChartsTab.vue'
import DuelsTab from './DuelsTab.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { displayArtist, type Track } from '@/domain/track'
import { onPageShown } from '@/app/paging'
import { isDesktop } from '@/native/desktop/bridge'
import { $t } from '@/i18n'

type TopTab = 'rank' | 'rate' | 'charts' | 'duels'

const route = useViewRoute()
const router = useRouter()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()
const scrollEl = ref<HTMLElement | null>(null)

/** Вкладка — это место экрана в ленте: у каждой вкладки свой экран, соседние отрисованы заранее */
const tab = computed(() => (route.query.tab as TopTab) || 'rank')
function setTab(t: TopTab) {
  void router.replace({ path: '/top', query: { tab: t } })
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
onPageShown(() => (justRated.value = new Set()))
</script>

<template>
  <div ref="scrollEl" class="scroll screen">
    <HeadSpace />

    <RankTab v-if="tab === 'rank'" @rate="setTab('rate')" />
    <DuelsTab v-else-if="tab === 'duels'" />
    <ChartsTab v-else-if="tab === 'charts'" />
    <section v-else>
      <p class="lead muted">
        {{
          $t(
            'Сначала треки, которые ты слушаешь чаще всего. {0}',
            isDesktop ? $t('Нажми на звезду — левая половина ставит оценку с половинкой.') : $t('Проведи пальцем по звёздам.'),
          )
        }}
      </p>
      <!-- .rate-grid на телефоне «прозрачная» (список строк), на компьютере — сетка карточек -->
      <div class="rate-grid">
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
            :aria-label="$t('Послушать')"
            @click="player.playTracks([t], 0, { type: 'track', title: t.title }, { shuffle: false })"
          >
            <IconPlay />
          </button>
        </div>
      </div>
      <div v-if="!toRate.length" class="empty">
        <h3>{{ $t('Всё оценено') }}</h3>
        <p>{{ $t('Каждый трек в библиотеке уже со звёздами.') }}</p>
      </div>
    </section>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
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
.rate-grid {
  display: contents;
}
:root.desktop .rate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 10px;
  padding: 0 var(--gutter);
}
:root.desktop .rate-row {
  padding: 12px 10px 12px 12px;
  border-radius: 20px;
  background: var(--glass-card);
  box-shadow: var(--glass-hi);
  transition:
    opacity var(--t-mid) var(--ease),
    background var(--t-fast) var(--ease);
}
:root.desktop .rate-row:hover {
  background: var(--glass-card-hover);
}
</style>
