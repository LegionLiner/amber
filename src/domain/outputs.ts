/** Человеческое имя вывода звука: bt:AirPods Pro → «AirPods Pro», speaker → «Динамик телефона» */
export function outputLabel(id: string): string {
  if (id.startsWith('bt:')) return id.slice(3) || 'Bluetooth'
  switch (id) {
    case 'wired':
      return 'Проводные наушники'
    case 'usb':
      return 'USB'
    case 'web':
      return 'Браузер'
    default:
      return 'Динамик телефона'
  }
}
