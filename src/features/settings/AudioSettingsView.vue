<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ScreenHeader from '@/components/ScreenHeader.vue'
import RangeSlider from '@/components/RangeSlider.vue'
import { useSettings, EQ_PRESETS } from '@/stores/settings'
import { usePlayer } from '@/stores/player'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { MusicCore } from '@/native/music-core'
import { haptic } from '@/native/haptics'
import { outputLabel } from '@/domain/outputs'
import { touchStoppedScroll } from '@/composables/tapGuard'
import type { CrossfadeSettings, EqSettings, NormalizationSettings } from '@/native/types'
import { $t } from '@/i18n'

/**
 * Звук: переходы между треками, выравнивание громкости и эквалайзер.
 * Всё применяется сразу, движок получает настройки при каждом изменении.
 */
const settings = useSettings()
const player = usePlayer()
const library = useLibrary()
const ui = useUi()
const a = settings.s.audio

const MODES: { id: CrossfadeSettings['mode']; label: string }[] = [
  { id: 'off', label: $t('Без') },
  { id: 'crossfade', label: $t('Кроссфейд') },
  { id: 'overlay', label: $t('Наложение') },
  { id: 'fadeOutIn', label: $t('Затухание') },
]
const MODE_HINT: Record<CrossfadeSettings['mode'], string> = {
  off: $t('Треки идут встык, без пауз.'),
  crossfade: $t('Конец одного трека плавно перетекает в начало следующего.'),
  overlay: $t('Следующий входит сразу, предыдущий уходит на второй план и затихает — как у диджея.'),
  fadeOutIn: $t('Трек затихает, потом начинается следующий.'),
}
const CURVES: { id: CrossfadeSettings['curve']; label: string }[] = [
  { id: 'equalPower', label: $t('Плавная') },
  { id: 'linear', label: $t('Прямая') },
  { id: 'sCurve', label: $t('S-кривая') },
]
const NORMS: { id: NormalizationSettings['mode']; label: string; hint: string }[] = [
  { id: 'off', label: $t('Выкл'), hint: $t('Как записано в файлах: одни треки громче других.') },
  { id: 'track', label: $t('Трек'), hint: $t('Каждый трек к одной громкости.') },
  { id: 'album', label: $t('Альбом'), hint: $t('Альбом целиком к одной громкости: тихие вступления остаются тихими.') },
  { id: 'smart', label: $t('Умная'), hint: $t('Альбом — по альбому, остальное — по треку.') },
]
const TARGETS = [-18, -16, -14, -11]
const FREQ_LABELS = ['31', '62', '125', '250', '500', $t('1к'), $t('2к'), $t('4к'), $t('8к'), $t('16к')]

/* ---- эквалайзер: правим профиль текущего устройства, если он есть, иначе общий ---- */
const profileKey = computed(() => (a.profiles[player.output] ? player.output : null))
const eq = computed<EqSettings>(() => (profileKey.value ? a.profiles[profileKey.value]!.eq : a.eq))

function applyPreset(id: string) {
  const p = EQ_PRESETS[id]!
  eq.value.bands = p.bands.slice()
  eq.value.preampDb = p.preampDb
  eq.value.preset = id
  eq.value.enabled = true
}
function setBand(i: number, v: number) {
  eq.value.bands[i] = Math.round(v * 2) / 2
  eq.value.preset = 'custom'
}

/*
 * Вертикальный ползунок полосы. Страница листается тоже вертикально, поэтому полоса берётся
 * за ручку (палец рядом с ней) или долгим касанием; тап ставит значение, свайп по рельсе листает страницу.
 */
let band = -1
let bandMode: 'idle' | 'pending' | 'drag' = 'idle'
let bandY = 0
let bandPid = -1
let bandEl: HTMLElement | null = null
let bandTimer = 0
function bandAt(y: number, el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const f = 1 - Math.min(1, Math.max(0, (y - r.top) / r.height))
  return -12 + f * 24
}
function knobY(i: number, el: HTMLElement) {
  const r = el.getBoundingClientRect()
  return r.bottom - ((eq.value.bands[i]! + 12) / 24) * r.height
}
function bandGrab(y: number) {
  if (!bandEl || band < 0) return
  bandMode = 'drag'
  bandEl.setPointerCapture(bandPid)
  haptic.tick()
  setBand(band, bandAt(y, bandEl))
}
function bandDown(e: PointerEvent, i: number) {
  if (e.button !== 0 || touchStoppedScroll()) return
  band = i
  bandEl = e.currentTarget as HTMLElement
  bandPid = e.pointerId
  bandY = e.clientY
  if (Math.abs(e.clientY - knobY(i, bandEl)) < 26) return bandGrab(e.clientY)
  bandMode = 'pending'
  const y = e.clientY
  bandTimer = window.setTimeout(() => bandMode === 'pending' && bandGrab(y), 320)
}
function bandMove(e: PointerEvent, i: number) {
  if (band !== i || e.pointerId !== bandPid) return
  if (bandMode === 'pending' && Math.abs(e.clientY - bandY) > 8) bandEnd()
  else if (bandMode === 'drag') setBand(i, bandAt(e.clientY, bandEl!))
}
function bandUp(e: PointerEvent, i: number) {
  if (band !== i || e.pointerId !== bandPid) return
  if (bandMode === 'pending') setBand(i, bandAt(e.clientY, bandEl!))
  bandEnd()
}
function bandEnd() {
  clearTimeout(bandTimer)
  bandMode = 'idle'
  band = -1
  bandEl = null
}
/** Пока тянем полосу, страница не едет */
function eqTouchMove(e: TouchEvent) {
  if (bandMode === 'drag' && e.cancelable) e.preventDefault()
}
const eqEl = ref<HTMLElement | null>(null)
onMounted(() => eqEl.value?.addEventListener('touchmove', eqTouchMove, { passive: false }))
onBeforeUnmount(() => {
  eqEl.value?.removeEventListener('touchmove', eqTouchMove)
  clearTimeout(bandTimer)
})

const pct = (v: number, min: number, max: number) => `${((v - min) / (max - min)) * 100}%`

/* ---- анализ ---- */
const analyzedCount = computed(() => library.tracks.filter((t) => t.analyzed).length)
async function analyzeAll() {
  const keys = library.tracks.filter((t) => !t.analyzed).map((t) => t.key)
  if (!keys.length) return ui.toast($t('Всё уже проанализировано'))
  await MusicCore.analyze({ keys, priority: 'now' })
  ui.toast($t('Анализирую {0}: громкость, тишина по краям и волна', keys.length))
}

/* ---- послушать переход на текущей паре треков ---- */
const previewing = ref(false)
async function previewTransition() {
  const cur = player.current
  const next = player.upcoming[0]
  if (!cur || !next) return ui.toast($t('Нужны два трека в очереди: текущий и следующий'))
  const c = a.crossfade
  const dur = c.mode === 'off' ? 0 : c.durationMs
  const end = cur.trimEndMs ?? cur.durationMs
  previewing.value = true
  const h = await MusicCore.addListener('previewEnded', () => {
    previewing.value = false
    void h.remove()
  })
  await MusicCore.previewJunction({
    aUri: cur.uri,
    atMs: Math.max(0, end - dur - 1000),
    bUri: next.uri,
    cueMs: next.trimStartMs ?? 0,
    type: c.mode === 'off' ? 'gapless' : c.mode,
    durationMs: Math.max(1, dur),
    curve: c.curve,
    duckDb: c.duckDb,
    leadMs: 6000,
    tailMs: dur + 6000,
  })
}
async function stopPreview() {
  await MusicCore.previewStop()
  previewing.value = false
}
</script>

<template>
  <div class="scroll screen form">
    <ScreenHeader :title="$t('Звук')" back />

    <section class="group">
      <h2 class="gtitle">{{ $t('Переходы между треками') }}</h2>
      <div class="seg four">
        <button
          v-for="m in MODES"
          :key="m.id"
          type="button"
          :class="{ on: a.crossfade.mode === m.id }"
          @click="a.crossfade.mode = m.id"
        >
          {{ m.label }}
        </button>
      </div>
      <p class="note">{{ MODE_HINT[a.crossfade.mode] }}</p>
      <template v-if="a.crossfade.mode !== 'off'">
        <div class="slider-row">
          <header>
            <span>{{ $t('Длительность') }}</span
            ><output>{{ $t('{0} с', (a.crossfade.durationMs / 1000).toFixed(1).replace('.0', '')) }}</output>
          </header>
          <RangeSlider v-model="a.crossfade.durationMs" :min="1000" :max="12000" :step="500" />
        </div>
        <div v-if="a.crossfade.mode === 'crossfade'" class="seg three">
          <button
            v-for="c in CURVES"
            :key="c.id"
            type="button"
            :class="{ on: a.crossfade.curve === c.id }"
            @click="a.crossfade.curve = c.id"
          >
            {{ c.label }}
          </button>
        </div>
        <div v-if="a.crossfade.mode === 'overlay'" class="slider-row">
          <header>
            <span>{{ $t('Предыдущий трек тише на') }}</span
            ><output>{{ $t('{0} дБ', -a.crossfade.duckDb) }}</output>
          </header>
          <RangeSlider v-model="a.crossfade.duckDb" :min="-18" :max="-3" :step="1" />
        </div>
      </template>
      <label class="row">
        <span
          ><b>{{ $t('Альбомы без склеек') }}</b
          ><small>{{ $t('Соседние треки одного альбома по порядку идут встык, как задумано') }}</small></span
        >
        <input id="xf-smart" v-model="a.crossfade.smart" type="checkbox" class="switch" />
      </label>
      <label class="row">
        <span
          ><b>{{ $t('Мягкий пропуск') }}</b
          ><small>{{ $t('Короткое затухание, когда листаешь треки') }}</small></span
        >
        <select id="xf-skip" v-model.number="a.crossfade.skipFadeMs" class="select">
          <option :value="0">{{ $t('выкл') }}</option>
          <option :value="150">{{ $t('быстро') }}</option>
          <option :value="250">{{ $t('обычно') }}</option>
          <option :value="450">{{ $t('медленно') }}</option>
        </select>
      </label>
      <button type="button" class="btn block" @click="previewing ? stopPreview() : previewTransition()">
        {{ previewing ? $t('Остановить') : $t('Послушать переход') }}
      </button>
    </section>

    <section class="group">
      <h2 class="gtitle">{{ $t('Одинаковая громкость') }}</h2>
      <div class="seg four">
        <button
          v-for="n in NORMS"
          :key="n.id"
          type="button"
          :class="{ on: a.normalization.mode === n.id }"
          @click="a.normalization.mode = n.id"
        >
          {{ n.label }}
        </button>
      </div>
      <p class="note">{{ NORMS.find((n) => n.id === a.normalization.mode)?.hint }}</p>
      <label v-if="a.normalization.mode !== 'off'" class="row">
        <span
          ><b>{{ $t('Уровень') }}</b
          ><small>{{ $t('−14 LUFS как у стримингов; −18 тише и с запасом для динамики') }}</small></span
        >
        <select id="norm-target" v-model.number="a.normalization.targetLufs" class="select">
          <option v-for="t in TARGETS" :key="t" :value="t">{{ t }} LUFS</option>
        </select>
      </label>
      <p class="note">
        {{ $t('Проанализировано {0} из {1}.', analyzedCount, library.tracks.length) }}
        <template v-if="library.analysis">
          {{ $t('Сейчас идёт: {0} из {1}.', library.analysis.done, library.analysis.total) }}</template
        >
        {{
          $t(
            'На телефоне анализ идёт на зарядке или пока приложение открыто. Пока трек не проанализирован, берётся ReplayGain из тегов.',
          )
        }}
      </p>
      <button v-if="analyzedCount < library.tracks.length" type="button" class="btn block" @click="analyzeAll">
        {{ $t('Проанализировать сейчас') }}
      </button>
    </section>

    <section class="group">
      <div class="eq-head">
        <h2 class="gtitle">{{ $t('Эквалайзер') }}</h2>
        <input id="eq-on" v-model="eq.enabled" type="checkbox" class="switch" :aria-label="$t('Включить эквалайзер')" />
      </div>
      <p class="note">
        <template v-if="profileKey">{{
          $t('Профиль устройства «{0}»: включается сам, когда звук идёт туда.', outputLabel(profileKey))
        }}</template>
        <template v-else>{{
          $t('Общий для всех устройств. Свой профиль для наушников или колонки — в «Вывод звука» в плеере.')
        }}</template>
      </p>
      <div class="pills">
        <button
          v-for="(p, id) in EQ_PRESETS"
          :key="id"
          type="button"
          class="pill"
          :class="{ on: eq.preset === id && eq.enabled }"
          @click="applyPreset(String(id))"
        >
          {{ p.label }}
        </button>
      </div>
      <div ref="eqEl" class="eq" :class="{ off: !eq.enabled }">
        <div v-for="(f, i) in FREQ_LABELS" :key="f" class="band">
          <output class="num">{{ eq.bands[i]! > 0 ? '+' : '' }}{{ eq.bands[i] }}</output>
          <div
            class="rail"
            role="slider"
            :aria-label="$t('{0} Гц', f)"
            :aria-valuenow="eq.bands[i]"
            aria-valuemin="-12"
            aria-valuemax="12"
            @pointerdown="bandDown($event, i)"
            @pointermove="bandMove($event, i)"
            @pointerup="bandUp($event, i)"
            @pointercancel="bandEnd"
            @lostpointercapture.self="bandEnd"
          >
            <i class="zero" />
            <b
              class="fillb"
              :style="
                eq.bands[i]! >= 0
                  ? { bottom: '50%', height: `${(eq.bands[i]! / 24) * 100}%` }
                  : { top: '50%', height: `${(-eq.bands[i]! / 24) * 100}%` }
              "
            />
            <span class="knob" :style="{ bottom: pct(eq.bands[i]!, -12, 12) }" />
          </div>
          <small>{{ f }}</small>
        </div>
      </div>
      <div class="slider-row">
        <header>
          <span>{{ $t('Предусиление') }}</span
          ><output>{{ $t('{0}{1} дБ', eq.preampDb > 0 ? '+' : '', eq.preampDb) }}</output>
        </header>
        <RangeSlider v-model="eq.preampDb" :min="-12" :max="6" :step="0.5" />
      </div>
      <p class="note">
        {{
          $t('Если подняли низы или верха, уберите предусиление на столько же, чтобы не было перегруза. На выходе стоит лимитер.')
        }}
      </p>
    </section>

    <section class="group">
      <label class="row">
        <span
          ><b>{{ $t('Продолжать при подключении') }}</b
          ><small>{{ $t('Наушники подключились — музыка продолжается с того же места') }}</small></span
        >
        <input id="auto-resume" v-model="a.autoResume" type="checkbox" class="switch" />
      </label>
    </section>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.eq-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.eq {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 2px;
  padding: 4px 0;
  transition: opacity var(--t-mid) var(--ease);
}
.eq.off {
  opacity: 0.4;
}
.band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.band output {
  font-size: 10.5px;
  color: var(--ink-2);
  height: 12px;
}
.band small {
  font-size: 10.5px;
  color: var(--ink-3);
}
.rail {
  position: relative;
  width: 100%;
  height: 150px;
  touch-action: pan-y;
  cursor: ns-resize;
}
.rail::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 4px;
  margin-left: -2px;
  border-radius: 2px;
  background: var(--line-strong);
}
.zero {
  position: absolute;
  left: 20%;
  right: 20%;
  top: 50%;
  height: 1px;
  background: var(--ink-3);
}
.fillb {
  position: absolute;
  left: 50%;
  width: 4px;
  margin-left: -2px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--amber), var(--ember));
}
.knob {
  position: absolute;
  left: 50%;
  width: 18px;
  height: 18px;
  margin: 0 0 -9px -9px;
  border-radius: 50%;
  background: var(--ink);
  box-shadow: 0 0 0 4px rgba(var(--amber-rgb), 0.2);
}
</style>
