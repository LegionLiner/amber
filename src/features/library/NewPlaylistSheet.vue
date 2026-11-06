<script setup lang="ts">
import { useRouter } from 'vue-router'
import IconList from '~icons/solar/playlist-linear'
import IconSmart from '~icons/solar/filter-linear'
import IconMix from '~icons/solar/transfer-horizontal-linear'
import NameSheet from '@/components/NameSheet.vue'
import { usePlaylists } from '@/stores/playlists'
import { useUi } from '@/stores/ui'
import { DEFAULT_RULES } from '@/domain/smart'
import { $t } from '@/i18n'

/** Что создать: обычный плейлист, умный (собирается по правилам) или микс (переходы на каждом стыке) */
const emit = defineEmits<{ close: [] }>()
const playlists = usePlaylists()
const ui = useUi()
const router = useRouter()

function manual() {
  ui.openSheet(NameSheet, {
    title: $t('Новый плейлист'),
    confirm: $t('Создать'),
    onDone: async (name: string) => {
      const id = await playlists.create(name)
      void router.push(`/playlist/${id}`)
    },
  })
}
async function smart() {
  const id = await playlists.create($t('Умный плейлист'), [], 'smart', JSON.stringify(DEFAULT_RULES))
  emit('close')
  void router.push(`/playlist/${id}/rules`)
}
function mix() {
  ui.openSheet(NameSheet, {
    title: $t('Новый микс'),
    confirm: $t('Создать'),
    placeholder: $t('Например, «Ночная трасса»'),
    onDone: async (name: string) => {
      const id = await playlists.create(name, [], 'mix')
      void router.push(`/playlist/${id}`)
      ui.toast($t('Добавляй треки через «Добавить в плейлист», потом настрой стыки в редакторе'))
    },
  })
}
</script>

<template>
  <div class="sheet-body">
    <h3 class="sheet-head">{{ $t('Создать') }}</h3>
    <div class="sheet-list">
      <button type="button" class="sheet-item" @click="manual">
        <IconList /><span
          >{{ $t('Плейлист') }}<small>{{ $t('Сам выбираешь треки и порядок') }}</small></span
        >
      </button>
      <button type="button" class="sheet-item" @click="smart">
        <IconSmart /><span
          >{{ $t('Умный плейлист') }}<small>{{ $t('Собирается сам по условиям и обновляется') }}</small></span
        >
      </button>
      <button type="button" class="sheet-item" @click="mix">
        <IconMix /><span
          >{{ $t('Микс') }}<small>{{ $t('Свой переход на каждом стыке') }}</small></span
        >
      </button>
    </div>
  </div>
</template>

<style scoped>
.sheet-item span {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sheet-item small {
  font-size: 12.5px;
  color: var(--ink-2);
}
</style>
