<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import IconPlay from '~icons/solar/play-bold'
import IconPause from '~icons/solar/pause-bold'
import IconPrev from '~icons/solar/skip-previous-bold'
import IconNext from '~icons/solar/skip-next-bold'
import IconHere from '~icons/solar/import-linear'
import IconThere from '~icons/solar/export-linear'
import CoverArt from '@/components/CoverArt.vue'
import { useRemote, type RemoteDevice } from '@/stores/remote'
import { useSync } from '@/stores/sync'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { formatDuration } from '@/domain/format'
import { isDesktop } from '@/native/desktop/bridge'
import { isNative } from '@/native/paths'
import { deviceIcon } from './device'
import { $t } from '@/i18n'

/**
 * Устройства аккаунта на связи: что на каждом играет, управление им, «Слушать здесь» и «Перенести туда».
 * Открывается из строки заголовка (компьютер), из большого плеера и с полоски «играет на …».
 */
const emit = defineEmits<{ close: [] }>()
const remote = useRemote()
const sync = useSync()
const player = usePlayer()
const library = useLibrary()
const router = useRouter()

const selfIcon = deviceIcon(isDesktop ? 'desktop' : isNative ? 'android' : 'web')
const selfName = isDesktop ? $t('Этот компьютер') : isNative ? $t('Этот телефон') : $t('Этот браузер')

function artOf(d: RemoteDevice) {
  return d.state ? (library.byKey.get(d.state.key)?.art ?? null) : null
}
function frac(d: RemoteDevice) {
  const dur = d.state?.durationMs ?? 0
  return dur > 0 ? Math.min(1, remote.positionOf(d) / dur) : 0
}
function statusOf(d: RemoteDevice) {
  if (!d.state) return $t('Ничего не играет')
  return d.state.playing ? $t('Играет') : $t('На паузе')
}

/** Клик по полосе — перемотка того устройства */
function seekAt(d: RemoteDevice, e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  if (d.state?.durationMs) void remote.seek(d, x * d.state.durationMs)
}

async function here(d: RemoteDevice) {
  await remote.continueHere(d)
  emit('close')
}
async function there(d: RemoteDevice) {
  await remote.sendTo(d)
  emit('close')
}

const hint = computed(() => {
  if (!sync.signedIn) return 'signin'
  if (sync.liveUnsupported) return 'old'
  // Поток открыт, но сервер не назвал нас (0.2 и старше): про другие устройства он не знает
  if (sync.live && !remote.selfId) return 'old'
  if (!remote.online) return 'offline'
  return remote.devices.length ? null : 'alone'
})

function toSettings() {
  emit('close')
  void router.push('/settings')
}
</script>

<template>
  <div class="body">
    <h3 class="head">{{ $t('Устройства') }}</h3>

    <div class="me">
      <component :is="selfIcon" class="dic" />
      <span class="who">
        <b>{{ selfName }}</b>
        <small class="ellipsis">{{
          player.current ? `${player.playing ? $t('Играет') : $t('На паузе')}: ${player.current.title}` : $t('Ничего не играет')
        }}</small>
      </span>
    </div>

    <p v-if="hint === 'signin'" class="note">
      {{
        $t(
          'Управлять музыкой на других устройствах и переносить её между ними можно, когда телефон и компьютер связаны по Wi-Fi.',
        )
      }}
      <button type="button" class="link" @click="toSettings">
        {{ isDesktop ? $t('Настройки → Телефон по Wi-Fi') : $t('Настройки → Компьютер по Wi-Fi') }}
      </button>
    </p>
    <p v-else-if="hint === 'old'" class="note">
      {{ $t('Сервер старой версии и не знает о других устройствах. Обнови сервер.') }}
    </p>
    <p v-else-if="hint === 'offline'" class="note">{{ $t('Нет связи с сервером синхронизации.') }}</p>
    <p v-else-if="hint === 'alone'" class="note">
      {{ $t('Других устройств на связи нет. Открой Amber на телефоне или компьютере с тем же аккаунтом — оно появится здесь.') }}
    </p>

    <section v-for="d in remote.devices" :key="d.id" class="dev" :class="{ on: d.state?.playing }">
      <div class="dh">
        <component :is="deviceIcon(d.platform)" class="dic" />
        <span class="who">
          <b class="ellipsis">{{ d.name }}</b>
          <small>{{ statusOf(d) }}</small>
        </span>
      </div>

      <template v-if="d.state">
        <div class="track">
          <CoverArt :art="artOf(d)" :seed="d.state.title" :label="d.state.title" size="s" />
          <span class="names">
            <b class="ellipsis">{{ d.state.title }}</b>
            <small class="ellipsis">{{ d.state.artist }}</small>
          </span>
        </div>
        <div class="seek" role="slider" :aria-label="$t('Перемотка на том устройстве')" @click="seekAt(d, $event)">
          <i :style="{ width: `${frac(d) * 100}%` }" />
        </div>
        <div class="times num">
          <span>{{ formatDuration(remote.positionOf(d)) }}</span>
          <span>{{ formatDuration(d.state.durationMs) }}</span>
        </div>
        <div class="ctl">
          <button type="button" class="icon-btn" :aria-label="$t('Предыдущий')" @click="remote.control(d, 'prev')">
            <IconPrev />
          </button>
          <button
            type="button"
            class="icon-btn play"
            :aria-label="d.state.playing ? $t('Пауза') : $t('Играть')"
            @click="remote.control(d, 'toggle')"
          >
            <IconPause v-if="d.state.playing" /><IconPlay v-else />
          </button>
          <button type="button" class="icon-btn" :aria-label="$t('Следующий')" @click="remote.control(d, 'next')">
            <IconNext />
          </button>
        </div>
      </template>

      <div class="acts">
        <button v-if="d.state" type="button" class="btn small" @click="here(d)"><IconHere />{{ $t('Слушать здесь') }}</button>
        <button v-if="player.current && d.ui" type="button" class="btn small" @click="there(d)">
          <IconThere />{{ $t('Перенести туда') }}
        </button>
      </div>
      <p v-if="player.current && !d.ui" class="tiny">{{ $t('Перенести музыку туда можно, когда на нём открыт Amber.') }}</p>
    </section>
  </div>
</template>

<style scoped>
.body {
  padding: 0 var(--gutter) 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  font: 600 17px/1.2 var(--f-body);
}
.me,
.dh {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.dic {
  width: 24px;
  height: 24px;
  flex: none;
  color: var(--ink-2);
}
.dev.on .dic {
  color: var(--amber-ink);
}
.who {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.who b {
  font: 600 14.5px/1.2 var(--f-body);
}
.who small {
  font-size: 12.5px;
  color: var(--ink-3);
}
.dev.on .who small {
  color: var(--amber-ink);
}
.note {
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--ink-2);
}
.link {
  color: var(--amber-ink);
  font-weight: 500;
}
.dev {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 18px;
  background: var(--surface-2);
}
:root.desktop .dev {
  background: var(--glass-card);
  box-shadow: var(--glass-hi);
}
.track {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}
.names {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.names b {
  font: 600 14.5px/1.2 var(--f-body);
}
.names small {
  font-size: 12.5px;
  color: var(--ink-2);
}
.seek {
  position: relative;
  height: 14px;
  cursor: pointer;
}
.seek::before,
.seek i {
  content: '';
  position: absolute;
  left: 0;
  top: 5px;
  height: 4px;
  border-radius: 2px;
}
.seek::before {
  right: 0;
  background: var(--line);
}
.seek i {
  background: var(--amber);
}
.times {
  display: flex;
  justify-content: space-between;
  margin-top: -6px;
  font-size: 11.5px;
  color: var(--ink-3);
}
.ctl {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 18px;
}
.ctl .play {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--ink);
  color: var(--bg);
}
/* «Слушать здесь» и «Перенести туда» — в один ряд, поровну; надписи компактные, чтобы влезали на любом экране */
.acts {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 8px;
}
.acts .btn {
  min-height: 38px;
  padding: 0 10px;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.acts .btn svg {
  flex: none;
  width: 16px;
  height: 16px;
}
.tiny {
  font-size: 12px;
  color: var(--ink-3);
}
</style>
