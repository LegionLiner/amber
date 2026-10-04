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
    () => [settings.s.theme, settings.s.glass, settings.s.motion],
    () => applyAppearance(settings.s),
  )

  await MusicCore.configure({ counting: settings.s.counting })
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
      void weeklyHousekeeping().catch((e) => console.warn('housekeeping failed', e))
      void runAutoBackup().catch((e) => console.warn('auto-backup failed', e))
    })
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
