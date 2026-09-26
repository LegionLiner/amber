<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import IconEdit from '~icons/solar/pen-linear'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { MusicCore } from '@/native/music-core'
import { lineAt, parseLrc, plainText, type LyricLine } from '@/domain/lyrics'
import { saveLyrics, savedLyrics } from '@/data/repos/tags'

/**
 * Текст песни. Берётся из самого файла (USLT/SYLT) или из вставленного тобой.
 * Синхронный текст подсвечивает текущую строку и сам прокручивается; тап по строке — перемотка туда.
 */
const player = usePlayer()
const ui = useUi()

const loading = ref(true)
const synced = ref<LyricLine[] | null>(null)
const plain = ref('')
const source = ref<'file' | 'mine' | null>(null)
const editing = ref(false)
const draft = ref('')
const listEl = ref<HTMLElement | null>(null)
const taEl = ref<HTMLTextAreaElement | null>(null)

const item = computed(() => player.current)

async function load() {
  const it = item.value
  synced.value = null
  plain.value = ''
  source.value = null
  editing.value = false
  if (!it) return
  loading.value = true
  try {
    const mine = await savedLyrics(it.key)
    if (mine) {
      synced.value = parseLrc(mine)
      plain.value = synced.value ? '' : plainText(mine)
      source.value = 'mine'
      return
    }
    const track = player.currentTrack
    const r = await MusicCore.lyrics({ uri: it.uri, path: track?.path })
    if (r.synced?.length) synced.value = r.synced
    else if (r.text) {
      synced.value = parseLrc(r.text)
      if (!synced.value) plain.value = plainText(r.text)
    }
    if (synced.value || plain.value) source.value = 'file'
  } catch {
    /* текста нет — покажем пустое состояние */
  } finally {
    loading.value = false
  }
}
watch(() => item.value?.key, load, { immediate: true })

const current = computed(() => (synced.value ? lineAt(synced.value, player.position + 250) : -1))
watch(current, async (i) => {
  if (i < 0 || editing.value) return
  await nextTick()
  const el = listEl.value?.querySelector<HTMLElement>(`[data-i="${i}"]`)
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})

function seekTo(l: LyricLine) {
  void player.seek(l.t)
}

function startEdit() {
  draft.value =
    source.value === 'mine' || source.value === 'file'
      ? synced.value
        ? synced.value.map((l) => `[${fmt(l.t)}]${l.line}`).join('\n')
        : plain.value
      : ''
  editing.value = true
}
function fmt(ms: number) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const c = Math.floor((ms % 1000) / 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}
async function save() {
  const it = item.value
  if (!it) return
  await saveLyrics(it.key, draft.value)
  ui.toast(draft.value.trim() ? 'Текст сохранён' : 'Свой текст удалён')
  await load()
}
/** Поставить метку времени текущей позиции в начало строки под курсором — так текст синхронизируется вручную */
function stamp() {
  const ta = taEl.value
  if (!ta) return
  const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1
  const line = ta.value.slice(start).split('\n')[0] ?? ''
  const clean = line.replace(/^\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/, '')
  const tagged = `[${fmt(player.position)}]${clean}`
  draft.value = ta.value.slice(0, start) + tagged + ta.value.slice(start + line.length)
  const next = start + tagged.length + 1
  void nextTick(() => ta.setSelectionRange(next, next))
}
</script>

<template>
  <div class="sheet-body form lyr">
    <header class="top">
      <div class="names">
        <h3 class="sheet-head ellipsis">{{ item?.title ?? 'Текст' }}</h3>
        <small class="muted ellipsis">{{ item?.artist }}<template v-if="source === 'mine'"> · твой текст</template></small>
      </div>
      <button v-if="!editing" type="button" class="icon-btn" aria-label="Изменить текст" @click="startEdit"><IconEdit /></button>
    </header>

    <template v-if="editing">
      <textarea
        id="lyrics-draft"
        ref="taEl"
        v-model="draft"
        class="field ta"
        placeholder="Вставь текст. Можно в формате LRC: [01:23.45]строка"
      />
      <p class="note">Чтобы синхронизировать вручную: слушай и нажимай «Метка» в начале каждой строки.</p>
      <div class="btns">
        <button type="button" class="btn" @mousedown.prevent @click="stamp">Метка {{ fmt(player.position).slice(0, 5) }}</button>
        <button type="button" class="btn primary" @click="save">Сохранить</button>
      </div>
      <button type="button" class="btn block" @click="editing = false">Отмена</button>
    </template>

    <div v-else-if="loading" class="muted pad">Ищу текст…</div>
    <div v-else-if="synced" ref="listEl" class="lines">
      <button
        v-for="(l, i) in synced"
        :key="i"
        type="button"
        class="line"
        :data-i="i"
        :class="{ now: i === current, past: i < current }"
        @click="seekTo(l)"
      >
        {{ l.line || '♪' }}
      </button>
    </div>
    <pre v-else-if="plain" class="plain">{{ plain }}</pre>
    <div v-else class="empty-l">
      <p>В файле нет текста.</p>
      <button type="button" class="btn" @click="startEdit">Добавить свой</button>
    </div>
  </div>
</template>

<style scoped>
.lyr {
  min-height: 50vh;
}
.top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.names {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.names small {
  font-size: 13px;
}
.lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 20vh 0;
  overflow-y: auto;
  max-height: 64vh;
  mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent);
}
.line {
  text-align: left;
  padding: 7px 4px;
  font: 600 20px/1.35 var(--f-body);
  color: var(--ink-3);
  transition:
    color var(--t-mid) var(--ease),
    transform var(--t-mid) var(--ease);
  transform-origin: left center;
}
.line.past {
  color: var(--ink-2);
}
.line.now {
  color: var(--ink);
  transform: scale(1.03);
}
.plain {
  white-space: pre-wrap;
  font: 500 16px/1.6 var(--f-body);
  max-height: 64vh;
  overflow-y: auto;
}
.ta {
  min-height: 40vh;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.empty-l {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  color: var(--ink-2);
  padding: 20px 0;
}
.pad {
  padding: 20px 0;
}
</style>
