import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'
import { db } from '@/data/db'
import { DEFAULT_COUNTING } from '@/domain/counting'
import type { AudioSettings, CountingRule, RepeatMode } from '@/native/types'
import type { SoundPreset } from '@/domain/effects'
import type { ShuffleKind } from '@/domain/shuffle'
import type { AccentId, BackdropId } from '@/domain/themes'
import { cleanTools, DEFAULT_PLAYER_TOOLS, type PlayerToolId } from '@/domain/player-tools'
import type { CalColor, CalScale } from '@/domain/calendar'
import { $t } from '@/i18n'

export type ThemeMode = 'dark' | 'light' | 'system'
export type SortDir = 'asc' | 'desc'
export interface SortPref {
  key: string
  dir: SortDir
}

export type { ShuffleKind }

export interface BackupSettings {
  enabled: boolean
  /** Папка, выбранная через системный диалог (content://…) */
  folderUri: string | null
  keep: number
  lastAt: number | null
}

export interface RadioDials {
  /** 0 — только похожее, 1 — смелые повороты */
  adventure: number
  /** 0 — любимое и знакомое, 1 — давно не игравшее и новое */
  freshness: number
}

export interface AppSettings {
  onboarded: boolean
  theme: ThemeMode
  /** Акцентный цвет и фон (domain/themes.ts) */
  accent: AccentId
  backdrop: BackdropId
  /** Телефон: быстрые кнопки внизу экрана плеера, по порядку */
  playerTools: PlayerToolId[]
  glass: 'full' | 'low'
  motion: 'full' | 'reduced'
  counting: CountingRule
  scan: {
    minDurationMs: number
    excludeFolders: string[]
    lastScanAt: number | null
    /** Версия сканера, которой прочитана библиотека: при росте — один полный пересчёт тегов */
    version: number
  }
  /** Если у трека нет тега альбома, считать альбомом папку */
  albumFromFolder: boolean
  /** Сортировка для каждого экрана отдельно */
  sorts: Record<string, SortPref>
  /** Календарь «Каждый день» в хронике: масштаб и раскраска */
  dailyView: { scale: CalScale; color: CalColor }
  /** После скольких прослушиваний без оценки попросить оценить (0 = не просить) */
  askRatingAfterPlays: number
  recentSearches: string[]
  audio: AudioSettings
  backup: BackupSettings
  shuffleKind: ShuffleKind
  /** Перемешивание и повтор переживают перезапуск: 'off' или вид перемешивания; повтор null — ещё не сохраняли */
  shuffle: 'off' | ShuffleKind
  repeat: RepeatMode | null
  /** Свои пресеты звука: скорость, тон и эффекты одной кнопкой */
  soundPresets: SoundPreset[]
  radio: RadioDials
  /** Правки тегов записывать в сами файлы (если нельзя — остаются в приложении) */
  writeTagsToFiles: boolean
  /** Показывать текст песни в плеере, если он есть */
  showLyrics: boolean
  /** Если в файле нет текста — искать его в открытой базе LRCLIB */
  lrclib: boolean
  /** Свёрнутые группы плейлистов (их created_at) — своё у каждого устройства */
  collapsedGroups: number[]
  /** Компьютер: голосовые команды («Эмбер, следующий») */
  voice: boolean
  /** Компьютер: какой микрофон слушают голосовые команды; null — основной в Windows. Своё у каждого устройства */
  voiceMic: { id: string; label: string } | null
  /** Компьютер: панель «Сейчас играет» справа */
  nowPanel: boolean
  /** Компьютер: фон и свечение снизу дышат в такт басам */
  desktopPulse: boolean
}

export const EQ_PRESETS: Record<string, { label: string; bands: number[]; preampDb: number }> = {
  flat: { label: $t('Ровно'), bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preampDb: 0 },
  bass: { label: $t('Бас'), bands: [5, 4, 3, 1.5, 0, 0, 0, 0, 0, 0], preampDb: -4 },
  vocal: { label: $t('Голос'), bands: [-2, -1.5, -1, 0, 1.5, 3, 3, 2, 0, -1], preampDb: -3 },
  night: { label: $t('Ночь'), bands: [2, 1.5, 1, 0, 0, 0, -1, -2, -3, -4], preampDb: -2 },
  bright: { label: $t('Ярко'), bands: [0, 0, 0, 0, 0, 0.5, 1.5, 3, 4, 4], preampDb: -4 },
  loudness: { label: $t('Громкость'), bands: [4, 3, 1, 0, -1, -1, 0, 1, 3, 4], preampDb: -4 },
}

export const DEFAULT_AUDIO: AudioSettings = {
  crossfade: { mode: 'crossfade', durationMs: 5000, curve: 'equalPower', duckDb: -9, smart: true, skipFadeMs: 250 },
  normalization: { mode: 'smart', targetLufs: -14 },
  eq: { enabled: false, preampDb: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preset: 'flat' },
  profiles: {},
  autoResume: false,
}

export const DEFAULT_SETTINGS: AppSettings = {
  onboarded: false,
  theme: 'dark',
  accent: 'amber',
  backdrop: 'warm',
  playerTools: DEFAULT_PLAYER_TOOLS,
  glass: 'full',
  motion: 'full',
  counting: DEFAULT_COUNTING,
  scan: {
    minDurationMs: 30_000,
    excludeFolders: [
      'Recordings/',
      'Notifications/',
      'Ringtones/',
      'Alarms/',
      'Android/media/com.whatsapp/',
      'WhatsApp/',
      'Telegram/Telegram Voice/',
    ],
    lastScanAt: null,
    version: 0,
  },
  albumFromFolder: true,
  sorts: {},
  dailyView: { scale: '18w', color: 'time' },
  askRatingAfterPlays: 5,
  recentSearches: [],
  audio: DEFAULT_AUDIO,
  backup: { enabled: false, folderUri: null, keep: 14, lastAt: null },
  shuffleKind: 'smart',
  shuffle: 'off',
  repeat: null,
  soundPresets: [],
  radio: { adventure: 0.35, freshness: 0.4 },
  writeTagsToFiles: true,
  showLyrics: true,
  lrclib: true,
  collapsedGroups: [],
  voice: false,
  voiceMic: null,
  nowPanel: true,
  desktopPulse: true,
}

const KEY = 'app'

export const useSettings = defineStore('settings', () => {
  const s = reactive<AppSettings>(structuredClone(DEFAULT_SETTINGS))
  let loaded = false
  let timer: ReturnType<typeof setTimeout> | undefined

  async function load() {
    const row = await db.selectFrom('settings').select('value').where('key', '=', KEY).executeTakeFirst()
    if (row) {
      try {
        const saved = JSON.parse(row.value) as Partial<AppSettings>
        Object.assign(s, { ...structuredClone(DEFAULT_SETTINGS), ...saved })
        s.scan = { ...DEFAULT_SETTINGS.scan, ...saved.scan }
        s.counting = { ...DEFAULT_SETTINGS.counting, ...saved.counting }
        const a = saved.audio
        s.audio = {
          crossfade: { ...DEFAULT_AUDIO.crossfade, ...a?.crossfade },
          normalization: { ...DEFAULT_AUDIO.normalization, ...a?.normalization },
          eq: { ...DEFAULT_AUDIO.eq, ...a?.eq },
          profiles: a?.profiles ?? {},
          autoResume: a?.autoResume ?? DEFAULT_AUDIO.autoResume,
        }
        s.backup = { ...DEFAULT_SETTINGS.backup, ...saved.backup }
        s.radio = { ...DEFAULT_SETTINGS.radio, ...saved.radio }
        s.dailyView = { ...DEFAULT_SETTINGS.dailyView, ...saved.dailyView }
        s.soundPresets = Array.isArray(saved.soundPresets) ? saved.soundPresets : []
        s.playerTools = Array.isArray(saved.playerTools) ? cleanTools(saved.playerTools) : [...DEFAULT_PLAYER_TOOLS]
        // Была тема «AMOLED» — теперь это тёмная тема с чёрным фоном
        if ((saved.theme as string) === 'amoled') {
          s.theme = 'dark'
          if (!saved.backdrop) s.backdrop = 'black'
        }
        // Настройки свайпа влево больше нет
        delete (s as unknown as Record<string, unknown>).swipeLeft
      } catch {
        /* повреждённые настройки: остаются значения по умолчанию */
      }
    }
    loaded = true
  }

  async function save() {
    const value = JSON.stringify(s)
    await db
      .insertInto('settings')
      .values({ key: KEY, value })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value }))
      .execute()
  }

  let dirty = false
  watch(
    s,
    () => {
      if (!loaded) return
      dirty = true
      clearTimeout(timer)
      timer = setTimeout(() => {
        dirty = false
        void save()
      }, 400)
    },
    { deep: true },
  )
  // Приложение уходит в фон (его могут выгрузить): несохранённое пишем сразу, не дожидаясь паузы
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || !dirty) return
      clearTimeout(timer)
      dirty = false
      void save()
    })
  }

  function sortFor(screen: string, fallback: SortPref): SortPref {
    return s.sorts[screen] ?? fallback
  }

  function setSort(screen: string, pref: SortPref) {
    s.sorts[screen] = pref
  }

  return { s, load, save, sortFor, setSort }
})
