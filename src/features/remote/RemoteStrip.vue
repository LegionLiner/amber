<script setup lang="ts">
import { computed } from 'vue'
import IconPlay from '~icons/solar/play-bold'
import IconPause from '~icons/solar/pause-bold'
import IconNext from '~icons/solar/skip-next-bold'
import IconHere from '~icons/solar/import-linear'
import IconClose from '~icons/solar/close-circle-linear'
import CoverArt from '@/components/CoverArt.vue'
import DevicesSheet from './DevicesSheet.vue'
import { useRemote } from '@/stores/remote'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { isDesktop } from '@/native/desktop/bridge'
import { deviceIcon } from './device'
import { $t } from '@/i18n'

/**
 * Полоска «Играет на …»: что сейчас звучит на другом устройстве, с паузой, следующим треком и «Слушать здесь».
 * На компьютере висит над панелью плеера, на телефоне — над мини-плеером. Нажатие открывает «Устройства».
 */
const remote = useRemote()
const player = usePlayer()
const library = useLibrary()
const ui = useUi()

const d = computed(() => remote.strip)
const art = computed(() => (d.value?.state ? (library.byKey.get(d.value.state.key)?.art ?? null) : null))
const frac = computed(() => {
  const dev = d.value
  const dur = dev?.state?.durationMs ?? 0
  return dev && dur > 0 ? Math.min(1, remote.positionOf(dev) / dur) : 0
})
const open = () => ui.openSheet(DevicesSheet)
</script>

<template>
  <Transition name="rstrip">
    <div
      v-if="d?.state && !ui.fullPlayer"
      class="rstrip"
      :class="{ desk: isDesktop, high: !isDesktop && player.hasTrack, on: d.state.playing }"
    >
      <button type="button" class="body" :aria-label="$t('Устройства: играет на «{0}»', d.name)" @click="open">
        <CoverArt :art="art" :seed="d.state.title" :label="d.state.title" size="s" class="cv" />
        <span class="text">
          <small class="ellipsis"
            ><component :is="deviceIcon(d.platform)" class="dic" />{{ d.state.playing ? $t('Играет на') : $t('На паузе на') }} «{{
              d.name
            }}»</small
          >
          <b class="ellipsis"
            >{{ d.state.title }}<span class="by"> — {{ d.state.artist }}</span></b
          >
        </span>
      </button>
      <button
        type="button"
        class="ib"
        :aria-label="d.state.playing ? $t('Пауза там') : $t('Играть там')"
        :title="d.state.playing ? $t('Пауза там') : $t('Играть там')"
        @click="remote.control(d, 'toggle')"
      >
        <IconPause v-if="d.state.playing" /><IconPlay v-else />
      </button>
      <button
        type="button"
        class="ib"
        :aria-label="$t('Следующий там')"
        :title="$t('Следующий там')"
        @click="remote.control(d, 'next')"
      >
        <IconNext />
      </button>
      <button
        type="button"
        class="here"
        :title="$t('Продолжить на этом устройстве с того же места')"
        :aria-label="$t('Слушать здесь')"
        @click="remote.continueHere(d)"
      >
        <IconHere /><span>{{ $t('Слушать здесь') }}</span>
      </button>
      <button type="button" class="ib x" :aria-label="$t('Скрыть')" :title="$t('Скрыть')" @click="remote.dismiss(d)">
        <IconClose />
      </button>
      <i class="bar" :style="{ transform: `scaleX(${frac})` }" />
    </div>
  </Transition>
</template>

<style scoped>
.rstrip {
  position: fixed;
  left: 8px;
  right: 8px;
  /* Над навигацией; если играет и здесь — над мини-плеером */
  bottom: calc(var(--nav-h) + var(--safe-bottom) + 6px);
  z-index: 22;
  height: 52px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto auto;
  align-items: center;
  gap: 2px;
  padding: 0 4px 0 6px;
  overflow: hidden;
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-2) 88%, transparent);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--ink) 8%, transparent),
    0 10px 26px -14px rgba(0, 0, 0, 0.6);
}
.rstrip.high {
  bottom: calc(var(--nav-h) + var(--safe-bottom) + var(--mini-h) + 12px);
}
.body {
  min-width: 0;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  text-align: left;
  height: 100%;
}
.cv {
  width: 36px;
}
.text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
small {
  display: flex;
  align-items: center;
  gap: 5px;
  font: 500 11.5px/1.2 var(--f-body);
  color: var(--ink-3);
}
.on small {
  color: var(--amber-ink);
}
.dic {
  width: 13px;
  height: 13px;
  flex: none;
}
b {
  font: 600 13.5px/1.2 var(--f-body);
}
.by {
  font-weight: 400;
  color: var(--ink-2);
}
.ib {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  color: var(--ink);
  transition:
    background var(--t-fast) var(--ease),
    transform var(--t-fast) var(--ease);
}
.ib svg {
  width: 18px;
  height: 18px;
}
.ib.x {
  color: var(--ink-3);
}
.ib:active,
.here:active {
  transform: scale(0.92);
}
.here {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  margin-left: 2px;
  border-radius: 11px;
  background: rgba(var(--amber-rgb), 0.16);
  color: var(--amber-ink);
  font: 600 12.5px/1 var(--f-body);
  white-space: nowrap;
}
.here svg {
  width: 17px;
  height: 17px;
}
/* На телефоне «Слушать здесь» — одной иконкой: места мало */
.rstrip:not(.desk) .here span {
  display: none;
}
.rstrip:not(.desk) .here {
  width: 36px;
  padding: 0;
  justify-content: center;
}
.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--amber);
  transform-origin: left;
  opacity: 0.8;
  transition: transform 500ms linear;
}

/* Компьютер: над панелью плеера, в колонке сцены */
.rstrip.desk {
  position: relative;
  left: auto;
  right: auto;
  bottom: auto;
  grid-column: 2;
  grid-row: 2;
  align-self: end;
  justify-self: center;
  width: min(calc(100% - 60px), 620px);
  margin-bottom: calc(var(--dock-h) + 22px);
  z-index: 4;
  background: var(--glass-dock);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-hi), var(--shadow-float);
}
.desk .ib:hover,
.desk .body:hover b {
  color: var(--amber-ink);
}
.desk .ib:hover {
  background: var(--chip);
}
.desk .here:hover {
  background: rgba(var(--amber-rgb), 0.26);
}

.rstrip-enter-active,
.rstrip-leave-active {
  transition:
    opacity var(--t-mid) var(--ease),
    transform var(--t-mid) var(--ease-out);
}
.rstrip-enter-from,
.rstrip-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
