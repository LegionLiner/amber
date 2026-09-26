<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import IconText from '~icons/solar/document-text-linear'
import IconSpeed from '~icons/solar/stopwatch-linear'
import IconAb from '~icons/solar/repeat-linear'
import IconOut from '~icons/solar/headphones-round-linear'
import IconEq from '~icons/solar/tuning-2-linear'
import IconSleep from '~icons/solar/moon-sleep-linear'
import IconMarks from '~icons/solar/bookmark-linear'
import IconRadio from '~icons/solar/radio-linear'
import IconTags from '~icons/solar/pen-new-square-linear'
import IconCard from '~icons/solar/music-note-linear'
import IconAdd from '~icons/solar/add-square-linear'
import { usePlayer } from '@/stores/player'
import { useRadio } from '@/stores/radio'
import { useUi } from '@/stores/ui'
import { formatDuration } from '@/domain/format'
import { outputLabel } from '@/domain/outputs'
import LyricsSheet from './LyricsSheet.vue'
import SpeedSheet from './SpeedSheet.vue'
import OutputSheet from './OutputSheet.vue'
import SleepSheet from './SleepSheet.vue'
import BookmarksSheet from './BookmarksSheet.vue'
import TagEditorSheet from '@/components/TagEditorSheet.vue'
import AddToPlaylistSheet from '@/components/AddToPlaylistSheet.vue'

/** Всё, что можно сделать с текущим треком из плеера */
const emit = defineEmits<{ close: [] }>()
const player = usePlayer()
const radio = useRadio()
const ui = useUi()
const router = useRouter()

const item = computed(() => player.current)
const abText = computed(() => {
  const ab = player.ab
  if (!ab) return 'поставить A'
  if (ab.end == null) return `A ${formatDuration(ab.start)} · поставить B`
  return `${formatDuration(ab.start)}–${formatDuration(ab.end)} · выключить`
})
const speedText = computed(() =>
  player.speed === 1 && player.pitch === 1
    ? '1×'
    : `${player.speed.toFixed(2)}×${player.pitch !== 1 && player.pitch === player.speed ? ' с тоном' : ''}`,
)

function open(c: object, props?: Record<string, unknown>) {
  ui.openSheet(c as never, props)
}
async function ab() {
  if (player.ab?.end != null) {
    await player.clearAb()
    ui.toast('Повтор отрезка выключен')
    return
  }
  await player.markAb()
  ui.toast(player.ab?.end != null ? 'Отрезок повторяется' : 'Точка A поставлена. Нажми ещё раз в конце отрезка')
  emit('close')
}
async function startRadio() {
  const t = player.currentTrack
  if (!t) return
  emit('close')
  await radio.start([t])
  ui.toast('Радио по треку: дальше похожее из твоей музыки')
}
function go(path: string) {
  emit('close')
  ui.fullPlayer = false
  void router.push(path)
}
</script>

<template>
  <div v-if="item" class="sheet-body">
    <h3 class="sheet-head ellipsis">{{ item.title }}</h3>
    <div class="sheet-list">
      <button type="button" class="sheet-item" @click="open(LyricsSheet)"><IconText /><span>Текст песни</span></button>
      <button type="button" class="sheet-item" :class="{ on: player.speed !== 1 }" @click="open(SpeedSheet)">
        <IconSpeed /><span>Скорость и тон</span><span class="hint">{{ speedText }}</span>
      </button>
      <button type="button" class="sheet-item" :class="{ on: !!player.ab }" @click="ab">
        <IconAb /><span>Повтор отрезка A–B</span><span class="hint">{{ abText }}</span>
      </button>
      <button type="button" class="sheet-item" @click="open(OutputSheet)">
        <IconOut /><span>Вывод звука</span><span class="hint ellipsis">{{ outputLabel(player.output) }}</span>
      </button>
      <button type="button" class="sheet-item" @click="go('/settings/audio')">
        <IconEq /><span>Эквалайзер и переходы</span>
      </button>
      <button
        type="button"
        class="sheet-item"
        :class="{ on: player.sleepAt > 0 || player.sleepEndOfTrack }"
        @click="open(SleepSheet)"
      >
        <IconSleep /><span>Сон-таймер</span>
      </button>
      <button type="button" class="sheet-item" @click="open(BookmarksSheet, { trackKey: item.key, title: item.title })">
        <IconMarks /><span>Метки и лучшие моменты</span>
      </button>
      <button type="button" class="sheet-item" @click="startRadio"><IconRadio /><span>Радио по этому треку</span></button>
      <button type="button" class="sheet-item" @click="open(AddToPlaylistSheet, { keys: [item.key] })">
        <IconAdd /><span>В плейлист</span>
      </button>
      <button type="button" class="sheet-item" @click="open(TagEditorSheet, { keys: [item.key] })">
        <IconTags /><span>Изменить теги</span>
      </button>
      <button type="button" class="sheet-item" @click="go(`/track/${item.key}`)"><IconCard /><span>Карточка трека</span></button>
    </div>
  </div>
</template>
