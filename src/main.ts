import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource-variable/unbounded'
import '@fontsource-variable/onest'
import './design/tokens.css'
import './design/base.css'
import './design/forms.css'
import './design/motion.css'
import './design/desktop.css'
import App from './App.vue'
import { router } from './app/router'
import { boot } from './app/boot'
import { bootState } from './app/boot-state'
import { installTapGuard } from './composables/tapGuard'
import { installMorphTracking, installRouteMotion } from './app/motion'
import { lang } from './i18n'

document.documentElement.lang = lang

installTapGuard()
installMorphTracking()
installRouteMotion(router)

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

boot()
  .then(() => (bootState.ready = true))
  .catch((e: unknown) => {
    console.error(e)
    bootState.error = e instanceof Error ? e.message : String(e)
  })
