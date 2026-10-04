<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import IconCloud from '~icons/solar/cloud-check-linear'
import IconOffline from '~icons/solar/cloud-cross-linear'
import IconSync from '~icons/solar/refresh-linear'
import { useSync } from '@/stores/sync'
import { useUi } from '@/stores/ui'
import { countLabel } from '@/domain/format'

/**
 * Настройки → Синхронизация. Вход на свой сервер Amber и состояние: когда синхронизировалось,
 * что ждёт отправки, какие устройства подключены. Синхронизация идёт сама, кнопка — на всякий случай.
 */
const sync = useSync()
const ui = useUi()

const mode = ref<'login' | 'register'>('login')
const url = ref(sync.url)
const email = ref(sync.email)
const password = ref('')
const code = ref('')
const busy = ref(false)
const formError = ref('')
const showDevices = ref(false)
const deleting = ref(false)
const deletePassword = ref('')

// «2 мин назад» обновляется само
const now = ref(Date.now())
let tick = 0
onMounted(() => {
  tick = window.setInterval(() => (now.value = Date.now()), 20_000)
  if (sync.signedIn) void sync.loadMe()
})
onBeforeUnmount(() => clearInterval(tick))

function ago(ts: number | null): string {
  if (!ts) return 'ещё не было'
  const m = Math.round((now.value - ts) / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ч назад`
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

const statusText = computed(() => {
  switch (sync.status) {
    case 'syncing':
      return 'Синхронизирую…'
    case 'offline':
      return 'Нет связи с сервером. Изменения отправятся, когда появится сеть'
    case 'error':
      return `Не получилось: ${sync.error}`
    case 'auth':
      return 'Вход устарел — войди снова'
    default:
      return sync.pending > 0
        ? `Ждёт отправки: ${countLabel(sync.pending, ['запись', 'записи', 'записей'])}`
        : `Всё синхронизировано · ${ago(sync.lastAt)}`
  }
})

async function submit() {
  formError.value = ''
  busy.value = true
  try {
    await sync.signIn(url.value, email.value, password.value, mode.value === 'register', code.value.trim() || undefined)
    password.value = ''
    ui.toast(mode.value === 'register' ? 'Аккаунт создан, данные отправляются на сервер' : 'Вход выполнен, синхронизирую')
    void sync.loadMe()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function signOut() {
  await sync.signOut()
  ui.toast('Синхронизация выключена. Данные на устройстве остались')
}

async function removeAccount() {
  formError.value = ''
  try {
    await sync.deleteAccount(deletePassword.value)
    deleting.value = false
    deletePassword.value = ''
    ui.toast('Аккаунт и данные на сервере удалены')
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <section class="group sync">
    <h2 class="gtitle">Синхронизация</h2>

    <template v-if="sync.signedIn && sync.status !== 'auth'">
      <div class="state" :class="sync.status">
        <IconOffline v-if="sync.status === 'offline' || sync.status === 'error'" />
        <IconCloud v-else />
        <span>
          <b>{{ sync.email }}</b>
          <small>{{ statusText }}</small>
        </span>
        <button
          type="button"
          class="icon-btn"
          :class="{ spin: sync.status === 'syncing' }"
          aria-label="Синхронизировать сейчас"
          title="Синхронизировать сейчас"
          @click="sync.syncNow()"
        >
          <IconSync />
        </button>
      </div>
      <p class="note">
        Сервер {{ sync.url.replace(/^https?:\/\//, '') }}. Оценки, история, плейлисты, эпохи, контексты, дневник и общие настройки
        синхронизируются сами, треки остаются на устройствах.
      </p>
      <div class="btns">
        <button type="button" class="btn" @click="showDevices = !showDevices">
          Устройства{{ sync.me ? ` · ${sync.me.devices.length}` : '' }}
        </button>
        <button type="button" class="btn" @click="signOut">Выйти</button>
      </div>
      <div v-if="showDevices && sync.me" class="devices">
        <div v-for="d in sync.me.devices" :key="d.id" class="device">
          <span>
            <b>{{ d.name }}{{ d.current ? ' · это устройство' : '' }}</b>
            <small>{{ ago(new Date(d.lastSeenAt).getTime()) }}</small>
          </span>
          <button v-if="!d.current" type="button" class="link" @click="sync.forgetDevice(d.id)">Отключить</button>
        </div>
        <p class="note">На сервере {{ countLabel(sync.me.items, ['запись', 'записи', 'записей']) }}.</p>
        <button v-if="!deleting" type="button" class="link danger" @click="deleting = true">Удалить аккаунт…</button>
        <div v-else class="del">
          <p class="note">Аккаунт и все данные на сервере удалятся. На устройствах всё останется.</p>
          <input
            id="sync-del-pass"
            v-model="deletePassword"
            class="field"
            type="password"
            placeholder="Пароль"
            autocomplete="current-password"
          />
          <div class="btns">
            <button type="button" class="btn" @click="deleting = false">Отмена</button>
            <button type="button" class="btn danger" :disabled="!deletePassword" @click="removeAccount">Удалить</button>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <p class="note">
        {{
          sync.status === 'auth'
            ? 'Вход на сервер устарел: войди снова, синхронизация продолжится с того же места.'
            : 'Свой сервер Amber связывает телефон и компьютер: оценки, история и плейлисты — общие. Музыка на сервер не загружается, без сети всё работает как раньше.'
        }}
      </p>
      <div v-if="sync.status !== 'auth'" class="seg">
        <button type="button" :class="{ on: mode === 'login' }" @click="mode = 'login'">Войти</button>
        <button type="button" :class="{ on: mode === 'register' }" @click="mode = 'register'">Создать аккаунт</button>
      </div>
      <label class="fl">
        <span>Адрес сервера</span>
        <input
          id="sync-url"
          v-model="url"
          class="field"
          type="url"
          inputmode="url"
          placeholder="music.example.com"
          autocomplete="url"
        />
      </label>
      <label class="fl">
        <span>Почта</span>
        <input id="sync-email" v-model="email" class="field" type="email" inputmode="email" autocomplete="username" />
      </label>
      <label class="fl">
        <span>Пароль</span>
        <input
          id="sync-password"
          v-model="password"
          class="field"
          type="password"
          :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
          @keydown.enter="submit"
        />
      </label>
      <label v-if="mode === 'register'" class="fl">
        <span>Код приглашения <small class="muted">если сервер его просит</small></span>
        <input id="sync-code" v-model="code" class="field" autocomplete="off" />
      </label>
      <p v-if="formError" class="err">{{ formError }}</p>
      <button type="button" class="btn primary block" :disabled="busy || !url || !email || !password" @click="submit">
        {{ busy ? 'Подключаюсь…' : mode === 'register' ? 'Создать аккаунт' : 'Войти' }}
      </button>
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
}
.spin :deep(svg) {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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
.link {
  color: var(--amber-ink);
  font: 500 13px/1 var(--f-body);
  padding: 6px 0;
  align-self: flex-start;
}
.link.danger,
.btn.danger {
  color: var(--bad);
}
.del {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.err {
  color: var(--bad);
  font-size: 13.5px;
  line-height: 1.4;
}
.fl small {
  font-weight: 400;
}
</style>
