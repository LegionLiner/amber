<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, type RouteLocationNormalizedLoaded } from 'vue-router'
import BottomNav from '@/components/BottomNav.vue'
import SheetHost from '@/components/SheetHost.vue'
import ToastHost from '@/components/ToastHost.vue'
import WebFolderBanner from '@/components/WebFolderBanner.vue'
import MiniPlayer from '@/features/player/MiniPlayer.vue'
import FullPlayer from '@/features/player/FullPlayer.vue'
import QueuePanel from '@/features/player/QueuePanel.vue'
import { bootState } from '@/app/boot-state'
import { useUi } from '@/stores/ui'
import { usePlayer } from '@/stores/player'
import { isNative } from '@/native/paths'
import { rememberScroll, restoreScroll, routeAnim } from '@/app/motion'

const route = useRoute()
const ui = useUi()
const player = usePlayer()
const bare = computed(() => !!route.meta.bare)

/** Экраны вкладок живут в KeepAlive под своим адресом, поэтому помнят прокрутку */
function viewKey(r: RouteLocationNormalizedLoaded): string {
  return r.path
}
</script>

<template>
  <div class="shell" :class="{ 'has-mini': player.hasTrack && !bare }">
    <div v-if="bootState.error" class="boot-error">
      <h3>Не удалось запустить</h3>
      <p>{{ bootState.error }}</p>
    </div>
    <RouterView v-slot="{ Component, route: r }">
      <Transition
        :name="routeAnim === 'none' ? undefined : `rt-${routeAnim}`"
        :css="routeAnim !== 'none'"
        @before-leave="rememberScroll"
        @enter="restoreScroll"
      >
        <KeepAlive :max="8">
          <component :is="Component" :key="viewKey(r)" />
        </KeepAlive>
      </Transition>
    </RouterView>
    <template v-if="!bare">
      <MiniPlayer />
      <BottomNav @reselect="ui.tabReselected" />
    </template>
    <FullPlayer />
    <QueuePanel />
    <SheetHost />
    <ToastHost />
    <WebFolderBanner v-if="!isNative && bootState.ready && !bare" />
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  height: 100%;
  overflow: hidden;
}
.boot-error {
  position: fixed;
  inset: auto 16px 50% 16px;
  z-index: 80;
  padding: 18px;
  border-radius: 16px;
  background: var(--surface-2);
}
.boot-error h3 {
  margin-bottom: 6px;
}
</style>
