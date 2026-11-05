import type { Component } from 'vue'
import IconTune from '~icons/solar/tuning-2-linear'
import IconText from '~icons/solar/document-text-linear'
import IconSleep from '~icons/solar/moon-sleep-linear'
import IconQueue from '~icons/solar/playlist-linear'
import IconMarks from '~icons/solar/bookmark-linear'
import IconAdd from '~icons/solar/add-square-linear'
import IconTags from '~icons/solar/pen-new-square-linear'
import IconCard from '~icons/solar/music-note-linear'
import IconRadio from '~icons/solar/radio-linear'
import IconStage from '~icons/solar/full-screen-linear'
import type { PlayerToolId } from '@/domain/player-tools'

/** Иконки быстрых кнопок плеера — общие для плеера и для их настройки */
export const PLAYER_TOOL_ICONS: Record<PlayerToolId, Component> = {
  sound: IconTune,
  lyrics: IconText,
  sleep: IconSleep,
  queue: IconQueue,
  marks: IconMarks,
  playlist: IconAdd,
  tags: IconTags,
  card: IconCard,
  radio: IconRadio,
  stage: IconStage,
}
