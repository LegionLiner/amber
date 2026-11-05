<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { $t } from '@/i18n'

/** Сон-таймер. Музыка плавно затухает 15 секунд и встаёт на паузу. Работает при выключенном экране. */
const emit = defineEmits<{ close: [] }>()
const player = usePlayer()
const ui = useUi()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 1000)))
onBeforeUnmount(() => clearInterval(timer))

const OPTIONS = [15, 30, 45, 60, 90]
const active = computed(() => player.sleepAt > 0 || player.sleepEndOfTrack)
const left = computed(() => {
  if (player.sleepEndOfTrack) return $t('после этого трека')
  const ms = Math.max(0, player.sleepAt - now.value)
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return $t('через {0}:{1}', m, String(s).padStart(2, '0'))
})

async function set(v: number | 'end' | null) {
  await player.setSleep(v)
  ui.toast(
    v == null ? $t('Сон-таймер выключен') : v === 'end' ? $t('Остановлю после этого трека') : $t('Остановлю через {0} мин', v),
  )
  emit('close')
}
</script>

<template>
  <div class="body">
    <h3 class="head">{{ $t('Сон-таймер') }}</h3>
    <p v-if="active" class="now">{{ $t('Музыка остановится {0}', left) }}</p>
    <div class="grid">
      <button v-for="m in OPTIONS" :key="m" type="button" class="opt" @click="set(m)">
        {{ m < 60 ? $t('{0} мин', m) : m === 60 ? $t('1 час') : $t('1,5 часа') }}
      </button>
      <button type="button" class="opt wide" @click="set('end')">{{ $t('После этого трека') }}</button>
    </div>
    <button v-if="active" type="button" class="btn block off" @click="set(null)">{{ $t('Выключить таймер') }}</button>
  </div>
</template>

<style scoped>
.body {
  padding: 0 var(--gutter) 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  font: 600 17px/1.2 var(--f-body);
}
.now {
  color: var(--amber-ink);
  font-weight: 500;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.opt {
  min-height: 52px;
  border-radius: 14px;
  background: var(--surface-2);
  font: 500 15px/1 var(--f-body);
}
.opt:active {
  background: var(--surface-3);
}
.wide {
  grid-column: span 3;
}
.off {
  color: var(--bad);
}
</style>
