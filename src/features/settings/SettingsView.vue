<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { useRouter } from 'vue-router'
import ScreenHeader from '@/components/ScreenHeader.vue'
import RangeSlider from '@/components/RangeSlider.vue'
import DamagedFilesCard from '@/components/DamagedFilesCard.vue'
import { useSettings, type ThemeMode } from '@/stores/settings'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { MusicCore, MusicCoreWeb, type WebFolderInfo } from '@/native/music-core'
import { isNative } from '@/native/paths'
import { desktop, isDesktop } from '@/native/desktop/bridge'
import IconFolder from '~icons/solar/folder-with-files-linear'
import IconRemove from '~icons/solar/trash-bin-minimalistic-linear'
import { recountAll, unhideAll } from '@/data/repos/library'
import { totalEvents } from '@/data/repos/stats'
import { backupFileName, buildBackup, importBackup, parseBackup } from '@/data/backup'
import { runAutoBackup } from '@/app/auto-backup'
import { DEFAULT_COUNTING } from '@/domain/counting'
import { SHUFFLE_KINDS } from '@/domain/shuffle'
import { countLabel, formatDate } from '@/domain/format'
import type { CountingRule } from '@/native/types'
import SyncSection from './SyncSection.vue'
import FileSyncSection from './FileSyncSection.vue'
import SpotifySection from './SpotifySection.vue'
import { useSync } from '@/stores/sync'
import { APP_VERSION } from '@/app/version'
import { listMics, voice } from '@/app/voice'
import { ACCENTS, accentOf, BACKDROPS, baseOf, type Shade } from '@/domain/themes'
import PlayerToolsEditor from './PlayerToolsEditor.vue'
import { $t, $tp, isEn, lang, setLang, type Lang } from '@/i18n'

const settings = useSettings()
const library = useLibrary()
const ui = useUi()
const router = useRouter()
const s = settings.s

/* Микрофон для голосовых команд (компьютер): список обновляется при открытии выбора и при подключении устройств */
const mics = ref<{ id: string; label: string }[]>([])
async function refreshMics() {
  if (isDesktop) mics.value = await listMics()
}
function pickMic(e: Event) {
  const id = (e.target as HTMLSelectElement).value
  const m = mics.value.find((x) => x.id === id)
  s.voiceMic = id && m ? { id, label: m.label } : null
}
if (isDesktop) {
  void refreshMics()
  navigator.mediaDevices?.addEventListener('devicechange', () => void refreshMics())
}

/** Названия языков — каждое на своём языке, чтобы найти нужный, не понимая текущий */
const LANGS: { id: Lang; label: string }[] = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
]
const THEMES: { id: ThemeMode; label: string }[] = [
  { id: 'dark', label: $t('Тёмная') },
  { id: 'light', label: $t('Светлая') },
  { id: 'system', label: $t('Как в системе') },
]

/* ---------------- акцент и фон: превью — в той теме, что сейчас на экране ---------------- */
const systemLight = window.matchMedia('(prefers-color-scheme: light)').matches
const shade = computed<Shade>(() => (s.theme === 'light' || (s.theme === 'system' && systemLight) ? 'light' : 'dark'))
const backdrops = computed(() =>
  BACKDROPS.map((b) => ({
    ...b,
    off: shade.value === 'light' && !b.light,
    base: baseOf(shade.value, b.id, s.accent),
  })),
)
// Светлая тема без чёрного фона: выбранный «Чёрный» там показывается тёплым
const backdropShown = computed(() => (shade.value === 'light' && s.backdrop === 'black' ? 'warm' : s.backdrop))

/* ---------------- правило прослушивания ---------------- */

const RULES: { id: string; label: string; hint: string; rule: CountingRule }[] = [
  { id: 'lastfm', label: $t('Половина или 4 минуты'), hint: $t('Как у Last.fm'), rule: DEFAULT_COUNTING },
  {
    id: 'short',
    label: $t('От 30 секунд'),
    hint: $t('Засчитывается почти любое'),
    rule: { minTrackMs: 30_000, minFraction: 0, minListenMs: 30_000 },
  },
  {
    id: 'full',
    label: $t('Почти до конца'),
    hint: $t('Нужно дослушать 90%'),
    rule: { minTrackMs: 30_000, minFraction: 0.9, minListenMs: 3_600_000 },
  },
]
const ruleId = computed(() => {
  const c = s.counting
  return (
    RULES.find(
      (r) => r.rule.minFraction === c.minFraction && r.rule.minListenMs === c.minListenMs && r.rule.minTrackMs === c.minTrackMs,
    )?.id ?? 'custom'
  )
})
const custom = ref({ ...s.counting })
const customOpen = ref(ruleId.value === 'custom')
const customDirty = computed(
  () =>
    custom.value.minFraction !== s.counting.minFraction ||
    custom.value.minListenMs !== s.counting.minListenMs ||
    custom.value.minTrackMs !== s.counting.minTrackMs,
)

async function setRule(rule: CountingRule) {
  s.counting = { ...rule }
  custom.value = { ...rule }
  await recountAll(rule)
  await library.load()
  ui.toast($t('История пересчитана по новому правилу'))
}

const secs = (ms: number) =>
  ms >= 60_000
    ? $t('{0} мин{1}', Math.floor(ms / 60_000), ms % 60_000 ? $t(' {0} с', (ms % 60_000) / 1000) : '')
    : $t('{0} с', ms / 1000)

/* ---------------- библиотека ---------------- */

const newFolder = ref('')
function addFolder() {
  const v = newFolder.value.trim().replace(/^\/+/, '')
  if (!v) return
  const path = v.endsWith('/') ? v : `${v}/`
  if (!s.scan.excludeFolders.includes(path)) s.scan.excludeFolders.push(path)
  newFolder.value = ''
}
function removeFolder(p: string) {
  s.scan.excludeFolders = s.scan.excludeFolders.filter((x) => x !== p)
}

async function rescan(full: boolean) {
  const r = await library.scan(full)
  if (r) ui.toast($t('Готово: {0} треков, новых {1}', r.total, r.added))
}

async function unhide() {
  const n = await unhideAll()
  await library.load()
  ui.toast(n ? $t('Вернулось в библиотеку: {0}', n) : $t('Скрытых треков нет'))
}

/* ---------------- своя папка в браузере ---------------- */

const web = ref<WebFolderInfo | null>(null)
async function loadWeb() {
  if (!isNative) web.value = await MusicCoreWeb.folderInfo()
}
async function pickWebFolder() {
  try {
    const r = await MusicCoreWeb.pickFolder()
    ui.toast($t('Нашлось файлов: {0}. Читаю теги…', r.count))
    await rescan(true)
  } catch (e) {
    if (!/abort|cancel/i.test(String(e))) ui.toast($t('Не получилось: {0}', e instanceof Error ? e.message : String(e)))
  }
  await loadWeb()
}
async function restoreWebFolder() {
  const r = await MusicCoreWeb.restoreFolder()
  if (r.count) await rescan(false)
  else ui.toast($t('Браузер не дал доступ к папке'))
  await loadWeb()
}
async function useDemo() {
  await MusicCoreWeb.useDemo()
  await rescan(false)
  await loadWeb()
}

/* ---------------- папки на компьютере ---------------- */

const sync = useSync()
const folders = computed(() => web.value?.folders ?? [])
async function addDesktopFolder() {
  try {
    await MusicCoreWeb.pickFolder()
    await loadWeb()
    await rescan(false)
  } catch (e) {
    if (!/cancel/i.test(String(e))) ui.toast($t('Не получилось: {0}', e instanceof Error ? e.message : String(e)))
  }
}
async function removeDesktopFolder(p: string) {
  await MusicCoreWeb.removeFolder({ path: p })
  await loadWeb()
  // Треки из убранной папки станут «пропавшими»: история и оценки остаются, вернутся с папкой
  await rescan(false)
}

/** Крестик окна: спрятать в трей (музыка играет) или выйти */
const closeToTray = ref(true)
if (desktop) void desktop.info().then((i) => (closeToTray.value = i.closeToTray))
function setCloseToTray(v: boolean) {
  closeToTray.value = v
  void desktop?.setCloseToTray(v)
}

/* ---------------- данные ---------------- */

const events = ref(0)
onActivated(async () => {
  events.value = await totalEvents()
  await loadWeb()
})

const busy = ref(false)
async function exportData() {
  busy.value = true
  try {
    const data = await buildBackup()
    const res = await MusicCore.exportFile({ name: backupFileName(), data: JSON.stringify(data) })
    if (res.uri) ui.toast($t('Бэкап сохранён'))
  } catch (e) {
    ui.toast($t('Не получилось: {0}', e instanceof Error ? e.message : String(e)))
  } finally {
    busy.value = false
  }
}

const importMode = ref<'merge' | 'replace'>('merge')
async function importData() {
  busy.value = true
  try {
    const file = await MusicCore.importFile()
    const data = parseBackup(file.data)
    const report = await importBackup(data, importMode.value)
    ui.toast(
      $t(
        'Загружено: {0} прослушиваний, {1} треков с данными. Не найдено файлов: {2}',
        report.plays,
        report.userRows,
        report.unmatched,
      ),
      undefined,
      6000,
    )
    await MusicCore.reloadLoudness()
    setTimeout(() => location.reload(), 1500)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/cancel|отмен/i.test(msg)) ui.toast($t('Импорт не удался: {0}', msg))
  } finally {
    busy.value = false
  }
}

async function chooseBackupFolder() {
  try {
    const r = await MusicCore.chooseBackupFolder()
    s.backup.folderUri = r.uri
    s.backup.enabled = true
    const uri = await runAutoBackup(true)
    if (uri) ui.toast($t('Первая копия сохранена. Дальше — раз в день при запуске'))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/cancel|отмен/i.test(msg)) ui.toast($t('Не получилось: {0}', msg))
  }
}
async function backupNow() {
  busy.value = true
  try {
    await runAutoBackup(true)
    ui.toast($t('Копия сохранена'))
  } catch (e) {
    ui.toast($t('Не получилось: {0}', e instanceof Error ? e.message : String(e)))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="scroll screen form">
    <ScreenHeader :title="$t('Настройки')" back />
    <DamagedFilesCard />

    <!-- .groups: на широком окне компьютера разделы расходятся по двум колонкам (design/desktop.css) -->
    <div class="groups">
      <section class="group">
        <h2 class="gtitle">{{ $t('Внешний вид') }}</h2>
        <div class="pick-title">
          <b>Язык · Language</b><small v-if="isDesktop && isEn">{{ $t('Голосовые команды — только на русском') }}</small>
        </div>
        <div class="seg lang-seg" role="radiogroup" aria-label="Язык · Language">
          <button
            v-for="l in LANGS"
            :key="l.id"
            type="button"
            role="radio"
            :aria-checked="lang === l.id"
            :class="{ on: lang === l.id }"
            :lang="l.id"
            @click="l.id !== lang && setLang(l.id)"
          >
            {{ l.label }}
          </button>
        </div>
        <div class="seg three">
          <button v-for="t in THEMES" :key="t.id" type="button" :class="{ on: s.theme === t.id }" @click="s.theme = t.id">
            {{ t.label }}
          </button>
        </div>
        <div class="pick-title">
          <b>{{ $t('Акцент') }}</b
          ><small>{{ accentOf(s.accent).label }}</small>
        </div>
        <div class="accents" role="radiogroup" :aria-label="$t('Акцентный цвет')">
          <button
            v-for="a in ACCENTS"
            :key="a.id"
            type="button"
            role="radio"
            class="acc"
            :class="{ on: s.accent === a.id }"
            :aria-checked="s.accent === a.id"
            :aria-label="a.label"
            :title="a.label"
            :style="{ '--a1': a[shade].amber, '--a2': a[shade].ember }"
            @click="s.accent = a.id"
          />
        </div>
        <div class="pick-title">
          <b>{{ $t('Фон') }}</b
          ><small>{{ backdrops.find((b) => b.id === backdropShown)?.hint }}</small>
        </div>
        <div class="backdrops" role="radiogroup" :aria-label="$t('Фон')">
          <button
            v-for="b in backdrops"
            :key="b.id"
            type="button"
            role="radio"
            class="bd"
            :class="{ on: backdropShown === b.id }"
            :aria-checked="backdropShown === b.id"
            :disabled="b.off"
            :title="b.off ? $t('Только в тёмной теме') : b.hint"
            @click="s.backdrop = b.id"
          >
            <span class="pv" :style="{ background: b.base.bg }">
              <i class="pv-card" :style="{ background: b.base.surface }"
                ><i class="pv-dot" :style="{ background: accentOf(s.accent)[shade].amber }" /><i
                  class="pv-line"
                  :style="{ background: b.base.ink2 }"
              /></i>
            </span>
            <small>{{ b.label }}</small>
          </button>
        </div>
        <label class="row">
          <span
            ><b>{{ $t('Стекло') }}</b
            ><small>{{
              isDesktop ? $t('Размытие панелей окна, плеера и шторок') : $t('Размытие под мини-плеером и навигацией')
            }}</small></span
          >
          <input
            id="opt-glass"
            type="checkbox"
            class="switch"
            :checked="s.glass === 'full'"
            @change="s.glass = s.glass === 'full' ? 'low' : 'full'"
          />
        </label>
        <label class="row">
          <span
            ><b>{{ $t('Анимации') }}</b
            ><small>{{ $t('Живой фон плеера и переходы') }}</small></span
          >
          <input
            id="opt-motion"
            type="checkbox"
            class="switch"
            :checked="s.motion === 'full'"
            @change="s.motion = s.motion === 'full' ? 'reduced' : 'full'"
          />
        </label>
      </section>

      <section v-if="!isDesktop" class="group">
        <h2 class="gtitle">{{ $t('Кнопки плеера') }}</h2>
        <p class="note">
          {{ $t('Быстрые кнопки внизу экрана плеера: какие и в каком порядке. Остальное — в меню «⋯» плеера.') }}
        </p>
        <PlayerToolsEditor />
      </section>

      <section class="group">
        <button type="button" class="row link" @click="router.push('/settings/audio')">
          <span
            ><b>{{ $t('Звук') }}</b
            ><small>{{ $t('Переходы, одинаковая громкость, эквалайзер, профили наушников') }}</small></span
          >
        </button>
      </section>

      <section class="group">
        <h2 class="gtitle">{{ $t('Что считать прослушиванием') }}</h2>
        <button
          v-for="r in RULES"
          :key="r.id"
          type="button"
          class="choice"
          :class="{ on: ruleId === r.id }"
          @click="setRule(r.rule)"
        >
          <span
            ><b>{{ r.label }}</b
            ><small>{{ r.hint }}</small></span
          >
          <i class="dot" />
        </button>
        <button type="button" class="choice" :class="{ on: ruleId === 'custom' }" @click="customOpen = !customOpen">
          <span
            ><b>{{ $t('Своё правило') }}</b
            ><small>{{ ruleId === 'custom' ? $t('Действует сейчас') : $t('Задать пороги самому') }}</small></span
          >
          <i class="dot" />
        </button>
        <div v-if="customOpen" class="custom">
          <div class="slider-row">
            <header>
              <span>{{ $t('Доля трека') }}</span
              ><output>{{ Math.round(custom.minFraction * 100) }}%</output>
            </header>
            <RangeSlider v-model="custom.minFraction" :min="0" :max="1" :step="0.05" />
          </div>
          <div class="slider-row">
            <header>
              <span>{{ $t('…или столько времени') }}</span
              ><output>{{ secs(custom.minListenMs) }}</output>
            </header>
            <RangeSlider v-model="custom.minListenMs" :min="10000" :max="600000" :step="10000" />
          </div>
          <div class="slider-row">
            <header>
              <span>{{ $t('Треки короче не считаются') }}</span
              ><output>{{ secs(custom.minTrackMs) }}</output>
            </header>
            <RangeSlider v-model="custom.minTrackMs" :min="0" :max="120000" :step="5000" />
          </div>
          <p class="note">
            {{
              $t(
                'Засчитается, когда прослушано {0}% трека или {1} — что наступит раньше.',
                Math.round(custom.minFraction * 100),
                secs(custom.minListenMs),
              )
            }}
          </p>
          <button type="button" class="btn primary block" :disabled="!customDirty" @click="setRule(custom)">
            {{ $t('Применить и пересчитать') }}
          </button>
        </div>
        <p class="note">
          {{
            $t(
              'Сырые события хранятся все, поэтому новое правило сразу применяется ко всей истории. Записано событий: {0}.',
              events,
            )
          }}
        </p>
      </section>

      <section class="group">
        <h2 class="gtitle">{{ $t('Перемешивание') }}</h2>
        <button
          v-for="k in SHUFFLE_KINDS"
          :key="k.id"
          type="button"
          class="choice"
          :class="{ on: s.shuffleKind === k.id }"
          @click="s.shuffleKind = k.id"
        >
          <span
            ><b>{{ k.label }}</b
            ><small>{{ k.hint }}</small></span
          >
          <i class="dot" />
        </button>
      </section>

      <section class="group">
        <h2 class="gtitle">{{ $t('Радио') }}</h2>
        <p class="note">
          {{ $t('Бесконечная очередь из твоей музыки по похожести: что слушаешь рядом, исполнители, жанр, темп и энергия.') }}
        </p>
        <div class="slider-row">
          <header>
            <span>{{ $t('Смелость') }}</span
            ><output>{{
              s.radio.adventure < 0.3 ? $t('только похожее') : s.radio.adventure < 0.7 ? $t('иногда в сторону') : $t('неожиданно')
            }}</output>
          </header>
          <RangeSlider v-model="s.radio.adventure" :min="0" :max="1" :step="0.05" />
        </div>
        <div class="slider-row">
          <header>
            <span>{{ $t('Свежесть') }}</span
            ><output>{{
              s.radio.freshness < 0.3 ? $t('любимое') : s.radio.freshness < 0.7 ? $t('поровну') : $t('забытое')
            }}</output>
          </header>
          <RangeSlider v-model="s.radio.freshness" :min="0" :max="1" :step="0.05" />
        </div>
      </section>

      <section class="group">
        <h2 class="gtitle">{{ $t('Библиотека') }}</h2>
        <p class="note">
          {{ countLabel(library.tracks.length, $tp('трек|трека|треков'))
          }}<template v-if="library.lastScan">{{ $t(', последнее сканирование {0} мс', library.lastScan.tookMs) }}</template
          >.
        </p>
        <template v-if="isDesktop">
          <div class="dfolders">
            <div v-for="p in folders" :key="p" class="dfolder">
              <IconFolder />
              <span class="ellipsis" :title="p">{{ p }}</span>
              <button
                type="button"
                class="icon-btn"
                :aria-label="$t('Убрать папку {0}', p)"
                :title="$t('Убрать из библиотеки')"
                @click="removeDesktopFolder(p)"
              >
                <IconRemove />
              </button>
            </div>
            <p v-if="!folders.length" class="note">{{ $t('Папок с музыкой пока нет.') }}</p>
          </div>
          <p class="note">
            {{ $t('Изменения в папках приложение замечает само: новые файлы появятся в медиатеке через пару секунд.') }}
          </p>
          <div class="btns">
            <button type="button" class="btn primary" @click="addDesktopFolder">{{ $t('Добавить папку') }}</button>
          </div>
        </template>
        <template v-else-if="web">
          <p class="note">
            <template v-if="web.source === 'demo'">{{
              $t('Сейчас демо-библиотека. Можно открыть папку со своими mp3 — файлы не покидают компьютер.')
            }}</template>
            <template v-else-if="web.needsAccess">{{
              $t('Папка «{0}» выбрана раньше: браузер просит подтвердить доступ.', web.savedName)
            }}</template>
            <template v-else>{{
              $t('Своя папка{0}: {1} файлов.', web.savedName ? ` «${web.savedName}»` : '', web.loaded)
            }}</template>
          </p>
          <div class="btns">
            <button v-if="web.needsAccess" type="button" class="btn primary" @click="restoreWebFolder">
              {{ $t('Вернуть доступ') }}
            </button>
            <button type="button" class="btn" @click="pickWebFolder">
              {{ web.source === 'folder' ? $t('Другая папка') : $t('Открыть папку') }}
            </button>
            <button v-if="web.source === 'folder'" type="button" class="btn" @click="useDemo">{{ $t('Демо') }}</button>
          </div>
        </template>
        <div class="btns">
          <button type="button" class="btn" :disabled="library.scanning" @click="rescan(false)">{{ $t('Найти новое') }}</button>
          <button type="button" class="btn" :disabled="library.scanning" @click="rescan(true)">
            {{ $t('Перечитать теги') }}
          </button>
        </div>
        <label class="row">
          <span
            ><b>{{ $t('Правки тегов — в файлы') }}</b
            ><small>{{ $t('Название, исполнитель и альбом записываются в сам mp3') }}</small></span
          >
          <input id="opt-write-tags" v-model="s.writeTagsToFiles" type="checkbox" class="switch" />
        </label>
        <button type="button" class="row link" @click="router.push('/settings/cleanup')">
          <span
            ><b>{{ $t('Уборка тегов') }}</b
            ><small>{{ $t('Мусор сайтов, капслок, номера в названиях, пустые теги') }}</small></span
          >
        </button>
        <button type="button" class="row link" @click="router.push('/settings/duplicates')">
          <span
            ><b>{{ $t('Дубли') }}</b
            ><small>{{ $t('Один трек в нескольких файлах') }}</small></span
          >
        </button>
        <label class="row">
          <span
            ><b>{{ $t('Тексты песен из LRCLIB') }}</b
            ><small>{{ $t('Если в файле текста нет, он подставится из открытой базы lrclib.net (нужна сеть)') }}</small></span
          >
          <input id="opt-lrclib" v-model="s.lrclib" type="checkbox" class="switch" />
        </label>
        <label class="row">
          <span
            ><b>{{ $t('Папка вместо альбома') }}</b
            ><small>{{ $t('Если у трека пустой тег альбома') }}</small></span
          >
          <input id="opt-album-folder" v-model="s.albumFromFolder" type="checkbox" class="switch" @change="library.load()" />
        </label>
        <label class="row">
          <span
            ><b>{{ $t('Короче, чем') }}</b
            ><small>{{ $t('Такие файлы не попадут в библиотеку') }}</small></span
          >
          <select id="opt-min-dur" v-model.number="s.scan.minDurationMs" class="select">
            <option :value="0">{{ $t('без ограничений') }}</option>
            <option :value="15000">{{ $t('15 секунд') }}</option>
            <option :value="30000">{{ $t('30 секунд') }}</option>
            <option :value="60000">{{ $t('1 минута') }}</option>
          </select>
        </label>
        <div class="folders">
          <b>{{ $t('Не сканировать папки') }}</b>
          <div v-for="p in s.scan.excludeFolders" :key="p" class="folder">
            <span class="ellipsis">{{ p }}</span>
            <button type="button" class="x" :aria-label="$t('Убрать')" @click="removeFolder(p)">×</button>
          </div>
          <div class="add">
            <input
              id="opt-exclude"
              v-model="newFolder"
              class="field"
              :placeholder="$t('Например, Podcasts/')"
              @keydown.enter="addFolder"
            />
            <button type="button" class="btn" @click="addFolder">{{ $t('Добавить') }}</button>
          </div>
        </div>
        <button type="button" class="btn block" @click="unhide">{{ $t('Вернуть скрытые треки') }}</button>
      </section>

      <section class="group">
        <h2 class="gtitle">{{ $t('Оценки') }}</h2>
        <label class="row">
          <span
            ><b>{{ $t('Просить оценить') }}</b
            ><small>{{ $t('Когда трек без оценки прозвучал столько раз') }}</small></span
          >
          <select id="opt-ask" v-model.number="s.askRatingAfterPlays" class="select">
            <option :value="0">{{ $t('не просить') }}</option>
            <option :value="3">{{ $t('3 раза') }}</option>
            <option :value="5">{{ $t('5 раз') }}</option>
            <option :value="10">{{ $t('10 раз') }}</option>
          </select>
        </label>
      </section>

      <SpotifySection />

      <SyncSection />
      <FileSyncSection v-if="isDesktop || isNative" />

      <section class="group">
        <h2 class="gtitle">{{ $t('Данные') }}</h2>
        <p class="note">
          {{
            $t(
              '{0} на этом {1}. Бэкап — один JSON со всем сразу{2}.',
              sync.signedIn
                ? $t('Данные синхронизируются с сервером, а копия')
                : $t('Все оценки, история и настройки живут только'),
              isDesktop ? $t('компьютере') : $t('телефоне'),
              isDesktop ? $t(': так же можно перенести историю с телефона') : '',
            )
          }}
        </p>
        <button type="button" class="btn primary block" :disabled="busy" @click="exportData">{{ $t('Экспорт в JSON') }}</button>
        <div class="seg">
          <button type="button" :class="{ on: importMode === 'merge' }" @click="importMode = 'merge'">
            {{ $t('Объединить') }}
          </button>
          <button type="button" :class="{ on: importMode === 'replace' }" @click="importMode = 'replace'">
            {{ $t('Заменить всё') }}
          </button>
        </div>
        <button type="button" class="btn block" :disabled="busy" @click="importData">{{ $t('Импорт из JSON') }}</button>
        <p class="note">{{ $t('Перед импортом приложение само сохраняет снимок текущих данных.') }}</p>

        <label class="row">
          <span>
            <b>{{ $t('Автобэкап раз в день') }}</b>
            <small v-if="s.backup.folderUri && (isNative || isDesktop)">{{
              $t('Последний: {0}, хранится {1}', s.backup.lastAt ? formatDate(s.backup.lastAt) : $t('ещё не было'), s.backup.keep)
            }}</small>
            <small v-else-if="!isNative && !isDesktop">{{
              $t('В браузере копия скачивается файлом при первом открытии за день')
            }}</small>
            <small v-else>{{ $t('Выбери папку, например в «Документах» или синхронизируемую с облаком') }}</small>
          </span>
          <input
            id="opt-backup"
            type="checkbox"
            class="switch"
            :checked="s.backup.enabled && !!s.backup.folderUri"
            @change="s.backup.enabled && s.backup.folderUri ? (s.backup.enabled = false) : chooseBackupFolder()"
          />
        </label>
        <template v-if="s.backup.enabled && s.backup.folderUri">
          <label class="row">
            <span
              ><b>{{ $t('Сколько копий хранить') }}</b></span
            >
            <select id="opt-keep" v-model.number="s.backup.keep" class="select">
              <option :value="7">7</option>
              <option :value="14">14</option>
              <option :value="30">30</option>
              <option :value="90">90</option>
            </select>
          </label>
          <div class="btns">
            <button v-if="isNative || isDesktop" type="button" class="btn" @click="chooseBackupFolder">
              {{ $t('Другая папка') }}
            </button>
            <button type="button" class="btn" :disabled="busy" @click="backupNow">{{ $t('Сделать сейчас') }}</button>
          </div>
        </template>
      </section>

      <section v-if="isDesktop" class="group">
        <h2 class="gtitle">{{ $t('Окно') }}</h2>
        <label class="row">
          <span
            ><b>{{ $t('Крестик сворачивает в трей') }}</b
            ><small>{{ $t('Музыка играет дальше, значок Amber — рядом с часами. Выйти — из его меню или Ctrl+Q') }}</small></span
          >
          <input
            id="opt-tray"
            type="checkbox"
            class="switch"
            :checked="closeToTray"
            @change="setCloseToTray(($event.target as HTMLInputElement).checked)"
          />
        </label>
        <label class="row">
          <span
            ><b>{{ $t('Подсветка в такт музыке') }}</b
            ><small>{{ $t('Фон в цветах обложки и свечение снизу дышат по басам. Выключи, если отвлекает') }}</small></span
          >
          <input id="opt-pulse" v-model="s.desktopPulse" type="checkbox" class="switch" />
        </label>
        <label class="row">
          <span
            ><b>{{ $t('Голосовые команды') }}</b
            ><small>{{
              $t(
                '«Эмбер, стоп», «Эмбер, продолжи», «Эмбер, следующий», «Эмбер, назад», «Эмбер, тише», «Эмбер, громче», «Эмбер, лайк». Можно и отдельно: «Эмбер» — музыка притихнет — «следующий». Распознаётся на компьютере, без интернета; в первый раз скачается модель речи (45 МБ)',
              )
            }}</small></span
          >
          <input id="opt-voice" v-model="s.voice" type="checkbox" class="switch" />
        </label>
        <p v-if="s.voice" class="note voice-state" :class="voice.state">
          <template v-if="voice.state === 'loading'"
            >{{ voice.stage
            }}<template v-if="voice.progress != null"> · {{ Math.round(voice.progress * 100) }}%</template>…</template
          >
          <template v-else-if="voice.state === 'listening'"
            >{{ $t('Слушаю') }}<template v-if="voice.mic"> {{ $t('через «{0}»', voice.mic) }}</template
            ><template v-if="voice.micMissing">
              {{ $t('— выбранный микрофон не подключён, перейду на него, когда появится') }}</template
            ><template v-if="voice.last">{{ $t('. Последняя команда: {0}', voice.last) }}</template></template
          >
          <template v-else-if="voice.state === 'error'">{{ voice.error }}</template>
        </p>
        <label v-if="s.voice" class="row">
          <span
            ><b>{{ $t('Микрофон для команд') }}</b
            ><small>{{
              $t('Например, всегда наушники — даже если подключён другой микрофон. Музыка играет туда же, куда и раньше')
            }}</small></span
          >
          <select id="opt-voice-mic" class="select" :value="s.voiceMic?.id ?? ''" @focus="refreshMics" @change="pickMic">
            <option value="">{{ $t('Основной в Windows') }}</option>
            <option v-for="m in mics" :key="m.id" :value="m.id">{{ m.label }}</option>
            <option v-if="s.voiceMic && !mics.some((m) => m.id === s.voiceMic!.id)" :value="s.voiceMic.id">
              {{ $t('{0} (не подключён)', s.voiceMic.label) }}
            </option>
          </select>
        </label>
        <p class="note">
          {{
            $t(
              'Клавиши: пробел — пауза, Ctrl+→ и Ctrl+← — следующий и предыдущий, Shift+→ и Shift+← — перемотка на 10 секунд, Ctrl+↑ и Ctrl+↓ — громкость, Ctrl+F — поиск, Ctrl+L — в избранное, Esc — закрыть шторку или плеер, F11 — «Сцена» (только обложка на весь экран). Клавиши мультимедиа на клавиатуре и наушниках тоже работают.',
            )
          }}
        </p>
      </section>

      <section v-if="isNative" class="group">
        <h2 class="gtitle">{{ $t('Работа в фоне') }}</h2>
        <p class="note">
          {{
            $t(
              'Некоторые оболочки останавливают фоновые приложения. Если музыка обрывается при выключенном экране, разреши Amber работать без ограничений.',
            )
          }}
        </p>
        <button type="button" class="btn block" @click="MusicCore.openBatterySettings()">{{ $t('Настройки батареи') }}</button>
      </section>
    </div>

    <p class="about muted">
      Amber {{ APP_VERSION }} ·
      {{ sync.signedIn ? $t('синхронизация: {0}', sync.email) : $t('работает без сети, синхронизация — по желанию') }}
    </p>
    <!-- Нужна для Google Play: ссылка на политику и в самом приложении. Откроется в браузере -->
    <p class="about">
      <a href="https://amber.legionliner.ru/privacy/" target="_blank" rel="noopener" class="privacy">{{
        $t('Политика конфиденциальности')
      }}</a>
    </p>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.privacy {
  color: var(--amber-ink);
  text-decoration: underline;
  text-underline-offset: 3px;
}
/* ---- акцент и фон ---- */
.lang-seg {
  margin-bottom: 10px;
}
.pick-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
}
.pick-title b {
  font: 600 15px/1.2 var(--f-body);
}
.pick-title small {
  font-size: 12.5px;
  color: var(--ink-2);
}
.accents {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.acc {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--a1), var(--a2));
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  transition: transform var(--t-fast) var(--ease);
}
.acc.on {
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 4px var(--a1);
}
.acc:active {
  transform: scale(0.92);
}
.backdrops {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
.bd {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.bd small {
  max-width: 100%;
  font-size: 11.5px;
  color: var(--ink-2);
  text-align: center;
  line-height: 1.2;
}
.bd.on small {
  color: var(--ink);
  font-weight: 600;
}
.bd:disabled {
  opacity: 0.35;
}
.pv {
  position: relative;
  width: 100%;
  aspect-ratio: 0.8;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  overflow: hidden;
}
.bd.on .pv {
  box-shadow: 0 0 0 2px var(--amber);
}
.pv-card {
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: 18%;
  height: 36%;
  border-radius: 7px;
}
.pv-dot {
  position: absolute;
  left: 18%;
  top: 22%;
  width: 22%;
  aspect-ratio: 1;
  border-radius: 50%;
}
.pv-line {
  position: absolute;
  left: 48%;
  right: 16%;
  top: 36%;
  height: 12%;
  border-radius: 3px;
  opacity: 0.6;
}

.voice-state.listening {
  color: var(--amber-ink);
}
.voice-state.error {
  color: var(--bad);
}
.dfolders {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dfolder {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 4px 4px 4px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  font-size: 13.5px;
}
.dfolder > svg {
  width: 20px;
  height: 20px;
  color: var(--amber-ink);
}
.custom {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 6px;
}
.folders {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
}
.folders b {
  font-weight: 500;
  margin-bottom: 2px;
}
.folder {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  font-size: 13.5px;
}
.x {
  width: 28px;
  height: 28px;
  font-size: 20px;
  color: var(--ink-2);
}
.add {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.add .field {
  flex: 1;
  width: auto;
  min-width: 0;
}
.add .btn {
  flex: none;
}
.folder .ellipsis {
  min-width: 0;
}
.folder .x {
  flex: none;
}
.about {
  text-align: center;
  font-size: 12.5px;
  padding: 20px 0 0;
}
</style>
