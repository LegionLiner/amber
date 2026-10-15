<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import IconWifi from '~icons/solar/wi-fi-router-linear'
import IconSync from '~icons/solar/refresh-linear'
import IconFolder from '~icons/solar/folder-2-linear'
import { useFileSync } from '@/stores/filesync'
import { useUi } from '@/stores/ui'
import { desktop, isDesktop } from '@/native/desktop/bridge'
import { isNative } from '@/native/paths'
import { MusicCore } from '@/native/music-core'
import { countLabel, formatBytes } from '@/domain/format'

/**
 * Настройки → Папка по Wi-Fi: компьютер раздаёт папку с музыкой, телефон забирает новое и отдаёт своё,
 * когда они в одной сети (вместо Syncthing). На компьютере — что раздавать и код для телефона,
 * на телефоне — подключение, папка, доступ к файлам и ход синхронизации.
 */
const fs = useFileSync()
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
  if (!ts) return 'ещё не было'
  const m = Math.round((now.value - ts) / 60_000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ч назад`
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
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
  const p = await desktop!.chooseFolder('Папка для телефона')
  if (p) await fs.setPc({ folder: p })
}
const activityText = computed(() => {
  const a = fs.activity
  if (!a) return ''
  const name = a.path?.split(/[\\/]/).pop() ?? ''
  const what = { pull: 'забрал', push: 'прислал', trash: 'убрал в корзину', pair: 'подключился', list: '' }[a.op] ?? ''
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
    if (!found.value.length) formError.value = 'Компьютер не найден. Он включён и в той же сети? Можно ввести адрес вручную.'
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
    ui.toast(`Подключено к «${fs.link?.pcName}»`)
    void fs.syncNow()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

const progressText = computed(() => {
  const p = fs.progress
  if (!p) return 'Сверяю папки…'
  const bytes = p.bytesTotal ? ` · ${formatBytes(p.bytesDone)} из ${formatBytes(p.bytesTotal)}` : ''
  return `${p.done} из ${p.total}${bytes}${p.current ? ` · ${p.current.split('/').pop()}` : ''}`
})
const reportText = computed(() => {
  const r = fs.report
  if (!r) return ''
  const parts: string[] = []
  if (r.pulled) parts.push(`получено ${r.pulled}`)
  if (r.pushed) parts.push(`отправлено ${r.pushed}`)
  if (r.trashedLocal || r.trashedRemote) parts.push(`в корзину ${r.trashedLocal + r.trashedRemote}`)
  if (!parts.length) parts.push('всё совпадает')
  return parts.join(', ')
})
</script>

<template>
  <section class="group fsync">
    <h2 class="gtitle">Папка по Wi-Fi</h2>

    <!-- Компьютер: раздаёт -->
    <template v-if="isDesktop && fs.pc">
      <p class="note">
        Телефон забирает отсюда новую музыку и присылает свою, когда вы в одной сети, — как Syncthing, только внутри Amber. Замена
        и удаление на другой стороне ничего не стирают насовсем: прежние версии уходят в корзину.
      </p>
      <label class="row">
        <span><b>Раздавать папку телефону</b><small>Windows может спросить разрешение для частной сети — разреши</small></span>
        <input
          id="opt-fsync"
          type="checkbox"
          class="switch"
          :checked="fs.pc.enabled"
          @change="fs.setPc({ enabled: !fs.pc.enabled, folder: fs.pc.folder ?? folders[0] ?? null })"
        />
      </label>
      <template v-if="fs.pc.enabled">
        <div class="pick">
          <span class="lbl">Папка</span>
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
          <button
            v-if="fs.pc.folder && !folders.includes(fs.pc.folder)"
            type="button"
            class="opt ellipsis on"
            @click="chooseOther"
          >
            <IconFolder />{{ fs.pc.folder }}
          </button>
          <button type="button" class="link" @click="chooseOther">Другая папка…</button>
        </div>
        <p v-if="fs.pc.error" class="err">{{ fs.pc.error }}</p>
        <div v-else-if="fs.pc.running" class="state">
          <IconWifi />
          <span>
            <b>Раздаю «{{ fs.pc.folder?.split(/[\\/]/).pop() }}»</b>
            <small>{{ fs.pc.addresses.map((a) => `${a}:${fs.pc!.port}`).join(', ') || 'нет сети' }}</small>
          </span>
        </div>
        <p v-if="activityText" class="tiny">{{ activityText }}</p>

        <div v-if="code && codeLeft !== '0:00'" class="code">
          <small>Код для телефона · {{ codeLeft }}</small>
          <b class="display num">{{ code.code.slice(0, 3) }} {{ code.code.slice(3) }}</b>
          <small>В Amber на телефоне: Настройки → Папка по Wi-Fi → Найти компьютер</small>
        </div>
        <button v-else type="button" class="btn" @click="showCode">Подключить телефон</button>

        <div v-if="fs.pc.devices.length" class="devices">
          <div v-for="d in fs.pc.devices" :key="d.id" class="device">
            <span>
              <b>{{ d.name }}</b>
              <small>{{ d.lastSeenAt ? `на связи ${ago(d.lastSeenAt)}` : `подключён ${ago(d.pairedAt)}` }}</small>
            </span>
            <button type="button" class="link danger" @click="fs.unpairPc(d.id)">Отключить</button>
          </div>
        </div>
      </template>
    </template>

    <!-- Телефон: забирает и отдаёт -->
    <template v-else-if="isNative">
      <p class="note">
        Новая музыка с компьютера приходит сюда, а своя уходит туда, когда телефон и компьютер в одной сети. Работает, пока Amber
        открыт; прежние версии и удалённое уходят в корзину, а не пропадают.
      </p>

      <div v-if="!fs.access" class="warn">
        <span>Нужен доступ ко всем файлам: без него Amber не сможет записывать в папку с музыкой.</span>
        <button type="button" class="btn small" @click="requestAccess">Разрешить</button>
      </div>

      <template v-if="fs.paired">
        <div class="state" :class="fs.status">
          <IconWifi />
          <span>
            <b>{{ fs.link!.pcName }}</b>
            <small>{{
              fs.status === 'running'
                ? progressText
                : fs.status === 'offline'
                  ? 'Компьютер не в сети — синхронизирую, когда появится'
                  : fs.status === 'error'
                    ? fs.error
                    : `${reportText} · ${ago(fs.lastAt)}`
            }}</small>
          </span>
          <button
            type="button"
            class="icon-btn"
            :class="{ spin: fs.status === 'running' }"
            aria-label="Синхронизировать сейчас"
            :disabled="!fs.access"
            @click="fs.status === 'running' ? fs.cancel() : fs.syncNow()"
          >
            <IconSync />
          </button>
        </div>
        <div v-if="fs.status === 'running' && fs.progress?.bytesTotal" class="bar">
          <i :style="{ width: `${(fs.progress.bytesDone / fs.progress.bytesTotal) * 100}%` }" />
        </div>

        <div v-if="fs.report?.held" class="warn">
          <span
            >На другой стороне удалили {{ countLabel(fs.report.held, ['файл', 'файла', 'файлов']) }} — больше, чем обычно. Удалить
            и здесь? Они уйдут в корзину.</span
          >
          <button type="button" class="btn small" @click="fs.syncNow({ confirmDeletes: true })">Удалить</button>
        </div>
        <p v-if="fs.report?.conflicts.length" class="tiny">
          Изменены с обеих сторон, оставлены более новые: {{ fs.report.conflicts.slice(0, 3).join(', ') }}
        </p>
        <p v-if="fs.report?.errors.length" class="tiny err">
          Не получилось:
          {{
            fs.report.errors
              .slice(0, 3)
              .map((e) => `${e.p.split('/').pop()} (${e.why})`)
              .join(', ')
          }}
        </p>

        <div class="pick">
          <span class="lbl">Папка на телефоне</span>
          <span class="path ellipsis">{{ fs.root }}</span>
          <button type="button" class="link" @click="fs.chooseRoot()">Другая…</button>
        </div>
        <button type="button" class="link danger" @click="fs.unpair()">Отключить компьютер</button>
      </template>

      <template v-else>
        <button type="button" class="btn" :disabled="searching" @click="search">
          {{ searching ? 'Ищу компьютер…' : 'Найти компьютер' }}
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
          <span>Адрес компьютера</span>
          <input id="fsync-address" v-model="address" class="field" inputmode="url" placeholder="192.168.1.5" />
        </label>
        <label class="fl">
          <span>Код с экрана компьютера</span>
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
          {{ busy ? 'Подключаюсь…' : 'Подключить' }}
        </button>
      </template>
    </template>
  </section>
</template>

<style scoped>
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
