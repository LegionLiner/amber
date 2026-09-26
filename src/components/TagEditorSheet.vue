<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { clearOverrides, restoreTagFiles, saveTags, tagBackupKeys, type TagEdit } from '@/data/repos/tags'
import type { Track } from '@/domain/track'

/**
 * Правка тегов одного трека или сразу нескольких (альбом целиком).
 * Если включено «Записывать в файлы», теги попадут в сам mp3 — Android один раз спросит разрешение.
 * Иначе (или если файл не mp3) правка хранится в приложении поверх файла.
 */
const props = defineProps<{ keys: string[] }>()
const emit = defineEmits<{ close: [] }>()
const library = useLibrary()
const settings = useSettings()
const ui = useUi()

const tracks = computed(() => props.keys.map((k) => library.byKey.get(k)).filter((t): t is Track => !!t))
const single = computed(() => tracks.value.length === 1)
const first = computed(() => tracks.value[0])

/** Общее значение поля у всех треков или пусто, если разное */
function common<K extends 'title' | 'artist' | 'album' | 'genre'>(k: K): string {
  const vals = new Set(tracks.value.map((t) => t[k] ?? ''))
  return vals.size === 1 ? [...vals][0]! : ''
}

const form = reactive({
  title: single.value ? (first.value?.title ?? '') : '',
  artist: common('artist'),
  album: common('album'),
  genre: common('genre'),
  year: (() => {
    const ys = new Set(tracks.value.map((t) => t.year))
    return ys.size === 1 ? ([...ys][0] ?? null) : null
  })(),
  trackNo: single.value ? (first.value?.trackNo ?? null) : null,
})
const initial = JSON.stringify(form)
const toFiles = ref(settings.s.writeTagsToFiles)
const busy = ref(false)
const hasOverrides = computed(() => tracks.value.some((t) => Object.keys(t.overrides).length))
/** Файлы, которые можно вернуть к состоянию до последней записи тегов */
const backups = ref(new Set<string>())
onMounted(async () => (backups.value = await tagBackupKeys()))
const restorable = computed(() => tracks.value.filter((t) => backups.value.has(t.key)))

async function restoreFiles() {
  busy.value = true
  try {
    const n = await restoreTagFiles(restorable.value)
    await library.scan(false)
    ui.toast(n ? 'Файл возвращён как был до правки' : 'Не получилось вернуть файл')
    emit('close')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/cancel|отмен|разреш/i.test(msg)) ui.toast(`Не получилось: ${msg}`)
  } finally {
    busy.value = false
  }
}

async function save() {
  if (JSON.stringify(form) === initial) return emit('close')
  busy.value = true
  try {
    const edits = new Map<string, TagEdit>()
    const init = JSON.parse(initial) as typeof form
    for (const t of tracks.value) {
      const e: TagEdit = {}
      if (single.value && form.title !== init.title) e.title = form.title.trim()
      if (form.artist !== init.artist) e.artist = form.artist.trim()
      if (form.album !== init.album) e.album = form.album.trim()
      if (form.genre !== init.genre) e.genre = form.genre.trim()
      if (form.year !== init.year) e.year = form.year ? Number(form.year) : null
      if (single.value && form.trackNo !== init.trackNo) e.trackNo = form.trackNo ? Number(form.trackNo) : null
      edits.set(t.key, e)
    }
    settings.s.writeTagsToFiles = toFiles.value
    const r = await saveTags(tracks.value, edits, toFiles.value)
    await library.load()
    if (r.written && !r.failed.length) ui.toast(r.written === 1 ? 'Теги записаны в файл' : `Теги записаны в ${r.written} файлов`)
    else if (r.written) ui.toast(`Записано в файлы: ${r.written}, остальное сохранено в приложении`, undefined, 5000)
    else if (toFiles.value && r.failed.length)
      ui.toast(`В файл не записалось: ${r.failed[0]!.reason}. Правка сохранена в приложении`, undefined, 6000)
    else ui.toast('Сохранено в приложении')
    emit('close')
  } finally {
    busy.value = false
  }
}

async function reset() {
  await clearOverrides(tracks.value.map((t) => t.key))
  await library.load()
  ui.toast('Показываются теги из файлов')
  emit('close')
}
</script>

<template>
  <div class="sheet-body form">
    <h3 class="sheet-head">{{ single ? 'Теги трека' : `Теги: ${tracks.length} треков` }}</h3>
    <p v-if="single && first" class="note ellipsis">{{ first.fileName }}</p>
    <label v-if="single" class="fl"><span>Название</span><input id="tag-title" v-model="form.title" class="field" /></label>
    <label class="fl"
      ><span>Исполнитель</span
      ><input
        id="tag-artist"
        v-model="form.artist"
        class="field"
        :placeholder="single ? '' : 'разные — оставь пустым, чтобы не менять'"
    /></label>
    <label class="fl"><span>Альбом</span><input id="tag-album" v-model="form.album" class="field" /></label>
    <div class="two">
      <label class="fl"><span>Жанр</span><input id="tag-genre" v-model="form.genre" class="field" /></label>
      <label class="fl"
        ><span>Год</span><input id="tag-year" v-model.number="form.year" class="field" inputmode="numeric"
      /></label>
      <label v-if="single" class="fl"
        ><span>№</span><input id="tag-no" v-model.number="form.trackNo" class="field" inputmode="numeric"
      /></label>
    </div>
    <label class="row">
      <span
        ><b>Записать в файлы</b
        ><small>mp3 и m4a (AAC), формат определяется по содержимому. Android спросит разрешение</small></span
      >
      <input id="tag-to-files" v-model="toFiles" type="checkbox" class="switch" />
    </label>
    <div class="btns">
      <button v-if="hasOverrides" type="button" class="btn" :disabled="busy" @click="reset">Как в файле</button>
      <button v-if="restorable.length" type="button" class="btn" :disabled="busy" @click="restoreFiles">Вернуть файл</button>
      <button type="button" class="btn primary" :disabled="busy" @click="save">{{ busy ? 'Сохраняю…' : 'Сохранить' }}</button>
    </div>
  </div>
</template>

<style scoped>
.fl {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
}
.two {
  display: grid;
  grid-template-columns: 1fr 88px 64px;
  gap: 8px;
}
</style>
