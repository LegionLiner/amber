import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.yantar.player',
  appName: 'Amber',
  webDir: 'dist',
  backgroundColor: '#0E0D0C',
  // Без журнала каждого вызова плагина: в debug-сборке он сериализует ответы (вся медиатека) в консоль
  loggingBehavior: 'none',
  android: {
    backgroundColor: '#0E0D0C',
  },
  plugins: {
    SystemBars: {
      // Capacitor сам кладёт отступы вырезов в CSS-переменные --safe-area-inset-*
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
  },
}

export default config
