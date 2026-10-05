<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import IconPlay from '~icons/solar/play-bold'
import IconPen from '~icons/solar/pen-linear'
import ScreenHeader from '@/components/ScreenHeader.vue'
import CoverArt from '@/components/CoverArt.vue'
import EraEditSheet from './EraEditSheet.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { customEras, periodStats, type EraRow, type PeriodStats } from '@/data/repos/eras'
import { seasonById } from '@/domain/seasons'
import { dayLabel } from '@/domain/weeks'
import { formatListen } from '@/domain/format'
import { displayArtist, type Track } from '@/domain/track'
import type { PlaySource } from '@/native/types'

/**
 * Эпоха: сколько и что звучало, фирменное звучание (что в этот период играло заметно чаще обычного),
 * новые открытия и «машина времени» — сыграть тот период заново.
 */
const route = useViewRoute()
const router = useRouter()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()
const id = computed(() => String(route.params.id))

const era = ref<{ title: string; from: string; to: string; custom: EraRow | null; color: string | null } | null>(null)
const stats = shallowRef<PeriodStats | null>(null)

async function load() {
  const v = id.value
  if (v.startsWith('s-')) {
    const s = seasonById(v.slice(2))
    era.value = s ? { title: s.title, from: s.startDay, to: s.endDay, custom: null, color: null } : null
  } else {
    const e = (await customEras()).find((x) => `c-${x.id}` === v)
    era.value = e ? { title: e.title, from: e.startDay, to: e.endDay, custom: e, color: e.color } : null
  }
  stats.value = era.value ? await periodStats(era.value.from, era.value.to) : null
}
onMounted(load)
watch(id, load)

const signature = computed(() =>
  (stats.value?.signature ?? []).flatMap((s) => {
    const t = library.byKey.get(s.key)
    return t ? [{ t, s }] : []
  }),
)
const top = computed(() =>
  (stats.value?.top ?? []).slice(0, 15).flatMap((r) => {
    const t = library.byKey.get(r.key)
    return t ? [{ t, plays: r.plays }] : []
  }),
)
const discoveries = computed(() =>
  (stats.value?.discoveries ?? []).map((k) => library.byKey.get(k)).filter((t): t is Track => !!t),
)
const source = computed<PlaySource>(() => ({ type: 'era', id: id.value, title: era.value?.title }))

/** Машина времени: сначала фирменное, потом остальной топ периода */
function timeMachine() {
  const seen = new Set<string>()
  const list = [...signature.value.map((x) => x.t), ...top.value.map((x) => x.t)].filter(
    (t) => !seen.has(t.key) && seen.add(t.key),
  )
  if (list.length) void player.playTracks(list, 0, source.value, { shuffle: true, kind: 'normal' })
}
function edit() {
  if (!era.value?.custom) return
  ui.openSheet(EraEditSheet, { era: era.value.custom, onSaved: (nid: number | null) => (nid ? load() : router.back()) })
}
</script>

<template>
  <div class="scroll screen">
    <ScreenHeader v-if="era" :title="era.title" :subtitle="`${dayLabel(era.from, true)} — ${dayLabel(era.to, true)}`" back>
      <template #actions>
        <button v-if="era.custom" type="button" class="icon-btn" aria-label="Изменить" @click="edit"><IconPen /></button>
      </template>
    </ScreenHeader>
    <template v-if="stats && era">
      <div class="tiles">
        <div class="tile">
          <small>Время</small><b>{{ formatListen(stats.listenedMs) }}</b>
        </div>
        <div class="tile">
          <small>Прослушивания</small><b>{{ stats.plays }}</b>
        </div>
        <div class="tile">
          <small>Разных треков</small><b>{{ stats.tracks }}</b>
        </div>
        <div class="tile">
          <small>Новых открытий</small><b>{{ discoveries.length }}</b>
        </div>
      </div>
      <p v-if="era.custom?.note" class="note">{{ era.custom.note }}</p>
      <div class="pad">
        <button type="button" class="btn primary block" :disabled="!top.length" @click="timeMachine">
          <IconPlay />Машина времени
        </button>
      </div>

      <template v-if="signature.length">
        <div class="section-title"><span>Фирменное звучание</span><span class="muted small">чаще, чем обычно</span></div>
        <button
          v-for="(x, i) in signature"
          :key="x.t.key"
          type="button"
          class="trow"
          @click="
            player.playTracks(
              signature.map((y) => y.t),
              i,
              source,
              { shuffle: false },
            )
          "
        >
          <CoverArt :art="x.t.art" :seed="x.t.title" :label="x.t.title" size="s" class="cv" />
          <span class="text">
            <span class="t ellipsis">{{ x.t.title }}</span>
            <span class="s ellipsis">{{ displayArtist(x.t) }}</span>
          </span>
          <span class="lift num">×{{ x.s.lift.toFixed(1).replace('.', ',') }}</span>
        </button>
      </template>

      <template v-if="top.length">
        <div class="section-title"><span>Топ периода</span></div>
        <button
          v-for="(x, i) in top"
          :key="x.t.key"
          type="button"
          class="trow"
          @click="
            player.playTracks(
              top.map((y) => y.t),
              i,
              source,
              { shuffle: false },
            )
          "
        >
          <CoverArt :art="x.t.art" :seed="x.t.title" :label="x.t.title" size="s" class="cv" />
          <span class="text">
            <span class="t ellipsis">{{ x.t.title }}</span>
            <span class="s ellipsis">{{ displayArtist(x.t) }}</span>
          </span>
          <span class="n num">{{ x.plays }}×</span>
        </button>
      </template>

      <template v-if="discoveries.length">
        <div class="section-title"><span>Открытия</span><span class="muted small">впервые в этот период</span></div>
        <div class="disc hscroll">
          <button
            v-for="(t, i) in discoveries.slice(0, 20)"
            :key="t.key"
            type="button"
            class="dcard"
            @click="player.playTracks(discoveries, i, source, { shuffle: false })"
          >
            <CoverArt :art="t.art" :seed="t.title" :label="t.title" size="m" class="dcv" />
            <span class="ellipsis">{{ t.title }}</span>
          </button>
        </div>
      </template>
      <div v-if="!stats.plays" class="empty"><h3>В этот период музыки не было</h3></div>
    </template>
    <div v-else-if="!era" class="empty"><h3>Эпоха не найдена</h3></div>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 4px var(--gutter);
}
.tile {
  background: var(--surface);
  border-radius: 16px;
  padding: 12px 14px;
}
.tile small {
  display: block;
  font-size: 12px;
  color: var(--ink-2);
}
.tile b {
  display: block;
  margin-top: 4px;
  font: 600 20px/1.2 var(--f-body);
}
.note {
  padding: 10px var(--gutter) 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-2);
}
.pad {
  padding: 12px var(--gutter) 0;
}
.small {
  font-size: 12.5px;
  font-weight: 500;
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
.lift {
  font: 600 13px/1 var(--f-body);
  color: var(--amber-ink);
}
.n {
  font: 600 13px/1 var(--f-body);
  color: var(--ink-2);
}
.disc {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 0 var(--gutter);
  scrollbar-width: none;
}
.dcard {
  flex: none;
  width: 120px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  text-align: left;
}
.dcv {
  width: 120px;
}
</style>
