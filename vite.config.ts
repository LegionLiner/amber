import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [vue(), Icons({ compiler: 'vue3', scale: 1 })],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // WebView на S23 Ultra обновляется через Play Store, современный JS поддерживается
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: { host: true, port: 5173 },
})
