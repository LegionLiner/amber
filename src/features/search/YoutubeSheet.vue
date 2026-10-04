<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginListenerHandle } from '@capacitor/core'
import { MusicCore } from '@/native/music-core'
import { isNative } from '@/native/paths'
import { isDesktop } from '@/native/desktop/bridge'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { formatDuration } from '@/domain/format'
import type { YoutubeInfo } from '@/native/types'

/**
 * Аудио из YouTube по ссылке — единственное, что приложению нужно от интернета.
 * Ссылка → название, автор и обложка → поправить теги → скачать. Файл ложится в «Музыка/Amber»,
 * дальше это обычный трек медиатеки и играет без сети.
 */
const props = defineProps<{ url?: string }>()
const emit = defineEmits<{ close: [] }>()
const library = useLibrary()
const player = usePlayer()
const ui = useUi()

const link = ref(props.url ?? '')
const info = ref<YoutubeInfo | null>(null)
const title = ref('')
const artist = ref('')
const stage = ref<'idle' | 'looking' | 'ready' | 'prepare' | 'download' | 'save' | 'done'>('idle')
const progress = ref(0)
const error = ref('')
const savedPath = ref('')

const looksLikeYoutube = computed(() => /(youtube\.com|youtu\.be|music\.youtube)/i.test(link.value))

let handle: PluginListenerHandle | null = null
onMounted(async () => {
  handle = await MusicCore.addListener('youtubeProgress', (e) => {
    stage.value = e.stage
    if ((e.stage === 'download' || e.stage === 'prepare') && e.total > 0) progress.value = e.done / e.total
  })
  if (link.value && looksLikeYoutube.value) void look()
})
onBeforeUnmount(() => void handle?.remove())

async function look() {
  if (!looksLikeYoutube.value) return
  error.value = ''
  stage.value = 'looking'
  try {
    const i = await MusicCore.youtubeInfo({ url: link.value.trim() })
    info.value = i
    title.value = i.title
    artist.value = i.artist
    stage.value = 'ready'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    stage.value = 'idle'
  }
}

async function download() {
  error.value = ''
  stage.value = 'download'
  progress.value = 0
  try {
    const r = await MusicCore.youtubeDownload({ url: link.value.trim(), title: title.value, artist: artist.value })
    savedPath.value = r.path || r.name
    // Новый файл сразу в медиатеку: быстрое пересканирование, без полного обхода
    await library.scan(false)
    stage.value = 'done'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    stage.value = 'ready'
  }
}

const progressText = computed(() => {
  if (stage.value === 'save') return 'Сохраняю в «Музыку»…'
  const pct = `${Math.round(progress.value * 100)}%`
  // Компьютер в первый раз скачивает загрузчик yt-dlp (около 18 МБ)
  if (stage.value === 'prepare') return `Готовлю загрузчик, это один раз… ${pct}`
  return `Скачиваю… ${pct}`
})

/** Только что скачанный трек: ищем по имени файла среди свежих */
function play() {
  const name = savedPath.value.split('/').pop()
  const t = library.tracks.find((x) => x.fileName === name) ?? library.tracks.find((x) => x.title === title.value)
  if (!t) return ui.toast('Трек появится в медиатеке через пару секунд')
  void player.playTracks([t], 0, { type: 'track', title: t.title }, { shuffle: false })
  emit('close')
  ui.fullPlayer = true
}
</script>

<template>
  <div class="sheet-body form">
    <h3 class="sheet-head">Скачать с YouTube</h3>
    <p v-if="!isNative && !isDesktop" class="note">
      Загрузка работает в приложении на телефоне и на компьютере: браузер не пускает к YouTube напрямую.
    </p>
    <template v-else>
      <label class="fl"
        ><span>Ссылка на видео</span
        ><input
          id="yt-link"
          v-model="link"
          class="field"
          type="url"
          inputmode="url"
          placeholder="https://youtu.be/…"
          autocomplete="off"
          :disabled="stage === 'prepare' || stage === 'download' || stage === 'save'"
          @keydown.enter="look"
      /></label>
      <button
        v-if="stage === 'idle' || stage === 'looking'"
        type="button"
        class="btn primary block"
        :disabled="!looksLikeYoutube || stage === 'looking'"
        @click="look"
      >
        {{ stage === 'looking' ? 'Смотрю, что там…' : 'Найти' }}
      </button>

      <template v-if="info && stage !== 'idle' && stage !== 'looking'">
        <div class="card">
          <img v-if="info.thumbnail" :src="info.thumbnail" alt="" class="thumb" referrerpolicy="no-referrer" />
          <div class="meta">
            <small
              >{{ info.uploader }}<template v-if="info.durationMs"> · {{ formatDuration(info.durationMs) }}</template></small
            >
          </div>
        </div>
        <label class="fl"><span>Исполнитель</span><input id="yt-artist" v-model="artist" class="field" /></label>
        <label class="fl"><span>Название</span><input id="yt-title" v-model="title" class="field" /></label>

        <div v-if="stage === 'prepare' || stage === 'download' || stage === 'save'" class="progress">
          <div class="bar"><i :style="{ transform: `scaleX(${stage === 'save' ? 1 : progress})` }" /></div>
          <small>{{ progressText }}</small>
        </div>
        <template v-else-if="stage === 'done'">
          <p class="done">Готово: трек в медиатеке, папка «Музыка/Amber». Играет без интернета.</p>
          <div class="btns">
            <button type="button" class="btn" @click="emit('close')">Закрыть</button>
            <button type="button" class="btn primary" @click="play">Слушать</button>
          </div>
        </template>
        <button v-else type="button" class="btn primary block" :disabled="!title.trim()" @click="download">Скачать аудио</button>
      </template>
      <p v-if="error" class="err">{{ error }}</p>
      <p class="note">Скачивай то, на что у тебя есть права: свои записи, свободные лицензии, личные копии.</p>
    </template>
  </div>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--r-m);
  background: var(--surface-2);
}
.meta small {
  color: var(--ink-2);
  font-size: 12.5px;
}
.progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--line-strong);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  transform-origin: left;
  background: linear-gradient(90deg, var(--amber), var(--ember));
  transition: transform 200ms linear;
}
.progress small {
  color: var(--ink-2);
  font-size: 12.5px;
}
.done {
  font-size: 14px;
  line-height: 1.45;
}
.btns {
  display: flex;
  gap: 10px;
}
.btns .btn {
  flex: 1;
}
.err {
  color: var(--bad);
  font-size: 13.5px;
  line-height: 1.4;
}
</style>
