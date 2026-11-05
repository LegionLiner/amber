<script setup lang="ts">
import { ref } from 'vue'
import IconWarn from '~icons/solar/danger-triangle-linear'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { countLabel } from '@/domain/format'
import { $t, $tp } from '@/i18n'

/**
 * Файлы, испорченные старой записью тегов: у них расширение .mp3, внутри MP4/AAC,
 * а приложение дописало в начало ID3-тег — после этого файл не играет и пропадает из библиотеки.
 * Починка убирает лишний тег, а новое название переносит в теги MP4.
 */
const library = useLibrary()
const ui = useUi()
const busy = ref(false)

async function repair() {
  busy.value = true
  try {
    const r = await library.repairDamaged()
    if (r.written && !r.failed)
      ui.toast($t('Починено: {0}. Названия сохранены', countLabel(r.written, $tp('файл|файла|файлов'))), undefined, 5000)
    else if (r.written) ui.toast($t('Починено {0}, не вышло {1}', r.written, r.failed), undefined, 5000)
    else ui.toast($t('Не получилось починить. Попробуй ещё раз'), undefined, 5000)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ui.toast(
      /cancel|отмен|разреш/i.test(msg) ? $t('Без разрешения Android файлы не изменить') : $t('Не получилось: {0}', msg),
      undefined,
      5000,
    )
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="library.damaged.length" class="dmg">
    <IconWarn class="ic" />
    <div class="text">
      <b>{{ $t('{0} играть', countLabel(library.damaged.length, $tp('файл перестал|файла перестали|файлов перестали'))) }}</b>
      <p>
        {{
          $t(
            'Прошлая версия записала в них теги как в mp3, хотя внутри формат MP4. Починка вернёт звук и сохранит твоё переименование.',
          )
        }}
      </p>
      <small class="ellipsis">{{ library.damaged.map((d) => d.name).join(', ') }}</small>
      <button type="button" class="btn primary" :disabled="busy" @click="repair">
        {{ busy ? $t('Чиню…') : $t('Починить') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.dmg {
  display: grid;
  grid-template-columns: 26px 1fr;
  gap: 12px;
  margin: 12px var(--gutter) 0;
  padding: 14px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--bad) 14%, var(--surface));
}
.ic {
  width: 24px;
  height: 24px;
  color: var(--bad);
}
.text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.text b {
  font: 600 15px/1.3 var(--f-body);
}
.text p {
  font-size: 13px;
  line-height: 1.45;
  color: var(--ink-2);
}
.text small {
  font-size: 12px;
  color: var(--ink-3);
}
.btn {
  align-self: flex-start;
  margin-top: 4px;
  min-height: 40px;
}
</style>
