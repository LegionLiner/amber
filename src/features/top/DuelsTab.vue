<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import IconPlay from '~icons/solar/play-bold'
import IconStop from '~icons/solar/stop-bold'
import CoverArt from '@/components/CoverArt.vue'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { MusicCore } from '@/native/music-core'
import { bookmarksFor } from '@/data/repos/bookmarks'
import { duelCount, recentDuels, saveDuel } from '@/data/repos/duels'
import { applyDuel, pickPair, type DuelPair } from '@/domain/duels'
import { starsLabel } from '@/domain/rating'
import { displayArtist, type Track } from '@/domain/track'
import { haptic } from '@/native/haptics'
import { onPageShown, onPageHidden } from '@/app/paging'
import { $t } from '@/i18n'

/**
 * Дуэли: два трека с одинаковыми звёздами, выбираешь тот, что лучше. Можно послушать по 15 секунд
 * из каждого — лучший момент, если он отмечен, иначе с трети трека.
 * Пограничные дуэли сравнивают соседние группы звёзд и подсказывают, если оценка устарела.
 */
const library = useLibrary()
const ui = useUi()

const pair = shallowRef<DuelPair<Track> | null>(null)
const total = ref(0)
const session = ref(0)
const playing = ref<string | null>(null)
const picked = ref<'a' | 'b' | 'draw' | null>(null)
const recent = new Set<string>()
const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`)

async function load() {
  total.value = await duelCount()
  for (const d of await recentDuels(300)) recent.add(pairKey(d.aKey, d.bKey))
  if (!pair.value) next()
}
onMounted(load)
onPageShown(load)
onPageHidden(stop)
onBeforeUnmount(() => {
  void stop()
  void endHandle?.remove()
})

function next() {
  picked.value = null
  pair.value = pickPair(library.tracks, recent)
}

async function snippetFrom(t: Track): Promise<number> {
  const best = (await bookmarksFor(t.key)).find((b) => b.kind === 'best')
  if (best) return Math.max(0, best.positionMs - 1500)
  return Math.round(t.durationMs * 0.35)
}

let endHandle: { remove: () => Promise<void> } | null = null
async function preview(t: Track) {
  if (playing.value === t.key) return stop()
  playing.value = t.key
  endHandle ??= await MusicCore.addListener('previewEnded', () => (playing.value = null))
  await MusicCore.previewSnippet({ uri: t.uri, fromMs: await snippetFrom(t), durationMs: 15000, gainDb: t.gainOffsetDb })
}
async function stop() {
  if (playing.value) await MusicCore.previewStop()
  playing.value = null
}

async function decide(result: 1 | 0 | 0.5) {
  const p = pair.value
  if (!p || picked.value) return
  picked.value = result === 1 ? 'a' : result === 0 ? 'b' : 'draw'
  haptic.success()
  void stop()
  const r = applyDuel(p.a, p.b, result)
  library.patchMany(
    new Map([
      [p.a.key, { rankScore: r.a, duels: p.a.duels + 1 }],
      [p.b.key, { rankScore: r.b, duels: p.b.duels + 1 }],
    ]),
  )
  await saveDuel(p.a.key, p.b.key, result, r.a, r.b)
  recent.add(pairKey(p.a.key, p.b.key))
  total.value++
  session.value++
  // Пограничная дуэль: трек с меньшей оценкой победил — возможно, пора его поднять
  if (p.border && result !== 0.5) {
    const winner = result === 1 ? p.a : p.b
    const loser = result === 1 ? p.b : p.a
    if ((winner.rating ?? 0) < (loser.rating ?? 0)) {
      ui.toast(
        $t('«{0}» обошёл трек на {1}', winner.title, starsLabel(loser.rating)),
        {
          label: $t('Поднять до {0}', starsLabel(loser.rating)),
          run: () => void library.setRating(winner.key, loser.rating),
        },
        6000,
      )
    }
  }
  setTimeout(next, 450)
}

function skip() {
  const p = pair.value
  if (p) recent.add(pairKey(p.a.key, p.b.key))
  void stop()
  next()
}
</script>

<template>
  <section class="duels">
    <p class="lead muted">
      {{ $t('Выбери, какой лучше. Места внутри одинаковых звёзд уточняются сами, как рейтинг Эло.') }}
      <template v-if="total">
        {{ $t('Проведено дуэлей: {0}', total) }}<template v-if="session">{{ $t(', сейчас {0}', session) }}</template
        >.</template
      >
    </p>
    <template v-if="pair">
      <p v-if="pair.border" class="border">
        {{ $t('Пограничная: {0} против {1}', starsLabel(pair.a.rating), starsLabel(pair.b.rating)) }}
      </p>
      <div class="pair">
        <div
          v-for="side in ['a', 'b'] as const"
          :key="side"
          class="card"
          :class="{ win: picked === side, lose: picked && picked !== side && picked !== 'draw' }"
          role="button"
          tabindex="0"
          @click="decide(side === 'a' ? 1 : 0)"
        >
          <CoverArt
            :art="pair[side].art"
            :seed="pair[side].title"
            :label="pair[side].title"
            size="m"
            radius="var(--r-m)"
            class="cv"
          />
          <b class="ellipsis2">{{ pair[side].title }}</b>
          <small class="ellipsis">{{ displayArtist(pair[side]) }}</small>
          <span class="meta">{{ starsLabel(pair[side].rating) }} · {{ pair[side].plays }}×</span>
          <button
            type="button"
            class="listen"
            :aria-label="playing === pair[side].key ? $t('Стоп') : $t('Послушать')"
            @click.stop="preview(pair[side])"
          >
            <IconStop v-if="playing === pair[side].key" /><IconPlay v-else />
          </button>
        </div>
      </div>
      <div class="btns">
        <button type="button" class="btn" @click="decide(0.5)">{{ $t('Одинаково') }}</button>
        <button type="button" class="btn" @click="skip">{{ $t('Пропустить') }}</button>
      </div>
    </template>
    <div v-else class="empty">
      <h3>{{ $t('Пока не с кем сравнивать') }}</h3>
      <p>{{ $t('Нужно хотя бы два трека с одинаковой оценкой.') }}</p>
    </div>
  </section>
</template>

<style scoped>
.lead {
  padding: 0 var(--gutter) 10px;
  font-size: 13px;
  line-height: 1.45;
}
.border {
  margin: 0 var(--gutter) 10px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(var(--amber-rgb), 0.14);
  color: var(--amber-ink);
  font: 500 13px/1.3 var(--f-body);
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 0 var(--gutter);
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border-radius: 18px;
  background: var(--surface);
  cursor: pointer;
  transition:
    transform 260ms var(--ease-out),
    opacity 260ms var(--ease),
    box-shadow 260ms var(--ease);
}
.card:active {
  transform: scale(0.98);
}
.card.win {
  transform: scale(1.03);
  box-shadow:
    0 0 0 2px var(--amber),
    0 14px 36px -12px rgba(var(--amber-rgb), 0.6);
}
.card.lose {
  opacity: 0.4;
  transform: scale(0.96);
}
.cv {
  width: 100%;
  margin-bottom: 6px;
}
.card b {
  font: 600 14.5px/1.25 var(--f-body);
}
.ellipsis2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card small {
  font-size: 12.5px;
  color: var(--ink-2);
}
.meta {
  font-size: 11.5px;
  color: var(--amber-ink);
}
.listen {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  backdrop-filter: blur(8px);
}
.listen svg {
  width: 18px;
  height: 18px;
}
.btns {
  display: flex;
  gap: 10px;
  padding: 14px var(--gutter) 0;
}
.btns .btn {
  flex: 1;
}
</style>
