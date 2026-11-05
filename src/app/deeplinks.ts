import { App as CapApp } from '@capacitor/app'
import { isNative } from '@/native/paths'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useRadio } from '@/stores/radio'
import { useUi } from '@/stores/ui'
import { $t } from '@/i18n'

/**
 * Ярлыки на значке приложения (долгое нажатие) открывают адреса yantar://action/…:
 * smartmix — умный микс из всей медиатеки, resume — продолжить, radio — «Моё радио».
 */
export async function runAction(action: string): Promise<void> {
  const player = usePlayer()
  const library = useLibrary()
  const ui = useUi()
  switch (action) {
    case 'smartmix':
      await player.playTracks(
        library.tracks,
        -1,
        { type: 'smart', id: 'smartmix', title: $t('Умный микс') },
        { shuffle: true, kind: 'smart' },
      )
      ui.fullPlayer = true
      break
    case 'resume':
      if (player.hasTrack) await player.play()
      ui.fullPlayer = player.hasTrack
      break
    case 'radio':
      await useRadio().startMine()
      ui.fullPlayer = true
      break
  }
}

function actionOf(url: string): string | null {
  const m = /^yantar:\/\/action\/([a-z]+)/i.exec(url)
  return m ? m[1]!.toLowerCase() : null
}

export async function setupDeepLinks(): Promise<void> {
  if (!isNative) {
    // В браузере то же самое через адрес: …/#/?action=smartmix
    const a = new URLSearchParams(location.hash.split('?')[1] ?? '').get('action')
    if (a) await runAction(a)
    return
  }
  await CapApp.addListener('appUrlOpen', ({ url }) => {
    const a = actionOf(url)
    if (a) void runAction(a)
  })
  const launch = await CapApp.getLaunchUrl()
  const a = launch?.url ? actionOf(launch.url) : null
  if (a) await runAction(a)
}
