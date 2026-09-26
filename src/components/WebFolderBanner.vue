<script setup lang="ts">
import { onMounted, ref } from 'vue'
import IconFolder from '~icons/solar/folder-open-linear'
import { MusicCore, MusicCoreWeb, type WebFolderInfo } from '@/native/music-core'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'

/**
 * Только в браузере: после перезагрузки страницы Chrome не отдаёт папку без клика.
 * Плашка сверху просит одно нажатие, и библиотека снова играет.
 */
const library = useLibrary()
const ui = useUi()
const info = ref<WebFolderInfo | null>(null)

async function refresh() {
  info.value = await MusicCoreWeb.folderInfo()
}
onMounted(async () => {
  await refresh()
  await MusicCore.addListener('folderAccess', () => void refresh())
})

async function restore() {
  const r = await MusicCoreWeb.restoreFolder().catch(() => ({ count: 0 }))
  if (!r.count) {
    ui.toast('Браузер не дал доступ. Выбери папку заново в настройках')
    return
  }
  await library.scan(false)
  await refresh()
}
</script>

<template>
  <Transition name="banner">
    <div v-if="info?.needsAccess" class="banner glass">
      <IconFolder />
      <span>Папка «{{ info.savedName }}» ждёт подтверждения</span>
      <button type="button" class="btn primary" @click="restore">Открыть</button>
    </div>
  </Transition>
</template>

<style scoped>
.banner {
  position: fixed;
  top: calc(var(--safe-top) + 8px);
  left: var(--gutter);
  right: var(--gutter);
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 14px;
  border-radius: 18px;
  font-size: 13.5px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}
.banner svg {
  width: 20px;
  height: 20px;
  color: var(--amber-ink);
  flex: none;
}
.banner span {
  flex: 1;
  min-width: 0;
}
.banner .btn {
  min-height: 36px;
  padding: 0 14px;
  font-size: 13.5px;
}
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
.banner-enter-active,
.banner-leave-active {
  transition: all var(--t-mid) var(--ease-out);
}
</style>
