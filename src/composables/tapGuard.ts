/**
 * Защита от случайных нажатий.
 *
 * 1. Список едет по инерции, палец касается экрана, чтобы его остановить, — это не нажатие.
 *    Chrome гасит обычный click в таком случае не всегда, а наши жесты (строки треков, звёзды)
 *    и вовсе строятся на pointer-событиях. Поэтому помним, когда последний раз что-то прокручивалось,
 *    и касание, начатое во время прокрутки, не считается тапом.
 * 2. Только что открытый слой (плеер, шторка) не должен ловить click от того же касания,
 *    которое его открыло: браузер присылает click уже после pointerup — и он попадал в новую кнопку.
 */

let lastScroll = 0
let downAt = 0
let downDuringScroll = false
let blockUntil = 0

/** Касание началось, пока что-то прокручивалось (или сразу после) */
export function touchStoppedScroll(): boolean {
  return downDuringScroll
}

export function scrolledRecently(ms = 160): boolean {
  return performance.now() - lastScroll < ms
}

/** Не пропускать click ближайшие ms: слой только что открылся под пальцем */
export function blockClicks(ms = 400): void {
  blockUntil = performance.now() + ms
}

let installed = false
export function installTapGuard(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('scroll', () => (lastScroll = performance.now()), { capture: true, passive: true })
  document.addEventListener(
    'pointerdown',
    (e) => {
      downAt = performance.now()
      // Мышью инерцию не останавливают: клик сразу после колёсика — обычный клик
      downDuringScroll = e.pointerType !== 'mouse' && scrolledRecently()
    },
    { capture: true, passive: true },
  )
  document.addEventListener(
    'click',
    (e) => {
      const fromScrollStop = downDuringScroll && performance.now() - downAt < 1500
      if (fromScrollStop || performance.now() < blockUntil) {
        e.stopPropagation()
        e.preventDefault()
      }
    },
    { capture: true },
  )
}
