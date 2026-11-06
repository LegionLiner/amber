/**
 * Сборка для Google Play (npm run aab → vite build --mode play, .env.play): без загрузки с YouTube и без своего
 * сервера синхронизации — по правилам магазина и потому что публичная версия работает без серверов.
 * Данные между телефоном и компьютером идут через «Компьютер по Wi-Fi» — это есть везде.
 */
export const playBuild = import.meta.env.VITE_STORE === 'play'
