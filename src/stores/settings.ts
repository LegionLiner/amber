import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'
import { db } from '@/data/db'
import { DEFAULT_COUNTING } from '@/domain/counting'
import type { AudioSettings, CountingRule } from '@/native/types'
import type { ShuffleKind } from '@/domain/shuffle'

export type ThemeMode = 'dark' | 'light' | 'amoled' | 'system'
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
  glass: 'full' | 'low'
  motion: 'full' | 'reduced'
  counting: CountingRule
  scan: {
    minDurationMs: number
    excludeFolders: string[]
    lastScanAt: number | null
  }
  /** Если у трека нет тега альбома, считать альбомом папку */
  albumFromFolder: boolean
  /** Сортировка для каждого экрана отдельно */
  sorts: Record<string, SortPref>
  /** Что делает свайп влево по треку */
  swipeLeft: 'favorite' | 'queue'
  /** После скольких прослушиваний без оценки попросить оценить (0 = не просить) */
  askRatingAfterPlays: number
  recentSearches: string[]
  audio: AudioSettings
  backup: BackupSettings
  shuffleKind: ShuffleKind
  radio: RadioDials
  /** Правки тегов записывать в сами файлы (если нельзя — остаются в приложении) */
  writeTagsToFiles: boolean
  /** Показывать текст песни в плеере, если он есть */
  showLyrics: boolean
}

export const EQ_PRESETS: Record<string, { label: string; bands: number[]; preampDb: number }> = {
  flat: { label: 'Ровно', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preampDb: 0 },
  bass: { label: 'Бас', bands: [5, 4, 3, 1.5, 0, 0, 0, 0, 0, 0], preampDb: -4 },
  vocal: { label: 'Голос', bands: [-2, -1.5, -1, 0, 1.5, 3, 3, 2, 0, -1], preampDb: -3 },
  night: { label: 'Ночь', bands: [2, 1.5, 1, 0, 0, 0, -1, -2, -3, -4], preampDb: -2 },
  bright: { label: 'Ярко', bands: [0, 0, 0, 0, 0, 0.5, 1.5, 3, 4, 4], preampDb: -4 },
  loudness: { label: 'Громкость', bands: [4, 3, 1, 0, -1, -1, 0, 1, 3, 4], preampDb: -4 },
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
  },
  albumFromFolder: true,
  sorts: {},
  swipeLeft: 'favorite',
  askRatingAfterPlays: 5,
  recentSearches: [],
  audio: DEFAULT_AUDIO,
  backup: { enabled: false, folderUri: null, keep: 14, lastAt: null },
  shuffleKind: 'smart',
  radio: { adventure: 0.35, freshness: 0.4 },
  writeTagsToFiles: true,
  showLyrics: true,
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

  watch(
    s,
    () => {
      if (!loaded) return
      clearTimeout(timer)
      timer = setTimeout(() => void save(), 400)
    },
    { deep: true },
  )

  function sortFor(screen: string, fallback: SortPref): SortPref {
    return s.sorts[screen] ?? fallback
  }

  function setSort(screen: string, pref: SortPref) {
    s.sorts[screen] = pref
  }

  return { s, load, save, sortFor, setSort }
})
