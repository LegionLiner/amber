<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useViewRoute } from '@/app/view-route'
import IconPlay from '~icons/solar/play-bold'
import IconPen from '~icons/solar/pen-linear'
import ScreenHeader from '@/components/ScreenHeader.vue'
import CoverArt from '@/components/CoverArt.vue'
import ContextEditSheet from './ContextEditSheet.vue'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { contextStats, listContexts, startContext, stopContexts, type ContextRow, type ContextStats } from '@/data/repos/contexts'
import { formatListen } from '@/domain/format'
import { displayArtist, type Track } from '@/domain/track'
import type { PlaySource } from '@/native/types'

/** Контекст: его саундтрек (что чаще всего звучит в этой ситуации) и статистика */
const route = useViewRoute()
const router = useRouter()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()
const id = computed(() => Number(route.params.id))
const ctx = ref<ContextRow | null>(null)
const stats = shallowRef<ContextStats | null>(null)

async function load() {
  ctx.value = (await listContexts()).find((c) => c.id === id.value) ?? null
  stats.value = ctx.value ? await contextStats(ctx.value) : null
}
onMounted(load)
watch(id, load)

const tracks = computed(() =>
  (stats.value?.top ?? []).flatMap((r) => {
    const t = library.byKey.get(r.key)
    return t ? [{ t, plays: r.plays }] : []
  }),
)
const source = computed<PlaySource>(() => ({ type: 'context', id: String(id.value), title: ctx.value?.title }))

async function play(i = -1) {
  const list: Track[] = tracks.value.map((x) => x.t)
  if (!list.length) return
  if (i < 0) await player.playTracks(list, -1, source.value, { shuffle: true, kind: 'smart' })
  else await player.playTracks(list, i, source.value, { shuffle: false })
  if (ctx.value && ctx.value.running == null) {
    await startContext(ctx.value.id)
    await load()
  }
}
async function toggle() {
  if (!ctx.value) return
  if (ctx.value.running != null) await stopContexts()
  else await startContext(ctx.value.id)
  await load()
}
function edit() {
  if (ctx.value)
    ui.openSheet(ContextEditSheet, {
      ctx: ctx.value,
      onSaved: async () => ((await listContexts()).some((c) => c.id === id.value) ? load() : router.back()),
    })
}
</script>

<template>
  <div class="scroll screen">
    <ScreenHeader
      v-if="ctx"
      :title="ctx.title"
      :subtitle="stats ? `${formatListen(stats.listenedMs)} · ${stats.plays} прослуш.` : ''"
      back
    >
      <template #actions>
        <button type="button" class="icon-btn" aria-label="Изменить" @click="edit"><IconPen /></button>
      </template>
    </ScreenHeader>
    <div v-if="ctx" class="btns">
      <button type="button" class="btn primary" :disabled="!tracks.length" @click="play()"><IconPlay />Саундтрек</button>
      <button type="button" class="btn" @click="toggle">{{ ctx.running != null ? 'Закончить' : 'Начать без музыки' }}</button>
    </div>
    <div v-if="tracks.length" class="section-title"><span>Чаще всего звучит</span></div>
    <button v-for="(x, i) in tracks" :key="x.t.key" type="button" class="trow" @click="play(i)">
      <CoverArt :art="x.t.art" :seed="x.t.title" :label="x.t.title" size="s" class="cv" />
      <span class="text">
        <span class="t ellipsis">{{ x.t.title }}</span>
        <span class="s ellipsis">{{ displayArtist(x.t) }}</span>
      </span>
      <span class="n num">{{ x.plays }}×</span>
    </button>
    <div v-if="ctx && !tracks.length" class="empty">
      <h3>Саундтрек пока пуст</h3>
      <p>Нажми «Начать», когда окажешься в этой ситуации, или задай правила — музыка запишется сама.</p>
    </div>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.btns {
  display: flex;
  gap: 10px;
  padding: 4px var(--gutter) 6px;
}
.btns .btn {
  flex: 1;
  font-size: 14px;
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
.n {
  font: 600 13px/1 var(--f-body);
  color: var(--ink-2);
}
</style>
