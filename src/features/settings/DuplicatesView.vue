<script setup lang="ts">
import { onActivated, ref, shallowRef } from 'vue'
import ScreenHeader from '@/components/ScreenHeader.vue'
import CoverArt from '@/components/CoverArt.vue'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { findDuplicates, type DuplicateGroup } from '@/domain/duplicates'
import { mergeDuplicates } from '@/data/repos/library'
import { dismiss, dismissedKeys } from '@/data/repos/tags'
import { formatBytes, formatDuration } from '@/domain/format'

/**
 * Дубли: один трек в нескольких файлах. «Слить» переносит историю, оценку и метки на выбранный файл,
 * остальные прячет из библиотеки. Сами файлы не удаляются — это можно сделать в файловом менеджере.
 */
const library = useLibrary()
const ui = useUi()
const groups = shallowRef<DuplicateGroup[]>([])
const choice = ref(new Map<string, string>())

async function load() {
  const skip = await dismissedKeys('dup')
  groups.value = findDuplicates(library.tracks).filter((g) => !skip.has(g.id))
  choice.value = new Map(groups.value.map((g) => [g.id, g.best.key]))
}
onActivated(load)
void load()

function choose(g: DuplicateGroup, key: string) {
  choice.value = new Map(choice.value).set(g.id, key)
}

async function merge(g: DuplicateGroup) {
  const best = choice.value.get(g.id) ?? g.best.key
  await mergeDuplicates(
    best,
    g.tracks.map((t) => t.key).filter((k) => k !== best),
  )
  await library.load()
  ui.toast('Слито: история и оценки теперь у одного файла')
  await load()
}

async function notDup(g: DuplicateGroup) {
  await dismiss('dup', [g.id])
  await load()
}
</script>

<template>
  <div class="scroll screen form">
    <ScreenHeader title="Дубли" :subtitle="groups.length ? `${groups.length} групп` : undefined" back />
    <section v-if="!groups.length" class="empty">
      <h3>Дублей нет</h3>
      <p>Одинаковых треков в разных файлах не нашлось.</p>
    </section>
    <section v-for="g in groups" :key="g.id" class="group">
      <div class="head">
        <CoverArt :art="g.best.art" :seed="g.best.title" :label="g.best.title" size="s" class="cv" />
        <div class="names">
          <b class="ellipsis">{{ g.best.title }}</b>
          <small class="ellipsis">{{ g.best.artist }}</small>
        </div>
      </div>
      <label v-for="t in g.tracks" :key="t.key" class="file">
        <input :id="`dup-${t.key}`" type="radio" :name="g.id" :checked="choice.get(g.id) === t.key" @change="choose(g, t.key)" />
        <span class="info">
          <span class="ellipsis">{{ t.folder }}{{ t.fileName }}</span>
          <small>
            {{ t.bitrate ? `${Math.round(t.bitrate / 1000)} кбит/с · ` : '' }}{{ formatBytes(t.size) }} ·
            {{ formatDuration(t.durationMs) }} · {{ t.plays }} прослуш.<template v-if="t.rating"> · ★{{ t.rating / 2 }}</template>
          </small>
        </span>
      </label>
      <div class="btns">
        <button type="button" class="btn" @click="notDup(g)">Это разные</button>
        <button type="button" class="btn primary" @click="merge(g)">Слить</button>
      </div>
    </section>
    <div class="bottom-space" />
  </div>
</template>

<style scoped>
.head {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 12px;
  align-items: center;
}
.cv {
  width: 44px;
}
.names {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.names b {
  font-weight: 600;
}
.names small {
  color: var(--ink-2);
}
.file {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 10px;
  align-items: start;
  padding: 8px 0;
  border-top: 1px solid var(--line);
  font-size: 13.5px;
}
.file input {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  accent-color: var(--amber);
}
.info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.info small {
  color: var(--ink-2);
  font-size: 12px;
}
</style>
