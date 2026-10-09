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
import SpotifySection from './SpotifySection.vue'
import { useSync } from '@/stores/sync'
import { APP_VERSION } from '@/app/version'
import { voice } from '@/app/voice'

const settings = useSettings()
const library = useLibrary()
const ui = useUi()
const router = useRouter()
const s = settings.s

const THEMES: { id: ThemeMode; label: string }[] = [
  { id: 'dark', label: 'Тёмная' },
  { id: 'light', label: 'Светлая' },
  { id: 'amoled', label: 'AMOLED' },
  { id: 'system', label: 'Как в системе' },
]

/* ---------------- правило прослушивания ---------------- */

const RULES: { id: string; label: string; hint: string; rule: CountingRule }[] = [
  { id: 'lastfm', label: 'Половина или 4 минуты', hint: 'Как у Last.fm', rule: DEFAULT_COUNTING },
  {
    id: 'short',
    label: 'От 30 секунд',
    hint: 'Засчитывается почти любое',
    rule: { minTrackMs: 30_000, minFraction: 0, minListenMs: 30_000 },
  },
  {
    id: 'full',
    label: 'Почти до конца',
    hint: 'Нужно дослушать 90%',
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
  ui.toast('История пересчитана по новому правилу')
}

const secs = (ms: number) =>
  ms >= 60_000 ? `${Math.floor(ms / 60_000)} мин${ms % 60_000 ? ` ${(ms % 60_000) / 1000} с` : ''}` : `${ms / 1000} с`

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
  if (r) ui.toast(`Готово: ${r.total} треков, новых ${r.added}`)
}

async function unhide() {
  const n = await unhideAll()
  await library.load()
  ui.toast(n ? `Вернулось в библиотеку: ${n}` : 'Скрытых треков нет')
}

/* ---------------- своя папка в браузере ---------------- */

const web = ref<WebFolderInfo | null>(null)
async function loadWeb() {
  if (!isNative) web.value = await MusicCoreWeb.folderInfo()
}
async function pickWebFolder() {
  try {
    const r = await MusicCoreWeb.pickFolder()
    ui.toast(`Нашлось файлов: ${r.count}. Читаю теги…`)
    await rescan(true)
  } catch (e) {
    if (!/abort|cancel/i.test(String(e))) ui.toast(`Не получилось: ${e instanceof Error ? e.message : String(e)}`)
  }
  await loadWeb()
}
async function restoreWebFolder() {
  const r = await MusicCoreWeb.restoreFolder()
  if (r.count) await rescan(false)
  else ui.toast('Браузер не дал доступ к папке')
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
    if (!/cancel/i.test(String(e))) ui.toast(`Не получилось: ${e instanceof Error ? e.message : String(e)}`)
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
    if (res.uri) ui.toast('Бэкап сохранён')
  } catch (e) {
    ui.toast(`Не получилось: ${e instanceof Error ? e.message : String(e)}`)
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
      `Загружено: ${report.plays} прослушиваний, ${report.userRows} треков с данными. Не найдено файлов: ${report.unmatched}`,
      undefined,
      6000,
    )
    await MusicCore.reloadLoudness()
    setTimeout(() => location.reload(), 1500)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/cancel|отмен/i.test(msg)) ui.toast(`Импорт не удался: ${msg}`)
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
    if (uri) ui.toast('Первая копия сохранена. Дальше — раз в день при запуске')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/cancel|отмен/i.test(msg)) ui.toast(`Не получилось: ${msg}`)
  }
}
async function backupNow() {
  busy.value = true
  try {
    await runAutoBackup(true)
    ui.toast('Копия сохранена')
  } catch (e) {
    ui.toast(`Не получилось: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="scroll screen form">
    <ScreenHeader title="Настройки" back />
    <DamagedFilesCard />

    <!-- .groups: на широком окне компьютера разделы расходятся по двум колонкам (design/desktop.css) -->
    <div class="groups">
      <section class="group">
        <h2 class="gtitle">Внешний вид</h2>
        <div class="seg">
          <button v-for="t in THEMES" :key="t.id" type="button" :class="{ on: s.theme === t.id }" @click="s.theme = t.id">
            {{ t.label }}
          </button>
        </div>
        <label class="row">
          <span
            ><b>Стекло</b
            ><small>{{
              isDesktop ? 'Размытие панелей окна, плеера и шторок' : 'Размытие под мини-плеером и навигацией'
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
          <span><b>Анимации</b><small>Живой фон плеера и переходы</small></span>
          <input
            id="opt-motion"
            type="checkbox"
            class="switch"
            :checked="s.motion === 'full'"
            @change="s.motion = s.motion === 'full' ? 'reduced' : 'full'"
          />
        </label>
      </section>

      <section class="group">
        <button type="button" class="row link" @click="router.push('/settings/audio')">
          <span><b>Звук</b><small>Переходы, одинаковая громкость, эквалайзер, профили наушников</small></span>
        </button>
      </section>

      <section class="group">
        <h2 class="gtitle">Что считать прослушиванием</h2>
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
            ><b>Своё правило</b><small>{{ ruleId === 'custom' ? 'Действует сейчас' : 'Задать пороги самому' }}</small></span
          >
          <i class="dot" />
        </button>
        <div v-if="customOpen" class="custom">
          <div class="slider-row">
            <header>
              <span>Доля трека</span><output>{{ Math.round(custom.minFraction * 100) }}%</output>
            </header>
            <RangeSlider v-model="custom.minFraction" :min="0" :max="1" :step="0.05" />
          </div>
          <div class="slider-row">
            <header>
              <span>…или столько времени</span><output>{{ secs(custom.minListenMs) }}</output>
            </header>
            <RangeSlider v-model="custom.minListenMs" :min="10000" :max="600000" :step="10000" />
          </div>
          <div class="slider-row">
            <header>
              <span>Треки короче не считаются</span><output>{{ secs(custom.minTrackMs) }}</output>
            </header>
            <RangeSlider v-model="custom.minTrackMs" :min="0" :max="120000" :step="5000" />
          </div>
          <p class="note">
            Засчитается, когда прослушано {{ Math.round(custom.minFraction * 100) }}% трека или {{ secs(custom.minListenMs) }} —
            что наступит раньше.
          </p>
          <button type="button" class="btn primary block" :disabled="!customDirty" @click="setRule(custom)">
            Применить и пересчитать
          </button>
        </div>
        <p class="note">
          Сырые события хранятся все, поэтому новое правило сразу применяется ко всей истории. Записано событий: {{ events }}.
        </p>
      </section>

      <section class="group">
        <h2 class="gtitle">Перемешивание</h2>
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
        <h2 class="gtitle">Радио</h2>
        <p class="note">
          Бесконечная очередь из твоей музыки по похожести: что слушаешь рядом, исполнители, жанр, темп и энергия.
        </p>
        <div class="slider-row">
          <header>
            <span>Смелость</span
            ><output>{{
              s.radio.adventure < 0.3 ? 'только похожее' : s.radio.adventure < 0.7 ? 'иногда в сторону' : 'неожиданно'
            }}</output>
          </header>
          <RangeSlider v-model="s.radio.adventure" :min="0" :max="1" :step="0.05" />
        </div>
        <div class="slider-row">
          <header>
            <span>Свежесть</span
            ><output>{{ s.radio.freshness < 0.3 ? 'любимое' : s.radio.freshness < 0.7 ? 'поровну' : 'забытое' }}</output>
          </header>
          <RangeSlider v-model="s.radio.freshness" :min="0" :max="1" :step="0.05" />
        </div>
      </section>

      <section class="group">
        <h2 class="gtitle">Библиотека</h2>
        <p class="note">
          {{ countLabel(library.tracks.length, ['трек', 'трека', 'треков'])
          }}<template v-if="library.lastScan">, последнее сканирование {{ library.lastScan.tookMs }} мс</template>.
        </p>
        <template v-if="isDesktop">
          <div class="dfolders">
            <div v-for="p in folders" :key="p" class="dfolder">
              <IconFolder />
              <span class="ellipsis" :title="p">{{ p }}</span>
              <button
                type="button"
                class="icon-btn"
                :aria-label="`Убрать папку ${p}`"
                title="Убрать из библиотеки"
                @click="removeDesktopFolder(p)"
              >
                <IconRemove />
              </button>
            </div>
            <p v-if="!folders.length" class="note">Папок с музыкой пока нет.</p>
          </div>
          <p class="note">Изменения в папках приложение замечает само: новые файлы появятся в медиатеке через пару секунд.</p>
          <div class="btns">
            <button type="button" class="btn primary" @click="addDesktopFolder">Добавить папку</button>
          </div>
        </template>
        <template v-else-if="web">
          <p class="note">
            <template v-if="web.source === 'demo'"
              >Сейчас демо-библиотека. Можно открыть папку со своими mp3 — файлы не покидают компьютер.</template
            >
            <template v-else-if="web.needsAccess"
              >Папка «{{ web.savedName }}» выбрана раньше: браузер просит подтвердить доступ.</template
            >
            <template v-else>Своя папка{{ web.savedName ? ` «${web.savedName}»` : '' }}: {{ web.loaded }} файлов.</template>
          </p>
          <div class="btns">
            <button v-if="web.needsAccess" type="button" class="btn primary" @click="restoreWebFolder">Вернуть доступ</button>
            <button type="button" class="btn" @click="pickWebFolder">
              {{ web.source === 'folder' ? 'Другая папка' : 'Открыть папку' }}
            </button>
            <button v-if="web.source === 'folder'" type="button" class="btn" @click="useDemo">Демо</button>
          </div>
        </template>
        <div class="btns">
          <button type="button" class="btn" :disabled="library.scanning" @click="rescan(false)">Найти новое</button>
          <button type="button" class="btn" :disabled="library.scanning" @click="rescan(true)">Перечитать теги</button>
        </div>
        <label class="row">
          <span><b>Правки тегов — в файлы</b><small>Название, исполнитель и альбом записываются в сам mp3</small></span>
          <input id="opt-write-tags" v-model="s.writeTagsToFiles" type="checkbox" class="switch" />
        </label>
        <button type="button" class="row link" @click="router.push('/settings/cleanup')">
          <span><b>Уборка тегов</b><small>Мусор сайтов, капслок, номера в названиях, пустые теги</small></span>
        </button>
        <button type="button" class="row link" @click="router.push('/settings/duplicates')">
          <span><b>Дубли</b><small>Один трек в нескольких файлах</small></span>
        </button>
        <label class="row">
          <span
            ><b>Тексты песен из LRCLIB</b
            ><small>Если в файле текста нет, он подставится из открытой базы lrclib.net (нужна сеть)</small></span
          >
          <input id="opt-lrclib" v-model="s.lrclib" type="checkbox" class="switch" />
        </label>
        <label class="row">
          <span><b>Папка вместо альбома</b><small>Если у трека пустой тег альбома</small></span>
          <input id="opt-album-folder" v-model="s.albumFromFolder" type="checkbox" class="switch" @change="library.load()" />
        </label>
        <label class="row">
          <span><b>Короче, чем</b><small>Такие файлы не попадут в библиотеку</small></span>
          <select id="opt-min-dur" v-model.number="s.scan.minDurationMs" class="select">
            <option :value="0">без ограничений</option>
            <option :value="15000">15 секунд</option>
            <option :value="30000">30 секунд</option>
            <option :value="60000">1 минута</option>
          </select>
        </label>
        <div class="folders">
          <b>Не сканировать папки</b>
          <div v-for="p in s.scan.excludeFolders" :key="p" class="folder">
            <span class="ellipsis">{{ p }}</span>
            <button type="button" class="x" aria-label="Убрать" @click="removeFolder(p)">×</button>
          </div>
          <div class="add">
            <input
              id="opt-exclude"
              v-model="newFolder"
              class="field"
              placeholder="Например, Podcasts/"
              @keydown.enter="addFolder"
            />
            <button type="button" class="btn" @click="addFolder">Добавить</button>
          </div>
        </div>
        <button type="button" class="btn block" @click="unhide">Вернуть скрытые треки</button>
      </section>

      <section class="group">
        <h2 class="gtitle">Оценки</h2>
        <label class="row">
          <span><b>Просить оценить</b><small>Когда трек без оценки прозвучал столько раз</small></span>
          <select id="opt-ask" v-model.number="s.askRatingAfterPlays" class="select">
            <option :value="0">не просить</option>
            <option :value="3">3 раза</option>
            <option :value="5">5 раз</option>
            <option :value="10">10 раз</option>
          </select>
        </label>
      </section>

      <SpotifySection />

      <SyncSection />

      <section class="group">
        <h2 class="gtitle">Данные</h2>
        <p class="note">
          {{ sync.signedIn ? 'Данные синхронизируются с сервером, а копия' : 'Все оценки, история и настройки живут только' }} на
          этом {{ isDesktop ? 'компьютере' : 'телефоне' }}. Бэкап — один JSON со всем сразу{{
            isDesktop ? ': так же можно перенести историю с телефона' : ''
          }}.
        </p>
        <button type="button" class="btn primary block" :disabled="busy" @click="exportData">Экспорт в JSON</button>
        <div class="seg">
          <button type="button" :class="{ on: importMode === 'merge' }" @click="importMode = 'merge'">Объединить</button>
          <button type="button" :class="{ on: importMode === 'replace' }" @click="importMode = 'replace'">Заменить всё</button>
        </div>
        <button type="button" class="btn block" :disabled="busy" @click="importData">Импорт из JSON</button>
        <p class="note">Перед импортом приложение само сохраняет снимок текущих данных.</p>

        <label class="row">
          <span>
            <b>Автобэкап раз в день</b>
            <small v-if="s.backup.folderUri && (isNative || isDesktop)"
              >Последний: {{ s.backup.lastAt ? formatDate(s.backup.lastAt) : 'ещё не было' }}, хранится {{ s.backup.keep }}</small
            >
            <small v-else-if="!isNative && !isDesktop">В браузере копия скачивается файлом при первом открытии за день</small>
            <small v-else>Выбери папку, например в «Документах» или синхронизируемую с облаком</small>
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
            <span><b>Сколько копий хранить</b></span>
            <select id="opt-keep" v-model.number="s.backup.keep" class="select">
              <option :value="7">7</option>
              <option :value="14">14</option>
              <option :value="30">30</option>
              <option :value="90">90</option>
            </select>
          </label>
          <div class="btns">
            <button v-if="isNative || isDesktop" type="button" class="btn" @click="chooseBackupFolder">Другая папка</button>
            <button type="button" class="btn" :disabled="busy" @click="backupNow">Сделать сейчас</button>
          </div>
        </template>
      </section>

      <section v-if="isDesktop" class="group">
        <h2 class="gtitle">Окно</h2>
        <label class="row">
          <span
            ><b>Крестик сворачивает в трей</b
            ><small>Музыка играет дальше, значок Amber — рядом с часами. Выйти — из его меню или Ctrl+Q</small></span
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
            ><b>Подсветка в такт музыке</b
            ><small>Фон в цветах обложки и свечение снизу дышат по басам. Выключи, если отвлекает</small></span
          >
          <input id="opt-pulse" v-model="s.desktopPulse" type="checkbox" class="switch" />
        </label>
        <label class="row">
          <span
            ><b>Голосовые команды</b
            ><small
              >«Эмбер, стоп», «Эмбер, продолжи», «Эмбер, следующий», «Эмбер, назад», «Эмбер, тише», «Эмбер, громче», «Эмбер,
              лайк». Можно и отдельно: «Эмбер» — музыка притихнет — «следующий». Распознаётся на компьютере, без интернета; в
              первый раз скачается модель речи (45 МБ)</small
            ></span
          >
          <input id="opt-voice" v-model="s.voice" type="checkbox" class="switch" />
        </label>
        <p v-if="s.voice" class="note voice-state" :class="voice.state">
          <template v-if="voice.state === 'loading'"
            >{{ voice.stage
            }}<template v-if="voice.progress != null"> · {{ Math.round(voice.progress * 100) }}%</template>…</template
          >
          <template v-else-if="voice.state === 'listening'"
            >Слушаю<template v-if="voice.last">. Последняя команда: {{ voice.last }}</template></template
          >
          <template v-else-if="voice.state === 'error'">{{ voice.error }}</template>
        </p>
        <p class="note">
          Клавиши: пробел — пауза, Ctrl+→ и Ctrl+← — следующий и предыдущий, Shift+→ и Shift+← — перемотка на 10 секунд, Ctrl+↑ и
          Ctrl+↓ — громкость, Ctrl+F — поиск, Ctrl+L — в избранное, Esc — закрыть шторку или плеер. Клавиши мультимедиа на
          клавиатуре и наушниках тоже работают.
        </p>
      </section>

      <section v-if="isNative" class="group">
        <h2 class="gtitle">Работа в фоне</h2>
        <p class="note">
          Некоторые оболочки останавливают фоновые приложения. Если музыка обрывается при выключенном экране, разреши Amber
          работать без ограничений.
        </p>
        <button type="button" class="btn block" @click="MusicCore.openBatterySettings()">Настройки батареи</button>
      </section>
    </div>

    <p class="about muted">
      Amber {{ APP_VERSION }} ·
      {{ sync.signedIn ? `синхронизация: ${sync.email}` : 'работает без сети, синхронизация — по желанию' }}
    </p>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
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
