import type { Component } from 'vue'
import IconSad from '~icons/solar/sad-circle-linear'
import IconTense from '~icons/solar/confounded-circle-linear'
import IconCalm from '~icons/solar/sleeping-circle-linear'
import IconGood from '~icons/solar/smile-circle-linear'
import IconGreat from '~icons/solar/emoji-funny-circle-linear'
import { $t } from '@/i18n'

/** Настроение дня в дневнике: 1…5 */
export const MOODS: { value: number; label: string; icon: Component; color: string }[] = [
  {
    value: 1,
    get label() {
      return $t('Грустно')
    },
    icon: IconSad,
    color: '#7c8fb0',
  },
  {
    value: 2,
    get label() {
      return $t('Тревожно')
    },
    icon: IconTense,
    color: '#b08a7c',
  },
  {
    value: 3,
    get label() {
      return $t('Спокойно')
    },
    icon: IconCalm,
    color: '#8fb0a4',
  },
  {
    value: 4,
    get label() {
      return $t('Хорошо')
    },
    icon: IconGood,
    color: '#e0b25a',
  },
  {
    value: 5,
    get label() {
      return $t('Отлично')
    },
    icon: IconGreat,
    color: '#ff9a3e',
  },
]

export function moodOf(v: number | null | undefined) {
  return v ? (MOODS.find((m) => m.value === v) ?? null) : null
}
