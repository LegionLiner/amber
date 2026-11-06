<script lang="ts">
/** Треки, для которых в LRCLIB ничего не нашлось: до перезапуска не спрашиваем снова */
const lrclibMissing = new Set<string>()
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import IconEdit from '~icons/solar/pen-linear'
import IconFind from '~icons/solar/magnifer-linear'
import IconClose from '~icons/solar/close-circle-linear'
import { usePlayer } from '@/stores/player'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { MusicCore } from '@/native/music-core'
import { lineAt, parseLrc, plainText, type LyricLine } from '@/domain/lyrics'
import { AUTO_MAX, lrclibId, score, toSaved, type LrclibRecord } from '@/domain/lrclib'
import { lrclibFind } from '@/data/lrclib'
import { formatDuration } from '@/domain/format'
import { saveLyrics, savedLyrics } from '@/data/repos/tags'
import { $t } from '@/i18n'

/**
 * Текст песни. Берётся из самого файла (USLT/SYLT), из вставленного тобой или из открытой базы LRCLIB:
 * если в файле текста нет, лучший вариант оттуда подставляется сам и сохраняется (и синхронизируется),
 * не подошёл — другой вариант из списка или свой текст.
 * Синхронный текст подсвечивает текущую строку и сам прокручивается; тап по строке — перемотка туда.
 *
 * inline — не шторка, а панель в большом плеере на компьютере: на месте названия и кнопок, ростом с обложку,
 * строки крупнее; крестик возвращает кнопки.
 */
const props = defineProps<{ inline?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const player = usePlayer()
const settings = useSettings()
const ui = useUi()

const loading = ref(true)
const loadingText = ref($t('Ищу текст…'))
const synced = ref<LyricLine[] | null>(null)
const plain = ref('')
const source = ref<'file' | 'mine' | 'lrclib' | null>(null)
const currentId = ref<number | null>(null)
const variants = ref<LrclibRecord[] | null>(null)
const picking = ref(false)
const searching = ref(false)
const searchError = ref('')
const editing = ref(false)
const draft = ref('')
const listEl = ref<HTMLElement | null>(null)
const taEl = ref<HTMLTextAreaElement | null>(null)

const item = computed(() => player.current)
const emptyText = computed(() =>
  source.value === 'lrclib'
    ? $t('Текст убран.')
    : settings.s.lrclib && item.value && lrclibMissing.has(item.value.key)
      ? $t('Текста нет ни в файле, ни в LRCLIB.')
      : $t('В файле нет текста.'),
)

function show(text: string) {
  synced.value = parseLrc(text)
  plain.value = synced.value ? '' : plainText(text)
}

async function load() {
  const it = item.value
  synced.value = null
  plain.value = ''
  source.value = null
  currentId.value = null
  variants.value = null
  picking.value = false
  searchError.value = ''
  editing.value = false
  if (!it) return
  loading.value = true
  loadingText.value = $t('Ищу текст…')
  try {
    const mine = await savedLyrics(it.key)
    if (mine) {
      show(mine)
      currentId.value = lrclibId(mine)
      source.value = currentId.value != null ? 'lrclib' : 'mine'
      return
    }
    const track = player.currentTrack
    const r = await MusicCore.lyrics({ uri: it.uri, path: track?.path }).catch(() => null)
    if (r?.synced?.length) synced.value = r.synced
    else if (r?.text) show(r.text)
    if (synced.value || plain.value) {
      source.value = 'file'
      return
    }
    if (settings.s.lrclib && !lrclibMissing.has(it.key)) {
      loadingText.value = $t('Ищу текст в LRCLIB…')
      await findOnline(true)
    }
  } finally {
    if (item.value?.key === it.key) loading.value = false
  }
}
watch(() => item.value?.key, load, { immediate: true })

/** Варианты из LRCLIB; auto — подставить лучший сразу (когда текста нет ни своего, ни в файле) */
async function findOnline(auto = false) {
  const it = item.value
  const t = player.currentTrack
  if (!it) return
  searching.value = true
  searchError.value = ''
  try {
    const q = {
      title: t?.title ?? it.title,
      artist: t?.artist ?? it.artist ?? '',
      album: t?.album,
      durationMs: t?.durationMs ?? 0,
    }
    const list = await lrclibFind(q)
    if (item.value?.key !== it.key) return
    variants.value = list
    if (!list.length) {
      lrclibMissing.add(it.key)
      if (!auto) searchError.value = $t('В LRCLIB этого трека нет')
      return
    }
    // Сам подставляем только явно тот же трек; сомнительные варианты — в список по кнопке поиска
    if (auto) {
      if (score(list[0]!, q) <= AUTO_MAX) await choose(list[0]!, true)
    } else picking.value = true
  } catch {
    if (!auto) searchError.value = $t('Не получилось связаться с LRCLIB — нет сети?')
  } finally {
    searching.value = false
  }
}

async function choose(r: LrclibRecord, silent = false) {
  const it = item.value
  const text = toSaved(r)
  if (!it || !text) return
  await saveLyrics(it.key, text)
  show(text)
  source.value = 'lrclib'
  currentId.value = r.id
  picking.value = false
  if (!silent) ui.toast($t('Текст заменён'))
}

function variantLine(r: LrclibRecord) {
  const kind = r.syncedLyrics ? $t('синхронный') : r.instrumental ? $t('без слов') : $t('текст')
  return [r.albumName, formatDuration(r.duration * 1000), kind].filter(Boolean).join(' · ')
}
const peek = (r: LrclibRecord) =>
  (r.plainLyrics ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 2)
    .join(' / ')

const current = computed(() => (synced.value ? lineAt(synced.value, player.position + 250) : -1))
watch(current, async (i) => {
  if (i < 0 || editing.value) return
  await nextTick()
  const list = listEl.value
  const el = list?.querySelector<HTMLElement>(`[data-i="${i}"]`)
  // Прокручиваем только сам список (scrollIntoView двигал бы и плеер вокруг него). Текущая строка — на трети
  // высоты, а не посередине: в начале песни текст стоит у верха, без пустоты над ним
  if (list && el) list.scrollTo({ top: el.offsetTop - list.clientHeight * 0.34 + el.clientHeight / 2, behavior: 'smooth' })
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
  // Стёр текст целиком — значит, он не нужен: метка «#0» не даёт LRCLIB подставить его снова
  const empty = !draft.value.trim()
  await saveLyrics(it.key, empty && settings.s.lrclib ? '[re:LRCLIB #0]' : draft.value)
  ui.toast(empty ? $t('Текст убран') : $t('Текст сохранён'))
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
  <div class="form lyr" :class="props.inline ? 'inline' : 'sheet-body'">
    <header class="top">
      <div class="names">
        <h3 class="sheet-head ellipsis">{{ item?.title ?? $t('Текст') }}</h3>
        <small class="muted ellipsis"
          >{{ item?.artist }}<template v-if="source === 'mine'"> {{ $t(' · твой текст') }}</template
          ><template v-else-if="source === 'lrclib' && currentId"> {{ $t(' · из LRCLIB') }}</template></small
        >
      </div>
      <button
        v-if="!editing"
        type="button"
        class="icon-btn"
        :aria-label="$t('Варианты из LRCLIB')"
        :title="$t('Варианты из LRCLIB')"
        :disabled="searching"
        @click="variants && variants.length ? (picking = !picking) : findOnline()"
      >
        <IconFind />
      </button>
      <button v-if="!editing" type="button" class="icon-btn" :aria-label="$t('Изменить текст')" @click="startEdit">
        <IconEdit />
      </button>
      <button
        v-if="props.inline"
        type="button"
        class="icon-btn"
        :aria-label="$t('Скрыть текст')"
        :title="$t('Скрыть текст')"
        @click="emit('close')"
      >
        <IconClose />
      </button>
    </header>
    <p v-if="searching && !loading" class="muted note">{{ $t('Ищу в LRCLIB…') }}</p>
    <p v-else-if="searchError" class="muted note">{{ searchError }}</p>

    <template v-if="editing">
      <textarea
        id="lyrics-draft"
        ref="taEl"
        v-model="draft"
        class="field ta"
        :placeholder="$t('Вставь текст. Можно в формате LRC: [01:23.45]строка')"
      />
      <p class="note">{{ $t('Чтобы синхронизировать вручную: слушай и нажимай «Метка» в начале каждой строки.') }}</p>
      <div class="btns">
        <button type="button" class="btn" @mousedown.prevent @click="stamp">
          {{ $t('Метка {0}', fmt(player.position).slice(0, 5)) }}
        </button>
        <button type="button" class="btn primary" @click="save">{{ $t('Сохранить') }}</button>
      </div>
      <button type="button" class="btn block" @click="editing = false">{{ $t('Отмена') }}</button>
    </template>

    <div v-else-if="picking && variants" class="variants">
      <p class="muted note">{{ $t('Варианты из LRCLIB, лучший сверху. Не подошёл ни один — карандаш и свой текст.') }}</p>
      <button
        v-for="v in variants"
        :key="v.id"
        type="button"
        class="variant"
        :class="{ on: v.id === currentId }"
        @click="choose(v)"
      >
        <b class="ellipsis">{{ v.artistName }} — {{ v.trackName }}</b>
        <small class="ellipsis">{{ variantLine(v) }}</small>
        <span class="peek">{{ peek(v) }}</span>
      </button>
      <button type="button" class="btn block" @click="picking = false">{{ $t('Назад к тексту') }}</button>
    </div>
    <div v-else-if="loading" class="muted pad">{{ loadingText }}</div>
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
      <p>{{ emptyText }}</p>
      <div class="btns">
        <button type="button" class="btn" :disabled="searching" @click="findOnline()">{{ $t('Найти в LRCLIB') }}</button>
        <button type="button" class="btn" @click="startEdit">{{ $t('Добавить свой') }}</button>
      </div>
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
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* Сверху — чуть больше затухания, снизу — запас, чтобы последние строки тоже поднимались к трети высоты */
  padding: 7vh 0 40vh;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  max-height: 64vh;
  mask-image: linear-gradient(transparent, #000 9%, #000 82%, transparent);
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
  /* Длинное слово переносится, а не уезжает вбок (и вбок текст не прокручивается) */
  overflow-wrap: anywhere;
}
.line.past {
  color: var(--ink-2);
}
.line.now {
  color: var(--ink);
  transform: scale(1.03);
}
/* Увеличенная текущая строка не шире списка: запас справа под её 3% */
.lines .line {
  margin-right: 3%;
}
.plain {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 500 16px/1.6 var(--f-body);
  max-height: 64vh;
  overflow-x: hidden;
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
.variants {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 64vh;
  overflow-y: auto;
}
.variant {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--surface-2);
  text-align: left;
  min-width: 0;
}
/* ---- внутри большого плеера: на всю высоту панели, строки крупно ---- */
.lyr.inline {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.inline .sheet-head {
  font-size: 17px;
}
.inline .lines {
  flex: 1;
  min-height: 0;
  max-height: none;
  padding: 0;
  gap: 4px;
  scrollbar-width: none;
  mask-image: linear-gradient(transparent, #000 7%, #000 86%, transparent);
}
.inline .lines::-webkit-scrollbar {
  display: none;
}
/* Сверху — немного места под затухание, снизу — запас, чтобы и последние строки вставали на треть высоты */
.inline .lines::before {
  content: '';
  flex: 0 0 8%;
}
.inline .lines::after {
  content: '';
  flex: 0 0 62%;
}
.inline .line {
  padding: 8px 4px;
  font: 700 clamp(22px, 1.9vw, 30px) / 1.28 var(--f-body);
  letter-spacing: -0.01em;
  border-radius: 12px;
}
.inline .line:hover {
  color: var(--ink-2);
}
.inline .line.now,
.inline .line.now:hover {
  color: var(--ink);
}
.inline .plain {
  flex: 1;
  min-height: 0;
  max-height: none;
  font: 600 19px/1.6 var(--f-body);
}
.inline :is(.variants, .ta) {
  flex: 1;
  min-height: 0;
  max-height: none;
}
.variant.on {
  box-shadow: inset 0 0 0 1.5px var(--amber);
}
.variant b {
  font: 600 14px/1.3 var(--f-body);
}
.variant small {
  font-size: 12px;
  color: var(--ink-2);
}
.peek {
  font-size: 12.5px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
