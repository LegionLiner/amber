<script setup lang="ts">
import { computed, onMounted, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import IconSpeaker from '~icons/solar/speaker-linear'
import IconPhone from '~icons/solar/smartphone-linear'
import IconHeadphones from '~icons/solar/headphones-round-linear'
import IconBt from '~icons/solar/bluetooth-linear'
import IconUsb from '~icons/solar/usb-linear'
import IconSwitch from '~icons/solar/transfer-horizontal-linear'
import { usePlayer } from '@/stores/player'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { MusicCore } from '@/native/music-core'
import { isNative } from '@/native/paths'
import { isDesktop } from '@/native/desktop/bridge'
import { outputLabel } from '@/domain/outputs'
import type { OutputDevice } from '@/native/types'

/**
 * Куда идёт звук. Можно выбрать устройство прямо здесь или открыть системный переключатель.
 * У каждого устройства может быть свой профиль эквалайзера: AirPods и колонке нужна разная коррекция.
 */
const emit = defineEmits<{ close: [] }>()
const player = usePlayer()
const settings = useSettings()
const ui = useUi()
const router = useRouter()

onMounted(() => void player.refreshOutputs().catch(() => undefined))

const devices = computed(() => player.outputs?.devices ?? [])
const current = computed(() => player.output)
const profile = computed(() => settings.s.audio.profiles[current.value])

function icon(d: OutputDevice) {
  return d.kind === 'bluetooth'
    ? IconBt
    : d.kind === 'wired'
      ? IconHeadphones
      : d.kind === 'usb'
        ? IconUsb
        : d.kind === 'speaker' && isNative
          ? IconPhone
          : IconSpeaker
}

/** Ключ устройства для профилей эквалайзера: как его называет движок */
function keyOf(d: OutputDevice): string {
  if (isDesktop) return `pc:${d.name}`
  return d.kind === 'bluetooth' ? `bt:${d.name}` : d.kind
}

function isCurrent(d: OutputDevice): boolean {
  if (player.outputs?.preferred != null) return player.outputs.preferred === d.id
  const c = current.value
  if (isDesktop) return false
  if (d.kind === 'bluetooth') return c === `bt:${d.name}`
  return c === d.kind
}

async function choose(d: OutputDevice | null) {
  await player.setOutput(d?.id ?? null)
  ui.toast(d ? `Звук: ${d.name}` : isDesktop ? 'Звук: как в настройках Windows' : 'Звук: как решит система')
}

function saveProfile() {
  settings.s.audio.profiles[current.value] = { eq: structuredClone(toRaw(settings.s.audio.eq)) }
  ui.toast(`Профиль сохранён для «${outputLabel(current.value)}»`)
}
function dropProfile() {
  delete settings.s.audio.profiles[current.value]
  ui.toast('Профиль убран: действует общий эквалайзер')
}
function openEq() {
  emit('close')
  void router.push('/settings/audio')
}
</script>

<template>
  <div class="sheet-body form">
    <h3 class="sheet-head">Вывод звука</h3>
    <div class="sheet-list">
      <button v-for="d in devices" :key="d.id" type="button" class="sheet-item" :class="{ on: isCurrent(d) }" @click="choose(d)">
        <component :is="icon(d)" />
        <span class="ellipsis">{{ d.name }}</span>
        <span v-if="settings.s.audio.profiles[keyOf(d)]" class="hint">свой звук</span>
      </button>
      <button
        v-if="isNative || isDesktop"
        type="button"
        class="sheet-item"
        :class="{ on: isDesktop && player.outputs?.preferred == null }"
        @click="choose(null)"
      >
        <IconSpeaker /><span>Автоматически</span><span class="hint">{{ isDesktop ? 'как в Windows' : 'как решит система' }}</span>
      </button>
      <button v-if="isNative" type="button" class="sheet-item" @click="MusicCore.openSystemOutputSwitcher()">
        <IconSwitch /><span>Системный переключатель</span>
      </button>
    </div>
    <div class="group-lite">
      <p class="note">
        Сейчас: <b>{{ outputLabel(current) }}</b
        >.
        <template v-if="profile">У этого устройства свой эквалайзер: он включается сам при подключении.</template>
        <template v-else>Эквалайзер общий. Можно сохранить текущие настройки как профиль этого устройства.</template>
      </p>
      <div class="btns">
        <button v-if="!profile" type="button" class="btn" @click="saveProfile">Сохранить профиль</button>
        <button v-else type="button" class="btn" @click="dropProfile">Убрать профиль</button>
        <button type="button" class="btn" @click="openEq">Эквалайзер</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.group-lite {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}
.group-lite b {
  color: var(--ink);
  font-weight: 600;
}
</style>
