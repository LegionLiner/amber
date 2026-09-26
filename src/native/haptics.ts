import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

/** Вибро-отклик. Ошибки глушим: на компьютере вибрации нет, и это нормально. */
export const haptic = {
  tick() {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined)
  },
  press() {
    void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => undefined)
  },
  success() {
    void Haptics.notification({ type: NotificationType.Success }).catch(() => undefined)
  },
}
