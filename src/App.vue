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
import ZenMode from '@/features/player/ZenMode.vue'
import { bootState } from '@/app/boot-state'
import { useUi } from '@/stores/ui'
import { usePlayer } from '@/stores/player'
import { isNative } from '@/native/paths'
import { rememberScroll, restoreScroll, routeAnim } from '@/app/motion'
import { pageIndex } from '@/app/paging'
import PageStrip from '@/components/PageStrip.vue'
import DesktopSidebar from '@/components/desktop/DesktopSidebar.vue'
import DesktopPlayerBar from '@/components/desktop/DesktopPlayerBar.vue'
import RemoteStrip from '@/features/remote/RemoteStrip.vue'
import DesktopAmbient from '@/components/desktop/DesktopAmbient.vue'
import DesktopTitleBar from '@/components/desktop/DesktopTitleBar.vue'
import DesktopNowPanel from '@/components/desktop/DesktopNowPanel.vue'
import { isDesktop } from '@/native/desktop/bridge'
import { useSettings } from '@/stores/settings'
import { useMediaQuery } from '@vueuse/core'
import { $t } from '@/i18n'

const route = useRoute()
const ui = useUi()
const player = usePlayer()
const settings = useSettings()
const bare = computed(() => !!route.meta.bare)
/** Панель «Сейчас играет» справа: когда есть что показывать, окно достаточно широкое и её не свернули */
const roomy = useMediaQuery('(min-width: 1300px)')
const nowPanel = computed(() => isDesktop && !bare.value && player.hasTrack && settings.s.nowPanel && roomy.value)

/**
 * Экраны живут в KeepAlive под своим адресом, поэтому помнят прокрутку. Главные экраны — одна лента
 * (PageStrip): листаются свайпом вбок и в KeepAlive лежат одним целым.
 */
function viewKey(r: RouteLocationNormalizedLoaded): string {
  return pageIndex(r) >= 0 ? 'pager' : r.path
}
</script>

<template>
  <div class="shell" :class="{ 'has-mini': player.hasTrack && !bare, wide: isDesktop && !bare }">
    <!-- Компьютер: окно без системной рамки. Обычно его таскают за строку заголовка (DesktopTitleBar);
         на экранах без неё (приветствие) — за эту полосу. Кнопки окна рисует Windows -->
    <div v-if="isDesktop && bare" class="drag-strip" aria-hidden="true" />
    <!-- Компьютер: живой фон в цветах обложки, через него видно стекло меню и панелей -->
    <DesktopAmbient v-if="isDesktop" />
    <!-- Зерно поверх всего окна: гладкое стекло и градиенты без него выглядят стерильно -->
    <i v-if="isDesktop" class="grain" aria-hidden="true" />
    <DesktopTitleBar v-if="isDesktop && !bare" />
    <DesktopSidebar v-if="isDesktop && !bare" />
    <div v-if="bootState.error" class="boot-error">
      <h3>{{ $t('Не удалось запустить') }}</h3>
      <p>{{ bootState.error }}</p>
    </div>
    <div class="pages">
      <RouterView v-slot="{ Component, route: r }">
        <Transition
          :name="routeAnim === 'none' ? undefined : `rt-${routeAnim}`"
          :css="routeAnim !== 'none'"
          @before-leave="rememberScroll"
          @enter="restoreScroll"
        >
          <KeepAlive :max="8">
            <component :is="pageIndex(r) >= 0 ? PageStrip : Component" :key="viewKey(r)" />
          </KeepAlive>
        </Transition>
      </RouterView>
    </div>
    <Transition name="nowp">
      <DesktopNowPanel v-if="nowPanel" />
    </Transition>
    <DesktopPlayerBar v-if="isDesktop && !bare" />
    <template v-else-if="!bare">
      <MiniPlayer />
      <BottomNav @reselect="ui.tabReselected" />
    </template>
    <!-- Что играет на другом устройстве: над панелью плеера (компьютер) или над мини-плеером -->
    <RemoteStrip v-if="!bare" />
    <FullPlayer />
    <QueuePanel />
    <SheetHost />
    <ToastHost />
    <!-- «Сцена»: только обложка на весь экран, поверх всего -->
    <Transition name="zen">
      <ZenMode v-if="ui.zen && player.hasTrack" />
    </Transition>
    <WebFolderBanner v-if="!isNative && !isDesktop && bootState.ready && !bare" />
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  height: 100%;
  overflow: hidden;
}
.pages {
  position: relative;
  height: 100%;
  overflow: hidden;
}
/*
 * Компьютер: окно собрано из плавающих стеклянных панелей над живым фоном. Сверху — строка заголовка,
 * под ней меню, сцена с экранами и панель «Сейчас играет». Плеер — капсула поверх сцены: экраны
 * прокручиваются под ней (оформление панелей — design/desktop.css)
 */
.shell.wide {
  display: grid;
  grid-template-columns: var(--side-w) minmax(0, 1fr) auto;
  grid-template-rows: var(--title-h) minmax(0, 1fr);
  column-gap: var(--pane-gap);
  padding: 0 var(--pane-gap) var(--pane-gap);
}
.shell.wide .pages {
  grid-row: 2;
  grid-column: 2;
  height: auto;
  min-height: 0;
  container-type: inline-size;
  z-index: 1;
}
/* Панель справа появляется и уходит со сдвигом; сцена занимает освободившееся место */
.nowp-enter-active,
.nowp-leave-active {
  transition:
    opacity 220ms var(--ease),
    transform 320ms var(--ease-out);
}
.nowp-leave-active {
  position: absolute;
  right: var(--pane-gap);
  top: var(--title-h);
  bottom: var(--pane-gap);
}
.nowp-enter-from,
.nowp-leave-to {
  opacity: 0;
  transform: translateX(28px);
}
/* «Сцена» проявляется из темноты и так же уходит */
.zen-enter-active,
.zen-leave-active {
  transition: opacity 450ms var(--ease);
}
.zen-enter-from,
.zen-leave-to {
  opacity: 0;
}
.grain {
  position: fixed;
  inset: 0;
  z-index: 85;
  pointer-events: none;
  opacity: 0.05;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
/* Селектор с атрибутом темы пишется напрямую: :global(…) в стилях компонента отбрасывает всё, что после него */
[data-theme='light'] .grain {
  filter: invert(1);
  opacity: 0.04;
}
[data-motion='reduced'] .grain,
[data-glass='low'] .grain {
  display: none;
}
.drag-strip {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 36px;
  z-index: 90;
  -webkit-app-region: drag;
  pointer-events: none;
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
