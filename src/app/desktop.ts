import { ref, watch } from 'vue'
import { GLOBAL_SEARCH_ID } from './search-query'
import { MusicCoreWeb } from '@/native/music-core'
import { desktop } from '@/native/desktop/bridge'
import { useLibrary } from '@/stores/library'
import { usePlayer } from '@/stores/player'
import { useUi } from '@/stores/ui'
import { router } from './router'

/**
 * Amber на компьютере: всё, что отличает окно от телефона, кроме раскладки (она в App.vue и desktop/*).
 * Вызывается при запуске только в приложении для ПК.
 */

const VOLUME_KEY = 'amber.volume'

/** Громкость приложения 0…1: ползунок в панели плеера и Ctrl+↑/↓ */
export const volume = ref(readVolume())
/** Громкость до выключения звука — чтобы вернуть её тем же нажатием */
let beforeMute = 0.8

function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY))
    return localStorage.getItem(VOLUME_KEY) != null && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8
  } catch {
    return 0.8
  }
}

export function setVolume(v: number) {
  volume.value = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100
}

export function toggleMute() {
  if (volume.value > 0) {
    beforeMute = volume.value
    setVolume(0)
  } else setVolume(beforeMute || 0.8)
}

export function setupDesktop(): void {
  if (!desktop) return
  document.documentElement.classList.add('desktop')

  // Кнопки окна (свернуть, развернуть, закрыть) рисует Windows: красим их под тему
  const syncTitleBar = () => {
    const cs = getComputedStyle(document.documentElement)
    desktop!.setTitleBar({
      bg: cs.getPropertyValue('--bg').trim() || '#0e0d0c',
      ink: cs.getPropertyValue('--ink').trim() || '#f5f1ea',
    })
  }
  new MutationObserver(syncTitleBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  syncTitleBar()

  void MusicCoreWeb.setVolume({ volume: volume.value })
  watch(volume, (v) => {
    void MusicCoreWeb.setVolume({ volume: v })
    try {
      localStorage.setItem(VOLUME_KEY, String(v))
    } catch {
      /* не страшно */
    }
  })

  // Файлы в папках поменялись (скачал альбом, переименовал) — библиотека обновляется сама
  const library = useLibrary()
  desktop.onFilesChanged(() => {
    if (!library.scanning) void library.scan(false)
  })

  window.addEventListener('keydown', onKey)
  // Боковые кнопки мыши — назад и вперёд по экранам, как в браузере
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) router.back()
    else if (e.button === 4) router.forward()
  })
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/**
 * Горячие клавиши:
 * Пробел — пауза; Ctrl+→/← — следующий/предыдущий; Shift+→/← — перемотка на 10 с; Ctrl+↑/↓ — громкость;
 * Ctrl+F — поиск; Ctrl+L — в избранное; Ctrl+, — настройки; Esc — закрыть верхний слой; Ctrl+Q — выйти.
 */
function onKey(e: KeyboardEvent) {
  const player = usePlayer()
  const ui = useUi()
  const ctrl = e.ctrlKey || e.metaKey
  if (ctrl && e.code === 'KeyQ') {
    e.preventDefault()
    desktop?.quit()
    return
  }
  if (e.key === 'Escape') {
    if (ui.back()) e.preventDefault()
    return
  }
  if (ctrl && e.code === 'KeyF') {
    e.preventDefault()
    ui.fullPlayer = false
    ui.queueOpen = false
    // Курсор — в поле строки заголовка: оно само откроет раздел поиска
    const field = document.getElementById(GLOBAL_SEARCH_ID) as HTMLInputElement | null
    if (field) {
      field.focus()
      field.select()
    } else void router.push('/search')
    return
  }
  if (ctrl && e.key === ',') {
    e.preventDefault()
    void router.push('/settings')
    return
  }
  if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault()
    router.back()
    return
  }
  if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault()
    router.forward()
    return
  }
  if (typing(e.target)) return
  if (e.code === 'Space') {
    e.preventDefault()
    if (player.hasTrack) void player.toggle()
    return
  }
  if (ctrl && e.key === 'ArrowRight') {
    e.preventDefault()
    void player.next()
  } else if (ctrl && e.key === 'ArrowLeft') {
    e.preventDefault()
    void player.prev()
  } else if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault()
    const to = player.position + (e.key === 'ArrowRight' ? 10_000 : -10_000)
    void player.seek(Math.max(0, Math.min(player.durationMs - 500, to)))
  } else if (ctrl && e.key === 'ArrowUp') {
    e.preventDefault()
    setVolume(volume.value + 0.05)
  } else if (ctrl && e.key === 'ArrowDown') {
    e.preventDefault()
    setVolume(volume.value - 0.05)
  } else if (ctrl && e.code === 'KeyL') {
    e.preventDefault()
    const t = player.currentTrack
    if (t) void useLibrary().toggleFavorite(t.key)
  }
}
