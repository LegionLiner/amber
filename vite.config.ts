import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), Icons({ compiler: 'vue3', scale: 1 })],
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
