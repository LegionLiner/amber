<script setup lang="ts">
import IconPin from '~icons/solar/pin-bold'
import CoverArt from '@/components/CoverArt.vue'
import type { PlaylistRow } from '@/data/repos/playlists'
import { $t } from '@/i18n'

/** Содержимое строки плейлиста в боковом меню: обложка, название, вид и число треков */
defineProps<{ p: PlaylistRow; pinned?: boolean }>()
</script>

<template>
  <CoverArt :art="p.cover" :seed="p.name" :label="p.name" size="s" radius="6px" class="cv" />
  <span class="text">
    <span class="ellipsis">{{ p.name }}</span>
    <small
      ><IconPin v-if="pinned" class="pin" />{{ p.kind === 'mix' ? $t('микс · ') : p.kind === 'smart' ? $t('умный · ') : ''
      }}{{ p.count }}</small
    >
  </span>
</template>

<style scoped>
.cv {
  width: 34px;
  height: 34px;
}
.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}
.text small {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-3);
  font-size: 11.5px;
}
.pin {
  width: 11px;
  height: 11px;
  color: var(--amber-ink);
}
</style>
