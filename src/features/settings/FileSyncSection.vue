<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import IconWifi from '~icons/solar/wi-fi-router-linear'
import IconSync from '~icons/solar/refresh-linear'
import IconFolder from '~icons/solar/folder-2-linear'
import { useFileSync } from '@/stores/filesync'
import { useSync } from '@/stores/sync'
import { useUi } from '@/stores/ui'
import { desktop, isDesktop } from '@/native/desktop/bridge'
import { isNative } from '@/native/paths'
import { MusicCore } from '@/native/music-core'
import { countLabel, formatBytes } from '@/domain/format'
import { LOCALE, $t, $tp } from '@/i18n'

/**
 * Настройки → Телефон (на телефоне — Компьютер) по Wi-Fi: устройства в одной сети обмениваются напрямую,
 * без интернета и серверов. Подключение по коду одно, а дальше два независимых переключателя:
 *  - общие данные — оценки, история, плейлисты, «что играет» и перенос музыки (desktop/hub.ts, stores/sync.ts);
 *  - папка с музыкой — компьютер раздаёт её, телефон забирает новое и отдаёт своё (вместо Syncthing).
 */
const fs = useFileSync()
const sync = useSync()
/** Данные уже идут через свой сервер в интернете — по Wi-Fi их не включить, пока не выйти из него */
const viaServer = computed(() => sync.signedIn && sync.mode === 'server')
/** Как идут общие данные — одной строкой */
const dataText = computed(() => {
  if (viaServer.value) return $t('Сейчас данные идут через свой сервер: выйди из него, чтобы делиться ими по Wi-Fi')
  if (!(sync.mode === 'lan' && sync.signedIn))
    return $t(
      'Оценки, история, плейлисты, эпохи и дневник — общие. Видно, что играет на другом устройстве, и музыку можно перенести одним нажатием',
    )
  switch (sync.status) {
    case 'syncing':
      return $t('Синхронизирую…')
    case 'offline':
      return isDesktop ? $t('Связь с телефоном выключена') : $t('Компьютер не в сети — синхронизирую, когда появится')
    case 'error':
    case 'auth':
      return $t('Не получилось: {0}', sync.error)
    default:
      return sync.pending > 0
        ? $t('Ждёт отправки: {0}', countLabel(sync.pending, $tp('запись|записи|записей')))
        : $t('Всё синхронизировано · {0}', ago(sync.lastAt))
  }
})
/** Кто-то из подключённых телефонов отзывался в последние минуты (данные он сверяет раз в 3 минуты) */
const phoneOnline = computed(() => fs.pc?.devices.some((d) => d.lastSeenAt && now.value - d.lastSeenAt < 5 * 60_000) ?? false)
async function toggleFolder(on: boolean) {
  if (!on) return fs.setPc({ folder: null })
  if (folders.value[0]) return fs.setPc({ folder: folders.value[0] })
  await chooseOther()
}
/** Доступ ко всем файлам дают в настройках Android: открываем их, по возвращении проверяем снова */
const requestAccess = () => void MusicCore.fsRequestAccess()
const ui = useUi()

const now = ref(Date.now())
let tick = 0
onMounted(() => {
  tick = window.setInterval(() => (now.value = Date.now()), 1000)
  if (isDesktop) {
    void fs.loadPc()
    void desktop!.folders().then((f) => (folders.value = f))
  }
  if (isNative) void fs.load()
})
onBeforeUnmount(() => clearInterval(tick))

function ago(ts: number | null) {
  if (!ts) return $t('ещё не было')
  const m = Math.round((now.value - ts) / 60_000)
  if (m < 1) return $t('только что')
  if (m < 60) return $t('{0} мин назад', m)
  const h = Math.round(m / 60)
  if (h < 24) return $t('{0} ч назад', h)
  return new Date(ts).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' })
}

/* ---------------- компьютер ---------------- */
const folders = ref<string[]>([])
const code = ref<{ code: string; expiresAt: number } | null>(null)
const codeLeft = computed(() => {
  if (!code.value) return ''
  const s = Math.max(0, Math.round((code.value.expiresAt - now.value) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
async function showCode() {
  code.value = await desktop!.fileSyncPair()
}
async function chooseOther() {
  const p = await desktop!.chooseFolder($t('Папка для телефона'))
  if (p) await fs.setPc({ folder: p })
}
const activityText = computed(() => {
  const a = fs.activity
  if (!a) return ''
  const name = a.path?.split(/[\\/]/).pop() ?? ''
  const what =
    { pull: $t('забрал'), push: $t('прислал'), trash: $t('убрал в корзину'), pair: $t('подключился'), list: '' }[a.op] ?? ''
  return `${a.device} ${what}${name ? ` «${name}»` : ''} · ${ago(a.at)}`
})

/* ---------------- телефон ---------------- */
const found = ref<{ host: string; port: number; id: string; name: string }[]>([])
const searching = ref(false)
const address = ref('')
const pairCode = ref('')
const busy = ref(false)
const formError = ref('')

async function search() {
  searching.value = true
  formError.value = ''
  try {
    found.value = await fs.discover()
    if (found.value.length === 1) address.value = `${found.value[0]!.host}:${found.value[0]!.port}`
    if (!found.value.length) formError.value = $t('Компьютер не найден. Он включён и в той же сети? Можно ввести адрес вручную.')
  } finally {
    searching.value = false
  }
}
async function connect() {
  busy.value = true
  formError.value = ''
  try {
    await fs.pair(address.value, pairCode.value)
    pairCode.value = ''
    ui.toast($t('Подключено к «{0}»', fs.link?.pcName))
    if (fs.files) void fs.syncNow()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function syncAll() {
  if (sync.mode === 'lan' && sync.signedIn) void sync.syncNow()
  if (fs.files) void fs.syncNow()
}

const progressText = computed(() => {
  const p = fs.progress
  if (!p) return $t('Сверяю папки…')
  const bytes = p.bytesTotal ? $t(' · {0} из {1}', formatBytes(p.bytesDone), formatBytes(p.bytesTotal)) : ''
  return $t('{0} из {1}{2}{3}', p.done, p.total, bytes, p.current ? ` · ${p.current.split('/').pop()}` : '')
})
const reportText = computed(() => {
  const r = fs.report
  if (!r) return ''
  const parts: string[] = []
  if (r.pulled) parts.push($t('получено {0}', r.pulled))
  if (r.pushed) parts.push($t('отправлено {0}', r.pushed))
  if (r.trashedLocal || r.trashedRemote) parts.push($t('в корзину {0}', r.trashedLocal + r.trashedRemote))
  if (!parts.length) parts.push($t('всё совпадает'))
  return parts.join(', ')
})
</script>

<template>
  <section class="group fsync">
    <!-- Компьютер: связь с телефоном -->
    <template v-if="isDesktop && fs.pc">
      <h2 class="gtitle">{{ $t('Телефон по Wi-Fi') }}</h2>
      <p class="note">
        {{ $t('Телефон и компьютер в одной сети обмениваются напрямую — без интернета, аккаунтов и серверов.') }}
      </p>
      <label class="row">
        <span
          ><b>{{ $t('Связь с телефоном') }}</b
          ><small>{{ $t('Windows может спросить разрешение для частной сети — разреши') }}</small></span
        >
        <input
          id="opt-fsync"
          type="checkbox"
          class="switch"
          :checked="fs.pc.enabled"
          @change="fs.setPc({ enabled: !fs.pc.enabled })"
        />
      </label>
      <template v-if="fs.pc.enabled">
        <label class="row" :class="{ off: viaServer }">
          <span
            ><b>{{ $t('Общие данные') }}</b
            ><small>{{ dataText }}</small></span
          >
          <input
            id="opt-fsync-data"
            type="checkbox"
            class="switch"
            :checked="fs.pc.data && !viaServer"
            :disabled="viaServer"
            @change="fs.setPc({ data: !fs.pc.data })"
          />
        </label>
        <label class="row">
          <span
            ><b>{{ $t('Раздавать папку с музыкой') }}</b
            ><small>{{ $t('Новая музыка с компьютера приходит на телефон, а с телефона — сюда') }}</small></span
          >
          <input
            id="opt-fsync-folder"
            type="checkbox"
            class="switch"
            :checked="!!fs.pc.folder"
            @change="toggleFolder(!fs.pc.folder)"
          />
        </label>
        <div v-if="fs.pc.folder" class="pick">
          <span class="lbl">{{ $t('Папка') }}</span>
          <button
            v-for="f in folders"
            :key="f"
            type="button"
            class="opt ellipsis"
            :class="{ on: fs.pc.folder === f }"
            @click="fs.setPc({ folder: f })"
          >
            <IconFolder />{{ f }}
          </button>
          <button v-if="!folders.includes(fs.pc.folder)" type="button" class="opt ellipsis on" @click="chooseOther">
            <IconFolder />{{ fs.pc.folder }}
          </button>
          <button type="button" class="link" @click="chooseOther">{{ $t('Другая папка…') }}</button>
        </div>
        <p v-if="fs.pc.error" class="err">{{ fs.pc.error }}</p>
        <div v-else-if="fs.pc.running" class="state">
          <IconWifi />
          <span>
            <b>{{
              fs.pc.folder
                ? $t('Раздаю «{0}»', fs.pc.folder.split(/[\\/]/).pop())
                : phoneOnline
                  ? $t('Телефон на связи')
                  : $t('Ждёт телефон')
            }}</b>
            <small>{{ fs.pc.addresses.map((a) => `${a}:${fs.pc!.port}`).join(', ') || $t('нет сети') }}</small>
          </span>
        </div>
        <p v-if="activityText" class="tiny">{{ activityText }}</p>

        <div v-if="code && codeLeft !== '0:00'" class="code">
          <small>{{ $t('Код для телефона · {0}', codeLeft) }}</small>
          <b class="display num">{{ code.code.slice(0, 3) }} {{ code.code.slice(3) }}</b>
          <small>{{ $t('В Amber на телефоне: Настройки → Компьютер по Wi-Fi → Найти компьютер') }}</small>
        </div>
        <button v-else type="button" class="btn" @click="showCode">{{ $t('Подключить телефон') }}</button>

        <div v-if="fs.pc.devices.length" class="devices">
          <div v-for="d in fs.pc.devices" :key="d.id" class="device">
            <span>
              <b>{{ d.name }}</b>
              <small>{{ d.lastSeenAt ? $t('на связи {0}', ago(d.lastSeenAt)) : $t('подключён {0}', ago(d.pairedAt)) }}</small>
            </span>
            <button type="button" class="link danger" @click="fs.unpairPc(d.id)">{{ $t('Отключить') }}</button>
          </div>
        </div>
      </template>
    </template>

    <!-- Телефон: подключение к компьютеру -->
    <template v-else-if="isNative">
      <h2 class="gtitle">{{ $t('Компьютер по Wi-Fi') }}</h2>
      <p class="note">
        {{ $t('Телефон и компьютер в одной сети обмениваются напрямую — без интернета, аккаунтов и серверов.') }}
      </p>

      <template v-if="fs.paired">
        <div class="state" :class="sync.mode === 'lan' ? sync.status : fs.status">
          <IconWifi />
          <span>
            <b>{{ fs.link!.pcName }}</b>
            <small>{{ fs.link!.base.replace(/^http:\/\//, '') }}</small>
          </span>
        </div>

        <label class="row" :class="{ off: viaServer || fs.link!.data === false }">
          <span
            ><b>{{ $t('Общие данные') }}</b
            ><small>{{
              fs.link!.data === false ? $t('Компьютер не делится данными: включи это в его настройках') : dataText
            }}</small></span
          >
          <input
            id="opt-fsync-data"
            type="checkbox"
            class="switch"
            :checked="fs.dataOn"
            :disabled="viaServer || (fs.link!.data === false && !fs.dataOn)"
            @change="fs.setData(!fs.dataOn)"
          />
        </label>

        <label class="row" :class="{ off: fs.link!.folder === null }">
          <span
            ><b>{{ $t('Папка с музыкой') }}</b
            ><small>{{
              fs.link!.folder === null
                ? $t('Компьютер не раздаёт папку: включи это в его настройках')
                : !fs.files
                  ? $t('Новая музыка с компьютера приходит сюда, а своя уходит туда')
                  : fs.status === 'running'
                    ? progressText
                    : fs.status === 'offline'
                      ? $t('Компьютер не в сети — синхронизирую, когда появится')
                      : fs.status === 'error'
                        ? fs.error
                        : `${reportText} · ${ago(fs.lastAt)}`
            }}</small></span
          >
          <input
            id="opt-fsync-files"
            type="checkbox"
            class="switch"
            :checked="fs.files && fs.link!.folder !== null"
            :disabled="fs.link!.folder === null"
            @change="fs.setFiles(!fs.files)"
          />
        </label>

        <template v-if="fs.files && fs.link!.folder !== null">
          <div v-if="!fs.access" class="warn">
            <span>{{ $t('Нужен доступ ко всем файлам: без него Amber не сможет записывать в папку с музыкой.') }}</span>
            <button type="button" class="btn small" @click="requestAccess">{{ $t('Разрешить') }}</button>
          </div>
          <div v-if="fs.status === 'running' && fs.progress?.bytesTotal" class="bar">
            <i :style="{ width: `${(fs.progress.bytesDone / fs.progress.bytesTotal) * 100}%` }" />
          </div>
          <div v-if="fs.report?.held" class="warn">
            <span>{{
              $t(
                'На другой стороне удалили {0} — больше, чем обычно. Удалить и здесь? Они уйдут в корзину.',
                countLabel(fs.report.held, $tp('файл|файла|файлов')),
              )
            }}</span>
            <button type="button" class="btn small" @click="fs.syncNow({ confirmDeletes: true })">{{ $t('Удалить') }}</button>
          </div>
          <p v-if="fs.report?.conflicts.length" class="tiny">
            {{ $t('Изменены с обеих сторон, оставлены более новые: {0}', fs.report.conflicts.slice(0, 3).join(', ')) }}
          </p>
          <p v-if="fs.report?.errors.length" class="tiny err">
            {{
              $t(
                'Не получилось: {0}',
                fs.report.errors
                  .slice(0, 3)
                  .map((e) => `${e.p.split('/').pop()} (${e.why})`)
                  .join(', '),
              )
            }}
          </p>
          <div class="pick">
            <span class="lbl">{{ $t('Папка на телефоне') }}</span>
            <span class="path ellipsis">{{ fs.root }}</span>
            <button type="button" class="link" @click="fs.chooseRoot()">{{ $t('Другая…') }}</button>
          </div>
        </template>

        <div class="btns">
          <button type="button" class="btn" :disabled="fs.status === 'running' || sync.status === 'syncing'" @click="syncAll">
            <IconSync />{{ $t('Синхронизировать сейчас') }}
          </button>
          <button type="button" class="link danger" @click="fs.unpair()">{{ $t('Отключить компьютер') }}</button>
        </div>
      </template>

      <template v-else>
        <button type="button" class="btn" :disabled="searching" @click="search">
          {{ searching ? $t('Ищу компьютер…') : $t('Найти компьютер') }}
        </button>
        <div v-if="found.length > 1" class="devices">
          <button
            v-for="f in found"
            :key="f.id"
            type="button"
            class="device pickable"
            :class="{ on: address === `${f.host}:${f.port}` }"
            @click="address = `${f.host}:${f.port}`"
          >
            <span
              ><b>{{ f.name }}</b
              ><small>{{ f.host }}</small></span
            >
          </button>
        </div>
        <label class="fl">
          <span>{{ $t('Адрес компьютера') }}</span>
          <input id="fsync-address" v-model="address" class="field" inputmode="url" placeholder="192.168.1.5" />
        </label>
        <label class="fl">
          <span>{{ $t('Код с экрана компьютера') }}</span>
          <input
            id="fsync-code"
            v-model="pairCode"
            class="field"
            inputmode="numeric"
            maxlength="7"
            placeholder="123 456"
            @keydown.enter="connect"
          />
        </label>
        <p v-if="formError" class="err">{{ formError }}</p>
        <button
          type="button"
          class="btn primary block"
          :disabled="busy || !address || pairCode.replace(/\D/g, '').length !== 6"
          @click="connect"
        >
          {{ busy ? $t('Подключаюсь…') : $t('Подключить') }}
        </button>
      </template>
    </template>
  </section>
</template>

<style scoped>
.row.off {
  opacity: 0.6;
}
.btns {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.btns .btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.btns .btn svg {
  width: 18px;
  height: 18px;
}
.state {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 6px 10px 14px;
  border-radius: var(--r-m);
  background: var(--surface-2);
}
.state > svg {
  width: 22px;
  height: 22px;
  color: var(--good);
}
.state.offline > svg,
.state.error > svg {
  color: var(--ink-3);
}
.state span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.state b {
  font-weight: 600;
  font-size: 14.5px;
}
.state small {
  color: var(--ink-2);
  font-size: 12.5px;
  line-height: 1.35;
}
.spin :deep(svg) {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.bar {
  height: 4px;
  border-radius: 2px;
  background: var(--line);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--amber);
  transition: width 300ms linear;
}
.pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  min-width: 0;
}
.lbl {
  width: 100%;
  font-size: 12.5px;
  color: var(--ink-3);
}
.path {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
}
.opt {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  font-size: 13px;
  color: var(--ink-2);
}
.opt svg {
  width: 16px;
  height: 16px;
  flex: none;
}
.opt.on {
  color: var(--ink);
  box-shadow: inset 0 0 0 1.5px var(--amber);
}
.code {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px;
  border-radius: var(--r-m);
  background: rgba(var(--amber-rgb), 0.12);
  text-align: center;
}
.code b {
  font-size: 34px;
  letter-spacing: 0.08em;
  color: var(--amber-ink);
}
.code small {
  font-size: 12.5px;
  color: var(--ink-2);
}
.devices {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.device {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  text-align: left;
}
.device.on {
  box-shadow: inset 0 0 0 1.5px var(--amber);
}
.device span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.device b {
  font-weight: 500;
  font-size: 14px;
}
.device small {
  color: var(--ink-2);
  font-size: 12px;
}
.warn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(var(--amber-rgb), 0.12);
  font-size: 13px;
  line-height: 1.4;
}
.warn .btn {
  flex: none;
}
.link {
  color: var(--amber-ink);
  font: 500 13px/1 var(--f-body);
  padding: 6px 0;
  align-self: flex-start;
}
.link.danger {
  color: var(--bad);
}
.tiny {
  font-size: 12.5px;
  color: var(--ink-3);
  line-height: 1.4;
}
.err {
  color: var(--bad);
  font-size: 13.5px;
  line-height: 1.4;
}
</style>
