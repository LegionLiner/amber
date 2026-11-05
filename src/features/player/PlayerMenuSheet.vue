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
import { effectsLabel } from '@/domain/effects'
import OutputSheet from './OutputSheet.vue'
import SleepSheet from './SleepSheet.vue'
import BookmarksSheet from './BookmarksSheet.vue'
import TagEditorSheet from '@/components/TagEditorSheet.vue'
import AddToPlaylistSheet from '@/components/AddToPlaylistSheet.vue'
import { $t } from '@/i18n'

/** Всё, что можно сделать с текущим треком из плеера */
const emit = defineEmits<{ close: [] }>()
const player = usePlayer()
const radio = useRadio()
const ui = useUi()
const router = useRouter()

const item = computed(() => player.current)
const abText = computed(() => {
  const ab = player.ab
  if (!ab) return $t('поставить A')
  if (ab.end == null) return $t('A {0} · поставить B', formatDuration(ab.start))
  return $t('{0}–{1} · выключить', formatDuration(ab.start), formatDuration(ab.end))
})
const speedText = computed(() => {
  const s =
    player.speed === 1 && player.pitch === 1
      ? '1×'
      : `${player.speed.toFixed(2)}×${player.pitch !== 1 && player.pitch === player.speed ? $t(' с тоном') : ''}`
  const fx = effectsLabel(player.effects)
  return fx ? `${s} · ${fx}` : s
})

function open(c: object, props?: Record<string, unknown>) {
  ui.openSheet(c as never, props)
}
async function ab() {
  if (player.ab?.end != null) {
    await player.clearAb()
    ui.toast($t('Повтор отрезка выключен'))
    return
  }
  await player.markAb()
  ui.toast(player.ab?.end != null ? $t('Отрезок повторяется') : $t('Точка A поставлена. Нажми ещё раз в конце отрезка'))
  emit('close')
}
async function startRadio() {
  const t = player.currentTrack
  if (!t) return
  emit('close')
  await radio.start([t])
  ui.toast($t('Радио по треку: дальше похожее из твоей музыки'))
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
      <button type="button" class="sheet-item" @click="open(LyricsSheet)">
        <IconText /><span>{{ $t('Текст песни') }}</span>
      </button>
      <button
        type="button"
        class="sheet-item"
        :class="{ on: player.speed !== 1 || !!effectsLabel(player.effects) }"
        @click="open(SpeedSheet)"
      >
        <IconSpeed /><span>{{ $t('Скорость, тон, эффекты') }}</span
        ><span class="hint ellipsis">{{ speedText }}</span>
      </button>
      <button type="button" class="sheet-item" :class="{ on: !!player.ab }" @click="ab">
        <IconAb /><span>{{ $t('Повтор отрезка A–B') }}</span
        ><span class="hint">{{ abText }}</span>
      </button>
      <button type="button" class="sheet-item" @click="open(OutputSheet)">
        <IconOut /><span>{{ $t('Вывод звука') }}</span
        ><span class="hint ellipsis">{{ outputLabel(player.output) }}</span>
      </button>
      <button type="button" class="sheet-item" @click="go('/settings/audio')">
        <IconEq /><span>{{ $t('Эквалайзер и переходы') }}</span>
      </button>
      <button
        type="button"
        class="sheet-item"
        :class="{ on: player.sleepAt > 0 || player.sleepEndOfTrack }"
        @click="open(SleepSheet)"
      >
        <IconSleep /><span>{{ $t('Сон-таймер') }}</span>
      </button>
      <button type="button" class="sheet-item" @click="open(BookmarksSheet, { trackKey: item.key, title: item.title })">
        <IconMarks /><span>{{ $t('Метки и лучшие моменты') }}</span>
      </button>
      <button type="button" class="sheet-item" @click="startRadio">
        <IconRadio /><span>{{ $t('Радио по этому треку') }}</span>
      </button>
      <button type="button" class="sheet-item" @click="open(AddToPlaylistSheet, { keys: [item.key] })">
        <IconAdd /><span>{{ $t('В плейлист') }}</span>
      </button>
      <button type="button" class="sheet-item" @click="open(TagEditorSheet, { keys: [item.key] })">
        <IconTags /><span>{{ $t('Изменить теги') }}</span>
      </button>
      <button type="button" class="sheet-item" @click="go(`/track/${item.key}`)">
        <IconCard /><span>{{ $t('Карточка трека') }}</span>
      </button>
    </div>
  </div>
</template>
