import { ref } from 'vue'
import { todayKey } from '@/domain/streaks'

/**
 * Счётчик «данные поменялись не отсюда»: растёт, когда синхронизация принесла изменения с другого
 * устройства, и когда история Spotify загружена, включена или выключена. Экраны, которые читают базу сами (главная, чарты, хроника, дневник), перечитывают её
 * по нему — см. onPageShown в app/paging.ts.
 */
export const dataRev = ref(0)

/**
 * Свои изменения: записано прослушивание или интерфейс поменял что-то в базе (оценка, заметка дня, эпоха,
 * контекст, плейлист). Настройки и служебные таблицы синхронизации не в счёт — см. data/db.ts
 */
export const localRev = ref(0)

/** Отпечаток данных для экранов статистики. День в нём — чтобы после полуночи «сегодня» и серии пересчитались */
export function statsStamp(): string {
  return `${dataRev.value}.${localRev.value}.${todayKey()}`
}

/**
 * Загрузка экрана статистики без лишней работы. Раньше экран хроники перечитывал всю историю при монтировании
 * и ещё раз при каждом показе — десятки тысяч прослушиваний (со Spotify) по нескольку раз за свайп, а на
 * телефоне запросы к базе идут по одному, и лёгкие экраны ждали тяжёлые. Теперь перечитываем, только если
 * данные поменялись с прошлого раза; load(true) — перечитать в любом случае (поменялся период, правка тут же)
 */
export function stampedLoad(fn: () => Promise<void>): (force?: boolean) => Promise<void> {
  let stamp: string | null = null
  let running: Promise<void> | null = null
  return async (force = false) => {
    if (running) await running
    const s = statsStamp()
    if (!force && s === stamp) return
    stamp = s
    running = fn()
      .catch((e: unknown) => {
        // Не получилось — в следующий раз пробуем снова
        stamp = null
        console.warn('stats load failed', e)
      })
      .finally(() => (running = null))
    await running
  }
}
