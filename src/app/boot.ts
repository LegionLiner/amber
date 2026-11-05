import { toRaw, watch } from 'vue'
import { App as CapApp } from '@capacitor/app'
import { MusicCore } from '@/native/music-core'
import { isNative, setCoversDir } from '@/native/paths'
import { migrate } from '@/data/db'
import { useSettings } from '@/stores/settings'
import { SCANNER_VERSION, useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { applyAppearance } from './theme'
import { router } from './router'
import { setupDeepLinks } from './deeplinks'
import { runAutoBackup } from './auto-backup'
import { weeklyHousekeeping } from './housekeeping'
import { setupDesktop } from './desktop'
import { setupVoice } from './voice'
import { useSync } from '@/stores/sync'
import { useFileSync } from '@/stores/filesync'
import { formatDate } from '@/domain/format'
import type { DbRecovery } from '@/native/types'
import { LOCALE, $t, lang } from '@/i18n'

/**
 * Запуск приложения:
 * 1) узнать пути у движка, 2) миграции базы, 3) настройки и тема,
 * 4) правило подсчёта и настройки звука в движок, 5) библиотека, 6) подключение к плееру,
 * 7) фоновое досканирование изменений, анализ, недельные итоги и автобэкап.
 */
export async function boot(): Promise<void> {
  const info = await MusicCore.getInfo()
  setCoversDir(info.coversDir)
  await migrate()

  const settings = useSettings()
  await settings.load()
  applyAppearance(settings.s)
  watch(
    () => [settings.s.theme, settings.s.accent, settings.s.backdrop, settings.s.glass, settings.s.motion],
    () => applyAppearance(settings.s),
  )
  if (info.dbRecovery) useUi().toast(recoveryText(info.dbRecovery), undefined, 15_000)

  await MusicCore.configure({ counting: settings.s.counting, lang })
  watch(
    () => settings.s.counting,
    (counting) => void MusicCore.configure({ counting }),
    { deep: true },
  )

  // Настройки звука уходят в движок целиком при любом изменении (ползунки — с небольшой задержкой)
  let audioTimer: ReturnType<typeof setTimeout> | undefined
  const pushAudio = () => MusicCore.setAudioSettings(structuredClone(toRaw(settings.s.audio)))
  await pushAudio()
  watch(
    () => settings.s.audio,
    () => {
      clearTimeout(audioTimer)
      audioTimer = setTimeout(() => void pushAudio(), 120)
    },
    { deep: true },
  )

  const library = useLibrary()
  const player = usePlayer()
  await library.load()
  await library.attach()
  await player.attach()

  setupBackButton()
  setupDesktop()
  setupVoice()
  const sync = useSync()
  await sync.load().catch((e) => console.warn('sync load failed', e))
  // Ярлыки на значке работают и в первый запуск, сразу после приветствия
  await setupDeepLinks()

  if (!settings.s.onboarded) {
    await router.replace('/welcome')
    return
  }
  // Сканирование инкрементальное: читаются только новые и изменённые файлы.
  // После обновления сканера — один полный проход, чтобы перечитать теги по-новому
  void library
    .scan((settings.s.scan.version ?? 0) < SCANNER_VERSION)
    .catch((e) => console.warn('scan failed', e))
    .finally(() => {
      // Синхронизация — после сканирования: карточки треков для других устройств берут названия из медиатеки
      if (sync.signedIn) {
        sync.start()
        void sync.syncNow()
      }
      // Папка по Wi-Fi (телефон): после сканирования — чтобы пришедшее сразу легло в медиатеку
      useFileSync().start()
      void weeklyHousekeeping().catch((e) => console.warn('housekeeping failed', e))
      void runAutoBackup().catch((e) => console.warn('auto-backup failed', e))
    })
}

/** База оказалась повреждена и движок её восстановил (web-db.ts, Database.kt): сказать, что произошло */
function recoveryText(r: DbRecovery): string {
  const kept = r.brokenFile ? $t(' Повреждённый файл сохранён как {0}.', r.brokenFile) : ''
  if (r.restoredFrom != null) {
    const time = new Date(r.restoredFrom).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })
    return $t(
      'База была повреждена (например, питание пропало посреди записи). Восстановлена копия от {0}, {1}.{2}',
      formatDate(r.restoredFrom),
      time,
      kept,
    )
  }
  return $t(
    'База была повреждена, а целой копии не нашлось — начата новая. Историю можно вернуть: Настройки → Данные → Импорт из JSON или синхронизация.{0}',
    kept,
  )
}

function setupBackButton() {
  if (!isNative) return
  const ui = useUi()
  void CapApp.addListener('backButton', ({ canGoBack }) => {
    if (ui.back()) return
    if (canGoBack && router.currentRoute.value.name !== 'home') {
      router.back()
      return
    }
    // Не закрываем приложение, а сворачиваем: музыка продолжит играть
    void CapApp.minimizeApp()
  })
}
