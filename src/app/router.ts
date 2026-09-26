import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import HomeView from '@/features/home/HomeView.vue'
import LibraryView from '@/features/library/LibraryView.vue'

export type TabId = 'home' | 'library' | 'search' | 'top' | 'chronicle'

declare module 'vue-router' {
  interface RouteMeta {
    tab?: TabId
    /** Экран без нижней навигации и мини-плеера */
    bare?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView, meta: { tab: 'home' } },
  { path: '/library/:section?', name: 'library', component: LibraryView, meta: { tab: 'library' } },
  { path: '/search', name: 'search', component: () => import('@/features/search/SearchView.vue'), meta: { tab: 'search' } },
  { path: '/top', name: 'top', component: () => import('@/features/top/TopView.vue'), meta: { tab: 'top' } },
  {
    path: '/chronicle',
    name: 'chronicle',
    component: () => import('@/features/chronicle/ChronicleView.vue'),
    meta: { tab: 'chronicle' },
  },
  { path: '/day/:day', name: 'day', component: () => import('@/features/chronicle/DayView.vue'), meta: { tab: 'chronicle' } },
  { path: '/era/:id', name: 'era', component: () => import('@/features/chronicle/EraView.vue'), meta: { tab: 'chronicle' } },
  {
    path: '/context/:id',
    name: 'context',
    component: () => import('@/features/chronicle/ContextView.vue'),
    meta: { tab: 'chronicle' },
  },
  { path: '/album/:id', name: 'album', component: () => import('@/features/library/AlbumView.vue'), meta: { tab: 'library' } },
  { path: '/artist/:id', name: 'artist', component: () => import('@/features/library/ArtistView.vue'), meta: { tab: 'library' } },
  { path: '/genre/:id', name: 'genre', component: () => import('@/features/library/GenreView.vue'), meta: { tab: 'library' } },
  { path: '/folder', name: 'folder', component: () => import('@/features/library/FolderView.vue'), meta: { tab: 'library' } },
  {
    path: '/playlist/:id',
    name: 'playlist',
    component: () => import('@/features/library/PlaylistView.vue'),
    meta: { tab: 'library' },
  },
  {
    path: '/playlist/:id/add',
    name: 'playlist-add',
    component: () => import('@/features/library/PlaylistAddView.vue'),
    meta: { tab: 'library' },
  },
  {
    path: '/playlist/:id/order',
    name: 'playlist-order',
    component: () => import('@/features/library/PlaylistOrderView.vue'),
    meta: { tab: 'library' },
  },
  {
    path: '/playlist/:id/rules',
    name: 'playlist-rules',
    component: () => import('@/features/library/SmartRulesView.vue'),
    meta: { tab: 'library' },
  },
  { path: '/mix/:id', name: 'mix', component: () => import('@/features/library/MixEditorView.vue'), meta: { tab: 'library' } },
  { path: '/auto/:id', name: 'auto', component: () => import('@/features/library/AutoView.vue'), meta: { tab: 'library' } },
  { path: '/track/:key', name: 'track', component: () => import('@/features/library/TrackView.vue'), meta: { tab: 'library' } },
  { path: '/settings', name: 'settings', component: () => import('@/features/settings/SettingsView.vue'), meta: { tab: 'home' } },
  {
    path: '/settings/audio',
    name: 'audio',
    component: () => import('@/features/settings/AudioSettingsView.vue'),
    meta: { tab: 'home' },
  },
  {
    path: '/settings/cleanup',
    name: 'cleanup',
    component: () => import('@/features/settings/CleanupView.vue'),
    meta: { tab: 'home' },
  },
  {
    path: '/settings/duplicates',
    name: 'duplicates',
    component: () => import('@/features/settings/DuplicatesView.vue'),
    meta: { tab: 'home' },
  },
  { path: '/welcome', name: 'welcome', component: () => import('@/features/onboarding/WelcomeView.vue'), meta: { bare: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
