import { $t } from '@/i18n'
/** Человеческое имя вывода звука: bt:AirPods Pro → «AirPods Pro», speaker → «Динамик телефона» */
export function outputLabel(id: string): string {
  if (id.startsWith('bt:')) return id.slice(3) || 'Bluetooth'
  // Компьютер: устройство вывода Windows по имени
  if (id.startsWith('pc:')) return id.slice(3) || $t('Этот компьютер')
  switch (id) {
    case 'wired':
      return $t('Проводные наушники')
    case 'usb':
      return 'USB'
    case 'web':
      return $t('Браузер')
    default:
      return $t('Динамик телефона')
  }
}
