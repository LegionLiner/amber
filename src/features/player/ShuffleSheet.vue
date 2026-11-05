<script setup lang="ts">
import { SHUFFLE_KINDS, type ShuffleKind } from '@/domain/shuffle'
import { usePlayer } from '@/stores/player'
import { useSettings } from '@/stores/settings'
import { $t } from '@/i18n'

/** Вид перемешивания: выбор сразу перемешивает то, что после текущего трека */
const emit = defineEmits<{ close: [] }>()
const player = usePlayer()
const settings = useSettings()

async function choose(k: ShuffleKind) {
  settings.s.shuffleKind = k
  await player.toggleShuffle(k)
  emit('close')
}
async function off() {
  if (player.shuffleMode !== 'off') await player.toggleShuffle()
  emit('close')
}
</script>

<template>
  <div class="sheet-body form">
    <h3 class="sheet-head">{{ $t('Перемешать очередь') }}</h3>
    <button
      v-for="k in SHUFFLE_KINDS"
      :key="k.id"
      type="button"
      class="choice"
      :class="{ on: player.shuffleMode === k.id }"
      @click="choose(k.id)"
    >
      <span
        ><b>{{ k.label }}</b
        ><small>{{ k.hint }}</small></span
      >
      <i class="dot" />
    </button>
    <button v-if="player.shuffleMode !== 'off'" type="button" class="btn block" @click="off">
      {{ $t('Вернуть исходный порядок') }}
    </button>
  </div>
</template>
