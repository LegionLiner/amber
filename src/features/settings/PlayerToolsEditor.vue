<script setup lang="ts">
import { computed } from 'vue'
import IconUp from '~icons/solar/alt-arrow-up-linear'
import IconDown from '~icons/solar/alt-arrow-down-linear'
import IconRemove from '~icons/solar/close-circle-linear'
import IconPlus from '~icons/solar/add-circle-linear'
import { useSettings } from '@/stores/settings'
import { MAX_PLAYER_TOOLS, PLAYER_TOOLS, type PlayerToolId } from '@/domain/player-tools'
import { PLAYER_TOOL_ICONS } from '@/features/player/playerToolIcons'
import { $t } from '@/i18n'

/**
 * Быстрые кнопки внизу экрана плеера на телефоне: сверху — те, что на экране, по порядку
 * (стрелками переставить, крестиком убрать), ниже — что можно добавить. Не больше пяти: шире строка не влезает.
 */
const settings = useSettings()
const label = (id: PlayerToolId) => PLAYER_TOOLS.find((t) => t.id === id)?.label ?? id
const chosen = computed(() => settings.s.playerTools)
const rest = computed(() => PLAYER_TOOLS.filter((t) => !chosen.value.includes(t.id)))
const full = computed(() => chosen.value.length >= MAX_PLAYER_TOOLS)

function move(i: number, d: -1 | 1) {
  const list = [...chosen.value]
  const j = i + d
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j]!, list[i]!]
  settings.s.playerTools = list
}
function remove(id: PlayerToolId) {
  settings.s.playerTools = chosen.value.filter((x) => x !== id)
}
function add(id: PlayerToolId) {
  if (full.value) return
  settings.s.playerTools = [...chosen.value, id]
}
</script>

<template>
  <div class="tools-ed">
    <!-- Как это будет выглядеть в плеере -->
    <div class="preview" aria-hidden="true">
      <span class="out">{{ $t('Вывод') }}</span>
      <component :is="PLAYER_TOOL_ICONS[id]" v-for="id in chosen" :key="id" class="pv" />
      <span v-if="!chosen.length" class="none">{{ $t('без кнопок') }}</span>
    </div>
    <ol class="list">
      <li v-for="(id, i) in chosen" :key="id">
        <component :is="PLAYER_TOOL_ICONS[id]" class="ic" />
        <span class="ellipsis">{{ label(id) }}</span>
        <button type="button" class="mini" :disabled="i === 0" :aria-label="$t('{0}: левее', label(id))" @click="move(i, -1)">
          <IconUp />
        </button>
        <button
          type="button"
          class="mini"
          :disabled="i === chosen.length - 1"
          :aria-label="$t('{0}: правее', label(id))"
          @click="move(i, 1)"
        >
          <IconDown />
        </button>
        <button type="button" class="mini rm" :aria-label="$t('Убрать «{0}»', label(id))" @click="remove(id)">
          <IconRemove />
        </button>
      </li>
    </ol>
    <small class="hint">{{
      full ? $t('Не больше {0} — убери кнопку, чтобы добавить другую', MAX_PLAYER_TOOLS) : $t('Добавить:')
    }}</small>
    <div class="add">
      <button v-for="t in rest" :key="t.id" type="button" class="chip" :disabled="full" @click="add(t.id)">
        <IconPlus class="plus" /><component :is="PLAYER_TOOL_ICONS[t.id]" />{{ t.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tools-ed {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.preview {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--surface-2);
  color: var(--ink);
}
.preview .out {
  margin-right: auto;
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--chip);
  font-size: 12px;
  color: var(--ink-2);
}
.preview .pv {
  width: 22px;
  height: 22px;
}
.preview .none {
  font-size: 12.5px;
  color: var(--ink-3);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.list li {
  display: grid;
  grid-template-columns: 22px 1fr auto auto auto;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  font-size: 14.5px;
}
.ic {
  width: 22px;
  height: 22px;
  color: var(--amber-ink);
}
.mini {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--ink-2);
}
.mini:disabled {
  opacity: 0.3;
}
.mini svg {
  width: 20px;
  height: 20px;
}
.mini.rm {
  color: var(--ink-3);
}
.hint {
  font-size: 12.5px;
  color: var(--ink-3);
}
.add {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 8px 8px;
  border-radius: 999px;
  background: var(--chip);
  font-size: 13px;
  color: var(--ink);
}
.chip svg {
  width: 18px;
  height: 18px;
}
.chip .plus {
  color: var(--amber-ink);
}
.chip:disabled {
  opacity: 0.4;
}
</style>
