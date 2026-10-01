<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayer } from '@/stores/player'
import { useSettings } from '@/stores/settings'
import { isNative } from '@/native/paths'
import RangeSlider from '@/components/RangeSlider.vue'
import { haptic } from '@/native/haptics'
import {
  EFFECTS,
  cleanEffects,
  plainSound,
  sameSound,
  soundName,
  type EffectId,
  type Effects,
  type SoundPreset,
} from '@/domain/effects'

/**
 * Скорость, тон и эффекты. «Slowed» и «Nightcore» — скорость и тон вместе, как на пластинке;
 * «Быстрее» и «Медленнее» — только темп, голос не меняется. Эффекты (эхо, зал, 8D…) включаются
 * плитками, у включённого — ползунок силы; звук меняется прямо во время протяжки.
 * Сверху — свои пресеты: настроенный звук сохраняется под именем и потом включается одним нажатием.
 */
const player = usePlayer()
const settings = useSettings()

/* ---- свои пресеты ---- */
const mine = computed(() => settings.s.soundPresets)
const plain = computed(() => plainSound(player.sound))
const activeMine = computed(() => mine.value.find((p) => sameSound(p, player.sound))?.id)
const canSave = computed(() => !plain.value && !activeMine.value)
const editing = ref(false)
const naming = ref(false)
const newName = ref('')

function applyMine(p: SoundPreset) {
  if (editing.value) {
    settings.s.soundPresets = mine.value.filter((x) => x.id !== p.id)
    if (!settings.s.soundPresets.length) editing.value = false
    return
  }
  haptic.tick()
  void player.applySound(p)
}
function applyPlain() {
  haptic.tick()
  void player.applySound({ speed: 1, pitch: 1, effects: {} })
}
function startSave() {
  newName.value = soundName(player.sound)
  naming.value = true
}
function save() {
  const name = newName.value.trim() || soundName(player.sound)
  settings.s.soundPresets = [
    ...mine.value,
    {
      id: `p${Date.now().toString(36)}`,
      name,
      speed: player.speed,
      pitch: player.pitch,
      effects: cleanEffects(player.effects),
    },
  ]
  naming.value = false
  haptic.success()
}

interface Preset {
  id: string
  label: string
  speed: number
  pitch: number
  fx?: Effects
}
const PRESETS: Preset[] = [
  { id: 'normal', label: 'Как есть', speed: 1, pitch: 1 },
  { id: 'slowed', label: 'Slowed', speed: 0.85, pitch: 0.85 },
  { id: 'slowedReverb', label: 'Slowed + reverb', speed: 0.85, pitch: 0.85, fx: { reverb: 0.6 } },
  { id: 'nightcore', label: 'Nightcore', speed: 1.25, pitch: 1.25 },
  { id: 'slow', label: 'Медленнее', speed: 0.85, pitch: 1 },
  { id: 'fast', label: 'Быстрее', speed: 1.2, pitch: 1 },
]

const keepTone = computed(() => Math.abs(player.pitch - 1) < 0.001 || Math.abs(player.pitch - player.speed) > 0.001)
const same = (a: number, b: number) => Math.abs(a - b) < 0.001
/** Пресеты с эффектами проверяются первыми: «Slowed + reverb» — это и «Slowed» тоже */
const current = computed(
  () =>
    [...PRESETS]
      .sort((a, b) => (b.fx ? 1 : 0) - (a.fx ? 1 : 0))
      .find(
        (p) =>
          same(p.speed, player.speed) &&
          same(p.pitch, player.pitch) &&
          Object.keys(p.fx ?? {}).every((k) => (player.effects[k as EffectId] ?? 0) > 0),
      )?.id,
)

function set(speed: number, pitch: number) {
  void player.setPlaybackParams(Math.round(speed * 100) / 100, Math.round(pitch * 100) / 100)
}
function preset(p: Preset) {
  set(p.speed, p.pitch)
  if (p.fx) void player.setEffects({ ...player.effects, ...p.fx })
  // «Slowed» после «Slowed + reverb» — без зала
  else if (p.id === 'slowed' && current.value === 'slowedReverb') void player.setEffects({ ...player.effects, reverb: 0 })
}
/** Пока палец на ползунке, меняется только цифра: применяем один раз, когда отпустили */
const draft = ref<number | null>(null)
const shownSpeed = computed(() => draft.value ?? player.speed)
function applySpeed(v: number) {
  draft.value = null
  if (Math.abs(v - player.speed) < 0.001) return
  set(v, keepTone.value ? 1 : v)
}
function toggleTone() {
  set(player.speed, keepTone.value ? player.speed : 1)
}

/* ---- эффекты ---- */
const on = (id: EffectId) => (player.effects[id] ?? 0) > 0
const active = computed(() => EFFECTS.filter((d) => on(d.id)))
function toggle(id: EffectId) {
  const d = EFFECTS.find((x) => x.id === id)!
  void player.setEffects({ ...player.effects, [id]: on(id) ? 0 : d.initial })
}
/** Сила меняется прямо во время протяжки: эффект слышно сразу */
function strength(id: EffectId, v: number) {
  void player.setEffects({ ...player.effects, [id]: Math.max(0.05, v) })
}
function resetFx() {
  void player.setEffects({})
}
</script>

<template>
  <div class="sheet-body form">
    <h3 class="sheet-head">Скорость, тон и эффекты</h3>

    <div class="fx-head first">
      <h4>Мои пресеты</h4>
      <button v-if="mine.length" type="button" class="reset" @click="editing = !editing">
        {{ editing ? 'Готово' : 'Изменить' }}
      </button>
    </div>
    <div class="pills">
      <button type="button" class="pill" :class="{ on: plain }" data-preset="plain" @click="applyPlain">Обычный звук</button>
      <button
        v-for="p in mine"
        :key="p.id"
        type="button"
        class="pill"
        :class="{ on: activeMine === p.id && !editing, del: editing }"
        :aria-label="editing ? `Удалить пресет «${p.name}»` : undefined"
        data-preset="mine"
        @click="applyMine(p)"
      >
        {{ p.name }}<span v-if="editing" class="x" aria-hidden="true">×</span>
      </button>
      <button v-if="canSave && !naming" type="button" class="pill add" data-preset="save" @click="startSave">
        + Сохранить текущий
      </button>
    </div>
    <div v-if="naming" class="save-row">
      <input
        id="preset-name"
        v-model="newName"
        class="field"
        maxlength="28"
        placeholder="Название пресета"
        autocomplete="off"
        @keydown.enter="save"
      />
      <button type="button" class="btn primary" @click="save">Сохранить</button>
    </div>
    <p v-else-if="!mine.length" class="note">
      Настрой скорость, тон и эффекты ниже и нажми «Сохранить текущий» — потом весь набор включается одним нажатием.
    </p>

    <div class="fx-head">
      <h4>Скорость и тон</h4>
    </div>
    <div class="pills">
      <button v-for="p in PRESETS" :key="p.id" type="button" class="pill" :class="{ on: current === p.id }" @click="preset(p)">
        {{ p.label }}
      </button>
    </div>
    <div class="slider-row">
      <header>
        <span>Скорость</span><output>{{ shownSpeed.toFixed(2) }}×</output>
      </header>
      <RangeSlider
        :model-value="shownSpeed"
        :min="0.5"
        :max="2"
        :step="0.05"
        label="Скорость"
        @update:model-value="(v: number) => (draft = v)"
        @change="applySpeed"
      />
    </div>
    <label class="row">
      <span
        ><b>Сохранять тон</b><small>{{ keepTone ? 'Голос звучит как обычно' : 'Тон меняется вместе со скоростью' }}</small></span
      >
      <input id="keep-tone" type="checkbox" class="switch" :checked="keepTone" @change="toggleTone" />
    </label>

    <div class="fx-head">
      <h4>Эффекты</h4>
      <button v-if="active.length" type="button" class="reset" @click="resetFx">Выключить все</button>
    </div>
    <div class="fx-grid">
      <button
        v-for="d in EFFECTS"
        :key="d.id"
        type="button"
        class="fx"
        :class="{ on: on(d.id) }"
        :aria-pressed="on(d.id)"
        :data-fx="d.id"
        @click="toggle(d.id)"
      >
        <b>{{ d.label }}</b>
        <small>{{ d.hint }}</small>
      </button>
    </div>
    <div v-for="d in active" :key="d.id" class="slider-row">
      <header>
        <span>{{ d.label }}</span
        ><output>{{ Math.round((player.effects[d.id] ?? 0) * 100) }} %</output>
      </header>
      <RangeSlider
        :model-value="player.effects[d.id] ?? 0"
        :min="0.05"
        :max="1"
        :step="0.05"
        :label="`${d.label}: сила`"
        @update:model-value="(v: number) => strength(d.id, v)"
      />
    </div>

    <p v-if="!isNative" class="note">
      В браузере тон нельзя сдвинуть отдельно: он либо сохраняется, либо едет вместе со скоростью.
    </p>
    <p class="note">
      Эффекты действуют на все треки, пока их не выключишь. Прослушивание засчитывается по реальному времени: на ускорении трек
      засчитается быстрее.
    </p>
  </div>
</template>

<style scoped>
.fx-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 6px;
}
.fx-head.first {
  margin-top: 0;
}
.pill.add {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--line-strong);
  color: var(--ink-2);
}
.pill.del {
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--bad) 55%, transparent);
}
.pill .x {
  margin-left: 6px;
  color: var(--bad);
  font-weight: 600;
}
.save-row {
  display: flex;
  gap: 8px;
}
.save-row .field {
  flex: 1;
  width: auto;
  min-width: 0;
}
.save-row .btn {
  flex: none;
}
.fx-head h4 {
  font: 600 15px/1.2 var(--f-body);
}
.reset {
  color: var(--amber-ink);
  font: 500 13px/1 var(--f-body);
  padding: 6px 0;
}
.fx-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.fx {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-height: 64px;
  padding: 10px 12px;
  border-radius: var(--r-m);
  background: var(--chip);
  text-align: left;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.fx b {
  font: 600 14px/1.2 var(--f-body);
}
.fx small {
  font-size: 11.5px;
  line-height: 1.3;
  color: var(--ink-2);
}
.fx.on {
  background: rgba(var(--amber-rgb), 0.18);
  color: var(--amber-ink);
  box-shadow: inset 0 0 0 1.5px rgba(var(--amber-rgb), 0.45);
}
.fx:active {
  transform: scale(0.97);
}
</style>
