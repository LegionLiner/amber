<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import IconText from '~icons/solar/document-text-linear'
import IconQueue from '~icons/solar/playlist-linear'
import CoverArt from '@/components/CoverArt.vue'
import LyricsSheet from '@/features/player/LyricsSheet.vue'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { MusicCore } from '@/native/music-core'
import { savedLyrics } from '@/data/repos/tags'
import { lineAt, parseLrc, type LyricLine } from '@/domain/lyrics'
import { lrclibId } from '@/domain/lrclib'
import { formatDuration } from '@/domain/format'

/**
 * То, что на компьютере показывается рядом с играющим треком — и в панели «Сейчас играет»,
 * и в большом плеере: текущие строки текста (если он синхронный) и ближайшие треки очереди.
 *
 * Текст берётся только тот, что уже есть (свой, из LRCLIB или из файла): искать его в сети —
 * дело окна текста, оно открывается по нажатию.
 */
const props = withDefaults(defineProps<{ next?: number }>(), { next: 5 })

const player = usePlayer()
const library = useLibrary()
const ui = useUi()
const item = computed(() => player.current)

const lines = shallowRef<LyricLine[] | null>(null)
const hasPlain = shallowRef(false)
let token = 0
async function loadLyrics() {
  const it = item.value
  const my = ++token
  lines.value = null
  hasPlain.value = false
  if (!it) return
  try {
    const mine = await savedLyrics(it.key)
    let synced: LyricLine[] | null = null
    let plain = false
    if (mine) {
      synced = parseLrc(mine)
      plain = !synced && lrclibId(mine) !== 0 && mine.trim().length > 0
    } else {
      const r = await MusicCore.lyrics({ uri: it.uri, path: player.currentTrack?.path }).catch(() => null)
      synced = r?.synced?.length ? r.synced : r?.text ? parseLrc(r.text) : null
      plain = !synced && !!r?.text
    }
    if (my !== token) return
    lines.value = synced
    hasPlain.value = plain
  } catch {
    /* текста нет — блок просто не показывается */
  }
}
// Перечитываем и после закрытия шторки: в окне текста его могли найти или поправить
watch([() => item.value?.key, () => ui.sheet?.component], loadLyrics, { immediate: true })

const cur = computed(() => (lines.value ? lineAt(lines.value, player.position + 250) : -1))
/** Строка перед текущей, текущая и две следующих */
const shown = computed(() => {
  const l = lines.value
  if (!l) return []
  const start = Math.max(0, Math.min(cur.value, l.length - 3) - 1)
  return l.slice(start, start + 4).map((x, i) => ({ ...x, i: start + i }))
})

const upNext = computed(() => player.upcoming.slice(0, props.next))
</script>

<template>
  <div class="extras">
    <button v-if="lines" type="button" class="lyrics" aria-label="Открыть текст песни" @click="ui.openSheet(LyricsSheet)">
      <span v-for="l in shown" :key="l.i" class="ll" :class="{ now: l.i === cur, past: l.i < cur }">{{ l.line || '♪' }}</span>
    </button>
    <button v-else type="button" class="ghost" @click="ui.openSheet(LyricsSheet)">
      <IconText />{{ hasPlain ? 'Текст песни' : 'Найти текст' }}
    </button>

    <section class="next">
      <div class="next-head">
        <span class="label">Далее</span>
        <button type="button" class="more" @click="ui.queueOpen = true">
          <IconQueue />{{ player.upcoming.length ? `Вся очередь · ${player.upcoming.length}` : 'Очередь' }}
        </button>
      </div>
      <button v-for="(q, i) in upNext" :key="q.qid" type="button" class="nrow" @click="player.jump(player.index + 1 + i)">
        <CoverArt :art="library.byKey.get(q.key)?.art" :seed="q.title" :label="q.title" size="s" radius="8px" class="ncv" />
        <span class="ntext">
          <span class="nt ellipsis">{{ q.title }}</span>
          <span class="na ellipsis">{{ q.artist }}</span>
        </span>
        <span class="nd num">{{ formatDuration(q.durationMs) }}</span>
      </button>
      <p v-if="!upNext.length" class="empty-next">Дальше тишина. Добавь треки в очередь из любого списка.</p>
    </section>
  </div>
</template>

<style scoped>
.extras {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.label {
  font: 600 12.5px/1 var(--f-body);
  color: var(--ink-2);
}
.lyrics {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 14px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--ink) 5%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 5%, transparent);
  text-align: left;
  transition: background var(--t-fast) var(--ease);
}
.lyrics:hover {
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}
.ll {
  font: 600 14.5px/1.3 var(--f-body);
  color: var(--ink-3);
  transition:
    color var(--t-mid) var(--ease),
    opacity var(--t-mid) var(--ease);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ll.past {
  opacity: 0.6;
}
.ll.now {
  color: var(--ink);
}
.ghost {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 10px;
  border-radius: 10px;
  color: var(--ink-2);
  font: 500 13px/1 var(--f-body);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 9%, transparent);
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.ghost svg {
  width: 17px;
  height: 17px;
}
.ghost:hover {
  background: var(--chip);
  color: var(--ink);
}
.next {
  margin-top: 20px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--ink) 7%, transparent);
}
.next-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
}
.more {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  margin-right: -8px;
  border-radius: 9px;
  color: var(--ink-2);
  font: 500 12.5px/1 var(--f-body);
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.more svg {
  width: 15px;
  height: 15px;
}
.more:hover {
  background: var(--chip);
  color: var(--ink);
}
.nrow {
  width: calc(100% + 16px);
  margin: 0 -8px;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 6px 8px;
  border-radius: 12px;
  text-align: left;
  transition: background var(--t-fast) var(--ease);
}
.nrow:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.nrow:active {
  background: color-mix(in srgb, var(--ink) 9%, transparent);
}
.ncv {
  width: 40px;
}
.ntext {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.nt {
  font: 500 13.5px/1.25 var(--f-body);
}
.na {
  font-size: 12px;
  color: var(--ink-2);
}
.nd {
  font-size: 12px;
  color: var(--ink-3);
}
.empty-next {
  padding: 8px 0 2px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--ink-3);
}
</style>
