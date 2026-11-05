<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import IconMusic from '~icons/solar/music-notes-linear'
import IconBell from '~icons/solar/bell-linear'
import IconBattery from '~icons/solar/bolt-linear'
import IconFolder from '~icons/solar/folder-open-linear'
import { MusicCore, MusicCoreWeb } from '@/native/music-core'
import { isNative } from '@/native/paths'
import { isDesktop } from '@/native/desktop/bridge'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { countLabel } from '@/domain/format'
import { $t, $tp } from '@/i18n'

/**
 * Первый запуск: доступ к музыке → уведомления → поиск треков → готово.
 * На каждом шаге одна главная кнопка.
 */
const router = useRouter()
const library = useLibrary()
const settings = useSettings()

type Step = 'intro' | 'scan' | 'done'
const step = ref<Step>('intro')
const error = ref('')
const found = ref(0)

const progressText = computed(() => {
  const p = library.progress
  if (!p) return $t('Смотрю, какие файлы есть на телефоне…')
  if (p.phase === 'list') return $t('Нашёл {0} файлов', p.total)
  return $t('Читаю теги: {0} из {1}', p.done, p.total)
})

async function grant() {
  error.value = ''
  try {
    const info = await MusicCore.getInfo()
    const aliases = info.sdkInt >= 33 ? (['audio', 'notifications'] as const) : (['storage'] as const)
    const res = await MusicCore.requestPermissions({ permissions: [...aliases] })
    const audioOk = info.sdkInt >= 33 ? res.audio === 'granted' : res.storage === 'granted'
    if (!audioOk && isNative) {
      error.value = $t(
        'Без доступа к музыке приложению нечего играть. Разреши доступ в настройках Android: Приложения → Amber → Разрешения.',
      )
      return
    }
    step.value = 'scan'
    const r = await library.scan(true)
    found.value = r?.total ?? library.tracks.length
    step.value = 'done'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    step.value = 'intro'
  }
}

/** Браузер: своя папка с mp3 вместо демо-библиотеки */
async function pickFolder() {
  error.value = ''
  try {
    await MusicCoreWeb.pickFolder()
    step.value = 'scan'
    const r = await library.scan(true)
    found.value = r?.total ?? library.tracks.length
    step.value = 'done'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/abort|cancel/i.test(msg)) error.value = msg
    step.value = 'intro'
  }
}

function finish() {
  settings.s.onboarded = true
  void router.replace('/')
}
</script>

<template>
  <div class="welcome scroll">
    <div class="glow" aria-hidden="true"><i /><i /></div>
    <div class="content">
      <h1 class="display brand">Amber</h1>
      <p class="tag">{{ $t('Личный офлайн-плеер, который помнит каждое прослушивание') }}</p>

      <template v-if="step === 'intro'">
        <ul class="points">
          <li>
            <IconMusic /><span v-if="isDesktop"
              ><b>{{ $t('Папка с музыкой') }}</b
              >{{ $t('Amber читает файлы прямо с диска и сам замечает новые. Ничего не загружается в сеть.') }}</span
            ><span v-else
              ><b>{{ $t('Доступ к музыке') }}</b
              >{{ $t('Чтобы найти mp3 на телефоне. Файлы не покидают устройство.') }}</span
            >
          </li>
          <li>
            <IconBell /><span v-if="isDesktop"
              ><b>{{ $t('Трей и клавиши') }}</b
              >{{ $t('Крестик прячет окно в трей — музыка играет. Клавиши мультимедиа и пробел работают.') }}</span
            ><span v-else
              ><b>{{ $t('Уведомления') }}</b
              >{{ $t('Плеер в шторке, на экране блокировки и на часах.') }}</span
            >
          </li>
          <li v-if="isNative">
            <IconBattery /><span
              ><b>{{ $t('Совет про батарею') }}</b
              >{{ $t('В настройках Android поставь приложению режим «Без ограничений», чтобы One UI не усыплял музыку.') }}</span
            >
          </li>
        </ul>
        <p v-if="error" class="error">{{ error }}</p>
        <template v-if="isNative">
          <button type="button" class="btn primary block" @click="grant">{{ $t('Разрешить и найти музыку') }}</button>
        </template>
        <template v-else>
          <button type="button" class="btn primary block" @click="pickFolder">
            <IconFolder />{{ $t('Открыть папку с музыкой') }}
          </button>
          <template v-if="isDesktop">
            <p class="muted small">
              {{
                $t(
                  'Выбери папку, где лежит музыка, например «Музыка». Потом в настройках можно добавить ещё папки. Файлы не покидают компьютер.',
                )
              }}
            </p>
          </template>
          <template v-else>
            <button type="button" class="btn block demo" @click="grant">{{ $t('Попробовать на демо-треках') }}</button>
            <p class="muted small">
              {{ $t('Это веб-версия для проверки на компьютере. Файлы читаются прямо в браузере и никуда не отправляются.') }}
            </p>
          </template>
        </template>
      </template>

      <template v-else-if="step === 'scan'">
        <div class="scan">
          <div class="spinner" aria-hidden="true" />
          <p>{{ progressText }}</p>
          <p class="muted small">{{ $t('Обложки и громкость догрузятся потом, в фоне.') }}</p>
        </div>
      </template>

      <template v-else>
        <div class="scan">
          <p class="big display">{{ countLabel(found, $tp('трек|трека|треков')) }}</p>
          <p class="muted">{{ $t('Библиотека готова. Оценки, история и статистика начнут копиться с первого трека.') }}</p>
        </div>
        <button type="button" class="btn primary block" @click="finish">{{ $t('Начать слушать') }}</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  position: fixed;
  inset: 0;
  background: var(--bg);
  overflow-y: auto;
}
.glow {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.glow i {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
}
.glow i:first-child {
  width: 110vw;
  height: 110vw;
  left: -40vw;
  top: -40vw;
  background: rgba(var(--amber-rgb), 0.35);
}
.glow i:last-child {
  width: 80vw;
  height: 80vw;
  right: -40vw;
  top: 10vh;
  background: rgba(224, 96, 42, 0.22);
}
.content {
  position: relative;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 18px;
  padding: calc(var(--safe-top) + 40px) 24px calc(var(--safe-bottom) + 28px);
}
.brand {
  font-size: clamp(54px, 17vw, 88px);
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 0.95;
  background: linear-gradient(100deg, var(--ink) 30%, var(--amber) 62%, var(--ember) 85%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.tag {
  font: 500 19px/1.35 var(--f-body);
  max-width: 24ch;
}
.points {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.points li {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 14px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--ink-2);
}
.points svg {
  width: 26px;
  height: 26px;
  color: var(--amber-ink);
}
.points b {
  display: block;
  color: var(--ink);
  font-size: 15px;
  margin-bottom: 2px;
}
.error {
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bad) 14%, transparent);
  font-size: 13.5px;
  line-height: 1.45;
}
.scan {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px 0;
}
.big {
  font-size: 34px;
  font-weight: 600;
}
.small {
  font-size: 13px;
}
.spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid var(--line-strong);
  border-top-color: var(--amber);
  animation: spin 900ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.demo {
  margin-top: 10px;
}
</style>
