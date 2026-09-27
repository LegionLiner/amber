<script setup lang="ts">
import { computed, onActivated, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import IconAdd from '~icons/solar/add-circle-linear'
import IconPen from '~icons/solar/pen-linear'
import IconPlay from '~icons/solar/play-linear'
import IconStop from '~icons/solar/stop-linear'
import IconOpen from '~icons/solar/history-linear'
import ContextEditSheet from './ContextEditSheet.vue'
import ActionMenuSheet from '@/components/ActionMenuSheet.vue'
import { useLongPress } from '@/composables/useLongPress'
import { contextIcon } from './contextIcons'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { activeContext, deleteContext, listContexts, startContext, stopContexts, type ContextRow } from '@/data/repos/contexts'

/**
 * Контексты: ситуации со своим саундтреком. Запускаешь вручную («Начать») или они включаются
 * сами по правилам — по часам, дням недели, наушникам или колонке.
 */
const router = useRouter()
const player = usePlayer()
const ui = useUi()
const list = shallowRef<ContextRow[]>([])

async function load() {
  list.value = await listContexts()
}
onMounted(load)
onActivated(load)

const active = computed(() => activeContext(list.value, new Date(), player.output))

async function toggle(c: ContextRow) {
  if (c.running != null) {
    await stopContexts()
    ui.toast(`«${c.title}» закончен`)
  } else {
    await startContext(c.id)
    ui.toast(`Сейчас: «${c.title}». Музыка запишется в этот контекст`)
  }
  await load()
}
/** Удержание на контексте — меню: открыть, начать/стоп, изменить, удалить */
const hold = useLongPress()
function menu(c: ContextRow) {
  ui.openSheet(ActionMenuSheet, {
    title: c.title,
    actions: [
      {
        label: 'Открыть',
        icon: IconOpen,
        run: () => {
          ui.closeSheet()
          void router.push(`/context/${c.id}`)
        },
      },
      {
        label: c.running != null ? 'Закончить' : 'Начать',
        icon: c.running != null ? IconStop : IconPlay,
        run: () => {
          ui.closeSheet()
          void toggle(c)
        },
      },
      { label: 'Изменить', icon: IconPen, run: () => ui.openSheet(ContextEditSheet, { ctx: c, onSaved: load }) },
    ],
    deleteNote: 'Прослушивания останутся в истории, но без этой пометки.',
    onDelete: async () => {
      await deleteContext(c.id)
      ui.toast(`Контекст «${c.title}» удалён`)
      await load()
    },
  })
}

function create() {
  ui.openSheet(ContextEditSheet, { onSaved: load })
}
function rulesText(c: ContextRow): string {
  const r = c.rules
  const parts: string[] = []
  if (r.hours) parts.push(`${r.hours[0]}:00–${r.hours[1]}:00`)
  if (r.weekdays?.length) parts.push(r.weekdays.map((d) => ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][d - 1]).join(', '))
  if (r.outputs?.length) parts.push(r.outputs.map((o) => (o === 'bt:' ? 'Bluetooth' : o.replace(/^bt:/, ''))).join(', '))
  return parts.join(' · ') || 'вручную'
}
</script>

<template>
  <section>
    <p class="lead muted">Ситуации со своим саундтреком: дорога, работа, тренировка. Что звучало в контексте — видно отдельно.</p>
    <div
      v-for="c in list"
      :key="c.id"
      class="ctx"
      :class="{ on: active?.id === c.id }"
      :style="{ '--cc': c.color ?? 'var(--amber)' }"
    >
      <button type="button" class="main" v-bind="hold(() => menu(c))" @click="router.push(`/context/${c.id}`)">
        <span class="ic"><component :is="contextIcon(c.icon)" /></span>
        <span class="text">
          <b class="ellipsis">{{ c.title }}</b>
          <small class="ellipsis">{{
            active?.id === c.id ? (c.running != null ? 'идёт сейчас' : 'сейчас по правилам') : rulesText(c)
          }}</small>
        </span>
      </button>
      <button type="button" class="btn small" :class="{ primary: c.running == null }" @click="toggle(c)">
        {{ c.running != null ? 'Стоп' : 'Начать' }}
      </button>
    </div>
    <button type="button" class="add" @click="create"><IconAdd />Новый контекст</button>
  </section>
</template>

<style scoped>
.lead {
  padding: 0 var(--gutter) 10px;
  font-size: 13px;
  line-height: 1.45;
}
.ctx {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 var(--gutter) 8px;
  padding: 10px 12px 10px 10px;
  border-radius: 16px;
  background: var(--surface);
}
.ctx.on {
  background: linear-gradient(135deg, color-mix(in srgb, var(--cc) 20%, transparent), var(--surface) 70%);
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
}
.ic {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--cc) 18%, transparent);
  color: var(--cc);
}
.ic svg {
  width: 22px;
  height: 22px;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.text b {
  font: 600 15px/1.2 var(--f-body);
}
.text small {
  font-size: 12.5px;
  color: var(--ink-2);
}
.btn.small {
  min-height: 36px;
  padding: 0 14px;
  font-size: 13.5px;
}
.add {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 var(--gutter);
  padding: 12px 4px;
  color: var(--amber-ink);
  font: 500 14.5px/1 var(--f-body);
}
.add svg {
  width: 22px;
  height: 22px;
}
</style>
