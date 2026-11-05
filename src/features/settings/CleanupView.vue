<script setup lang="ts">
import { computed, onActivated, ref, shallowRef } from 'vue'
import ScreenHeader from '@/components/ScreenHeader.vue'
import { useLibrary } from '@/stores/library'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { findFixes, REASON_LABEL, type Fix } from '@/domain/cleanup'
import { dismiss, dismissedKeys, saveTags, type TagEdit } from '@/data/repos/tags'
import type { Track } from '@/domain/track'
import { $t } from '@/i18n'

/**
 * Уборка тегов: мусор сайтов, номера в названиях, капслок, пустые теги из имени файла.
 * Ничего не меняется без спроса: отмечаешь нужное и применяешь. Если включена запись в файлы — правится сам mp3.
 */
const library = useLibrary()
const settings = useSettings()
const ui = useUi()

const fixes = shallowRef<Fix[]>([])
const selected = ref(new Set<string>())
const busy = ref(false)
const idOf = (f: Fix) => `${f.key}|${f.field}`

async function load() {
  const skip = await dismissedKeys('fix')
  fixes.value = findFixes(library.tracks).filter((f) => !skip.has(idOf(f)))
  selected.value = new Set(fixes.value.map(idOf))
}
onActivated(load)
void load()

const groups = computed(() => {
  const m = new Map<Fix['reason'], Fix[]>()
  for (const f of fixes.value) m.set(f.reason, [...(m.get(f.reason) ?? []), f])
  return [...m.entries()]
})

function toggle(f: Fix) {
  const s = new Set(selected.value)
  const id = idOf(f)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}
function toggleGroup(list: Fix[], on: boolean) {
  const s = new Set(selected.value)
  for (const f of list) {
    if (on) s.add(idOf(f))
    else s.delete(idOf(f))
  }
  selected.value = s
}

const FIELD: Record<Fix['field'], string> = { title: $t('название'), artist: $t('исполнитель'), album: $t('альбом') }

async function apply() {
  const chosen = fixes.value.filter((f) => selected.value.has(idOf(f)))
  if (!chosen.length) return
  busy.value = true
  try {
    const edits = new Map<string, TagEdit>()
    for (const f of chosen) edits.set(f.key, { ...edits.get(f.key), [f.field]: f.after })
    const tracks = [...edits.keys()].map((k) => library.byKey.get(k)).filter((t): t is Track => !!t)
    const r = await saveTags(tracks, edits, settings.s.writeTagsToFiles)
    await library.load()
    ui.toast(
      r.written
        ? $t('Исправлено: {0}, в файлы записано {1}', tracks.length, r.written)
        : $t('Исправлено в приложении: {0}', tracks.length),
      undefined,
      5000,
    )
    await load()
  } finally {
    busy.value = false
  }
}

async function skipSelected() {
  const chosen = fixes.value.filter((f) => selected.value.has(idOf(f)))
  await dismiss('fix', chosen.map(idOf))
  await load()
}
</script>

<template>
  <div class="scroll screen form">
    <ScreenHeader
      :title="$t('Уборка тегов')"
      :subtitle="fixes.length ? $t('Нашлось {0} исправлений', fixes.length) : undefined"
      back
    />
    <section v-if="!fixes.length" class="empty">
      <h3>{{ $t('Всё чисто') }}</h3>
      <p>{{ $t('Мусора сайтов, капслока и пустых тегов не нашлось.') }}</p>
    </section>
    <template v-else>
      <section v-for="[reason, list] in groups" :key="reason" class="group">
        <div class="ghead">
          <h2 class="gtitle">{{ REASON_LABEL[reason] }} · {{ list.length }}</h2>
          <button type="button" class="link" @click="toggleGroup(list, !list.every((f) => selected.has(idOf(f))))">
            {{ list.every((f) => selected.has(idOf(f))) ? $t('снять') : $t('все') }}
          </button>
        </div>
        <label v-for="f in list.slice(0, 200)" :key="idOf(f)" class="fix">
          <input :id="`fix-${idOf(f)}`" type="checkbox" :checked="selected.has(idOf(f))" @change="toggle(f)" />
          <span class="txt">
            <small>{{ FIELD[f.field] }}</small>
            <s v-if="f.before">{{ f.before }}</s>
            <b>{{ f.after }}</b>
          </span>
        </label>
        <p v-if="list.length > 200" class="note">{{ $t('…и ещё {0}', list.length - 200) }}</p>
      </section>
      <section class="group">
        <p class="note">
          {{
            settings.s.writeTagsToFiles
              ? $t('Исправления запишутся в сами mp3 (Android спросит разрешение), остальное — в приложении.')
              : $t('Исправления сохранятся в приложении, файлы не меняются.')
          }}
        </p>
        <div class="btns">
          <button type="button" class="btn" :disabled="busy || !selected.size" @click="skipSelected">
            {{ $t('Не предлагать') }}
          </button>
          <button type="button" class="btn primary" :disabled="busy || !selected.size" @click="apply">
            {{ $t('Исправить {0}', selected.size) }}
          </button>
        </div>
      </section>
    </template>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.ghead {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.link {
  color: var(--amber-ink);
  font: 500 13px/1 var(--f-body);
}
.fix {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 12px;
  align-items: start;
  padding: 6px 0;
  border-top: 1px solid var(--line);
}
.fix input {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  accent-color: var(--amber);
}
.txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 14px;
}
.txt small {
  font-size: 11px;
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.txt s {
  color: var(--ink-3);
  word-break: break-word;
}
.txt b {
  font-weight: 500;
  word-break: break-word;
}
</style>
