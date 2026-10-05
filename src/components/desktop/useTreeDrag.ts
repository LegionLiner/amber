import { onBeforeUnmount, ref, type Ref } from 'vue'
import type { PlaylistGroupRow, PlaylistRow } from '@/data/repos/playlists'
import { gKey, pKey, type Drop } from '@/domain/playlist-tree'

/**
 * Перетаскивание в боковом меню: плейлисты — между собой, в группу и из неё, в закреплённые и обратно;
 * группы — между плейлистами и другими группами. Мышью: нажал и повёл — поехало (короткий клик
 * по-прежнему открывает плейлист). Куда встанет — показывает линия или подсветка группы.
 *
 * Цель ищется по элементу под курсором: у строк есть data-drop (row, group, group-end, pinzone, end),
 * data-zone (pinned, root, group), data-key (p:<id> / g:<created_at>) и data-group.
 */
export type Dragged = { kind: 'playlist'; p: PlaylistRow } | { kind: 'group'; g: PlaylistGroupRow }

export interface DropTarget {
  /** Что подсветить: ключ строки, 'pinzone' или 'end' */
  mark: string
  mode: 'before' | 'after' | 'into' | 'zone'
  drop: Drop
}

export function useTreeDrag(opts: {
  /** Прокручиваемый список */
  listEl: Ref<HTMLElement | null>
  /** Где искать цели: список и его заголовок (там — зона «закрепить», пока закреплённых нет) */
  rootEl: Ref<HTMLElement | null>
  /** Первый плейлист группы — перенос «в группу» ставит наверх */
  firstInGroup: (groupAt: number) => string | null
  onDrop: (item: Dragged, drop: Drop) => void | Promise<void>
}) {
  const drag = ref<{ item: Dragged; x: number; y: number } | null>(null)
  const target = ref<DropTarget | null>(null)
  let press: { x: number; y: number; item: Dragged } | null = null
  let lastY = 0
  let lastX = 0
  let raf = 0
  /** С какого момента курсор стоит у края списка: прокрутка — только если задержался там */
  let edgeSince = 0
  /** Отпустили после перетаскивания: клик, который придёт следом, не должен открывать плейлист */
  let swallowClick = false

  function down(e: PointerEvent, item: Dragged) {
    if (e.button !== 0 || e.pointerType !== 'mouse') return
    press = { x: e.clientX, y: e.clientY, item }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key)
  }

  function move(e: PointerEvent) {
    if (!press) return
    if (!drag.value) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return
      drag.value = { item: press.item, x: e.clientX, y: e.clientY }
      document.documentElement.classList.add('tree-dragging')
      raf = requestAnimationFrame(autoScroll)
    }
    drag.value.x = lastX = e.clientX
    drag.value.y = lastY = e.clientY
    target.value = resolve(e.clientX, e.clientY)
  }

  function up() {
    const d = drag.value
    const t = target.value
    stop()
    if (!d) return
    swallowClick = true
    setTimeout(() => (swallowClick = false), 0)
    if (t) void opts.onDrop(d.item, t.drop)
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') stop()
  }

  function stop() {
    press = null
    edgeSince = 0
    drag.value = null
    target.value = null
    cancelAnimationFrame(raf)
    document.documentElement.classList.remove('tree-dragging')
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('keydown', key)
  }
  onBeforeUnmount(stop)

  /**
   * У краёв списка он сам прокручивается — если курсор задержался у края на четверть секунды:
   * иначе список уезжал бы из-под руки, когда просто ведёшь плейлист на нижнюю строку
   */
  function autoScroll() {
    const el = opts.listEl.value
    if (!el || !drag.value) return
    const r = el.getBoundingClientRect()
    const edge = 28
    const inside = lastX >= r.left && lastX <= r.right
    const up = inside && lastY < r.top + edge && lastY > r.top - 40
    const dn = inside && lastY > r.bottom - edge && lastY < r.bottom + 40
    if (!up && !dn) edgeSince = 0
    else if (!edgeSince) edgeSince = performance.now()
    else if (performance.now() - edgeSince > 250) {
      if (up) el.scrollTop -= Math.ceil((r.top + edge - lastY) / 6)
      else el.scrollTop += Math.ceil((lastY - (r.bottom - edge)) / 6)
      if (drag.value) target.value = resolve(lastX, lastY)
    }
    raf = requestAnimationFrame(autoScroll)
  }

  function resolve(x: number, y: number): DropTarget | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')
    const item = drag.value?.item
    if (!el || !item || !opts.rootEl.value?.contains(el)) return null
    const r = el.getBoundingClientRect()
    const rel = (y - r.top) / Math.max(1, r.height)
    const side: 'before' | 'after' = rel < 0.5 ? 'before' : 'after'
    const kind = el.dataset.drop
    const ref = el.dataset.key ?? null
    const group = el.dataset.group != null ? Number(el.dataset.group) : null

    if (item.kind === 'playlist') {
      const self = pKey(item.p.id)
      if (kind === 'row' && ref) {
        if (ref === self) return null
        const zone = el.dataset.zone
        if (zone === 'pinned') return { mark: ref, mode: side, drop: { zone: 'pinned', ref, side } }
        if (zone === 'group' && group != null)
          return { mark: ref, mode: side, drop: { zone: 'group', groupAt: group, ref, side } }
        return { mark: ref, mode: side, drop: { zone: 'root', ref, side } }
      }
      if (kind === 'group' && ref && group != null) {
        // Верхняя кромка заголовка — встать перед группой, остальное — внутрь, наверх
        if (rel < 0.3) return { mark: ref, mode: 'before', drop: { zone: 'root', ref, side: 'before' } }
        return { mark: ref, mode: 'into', drop: { zone: 'group', groupAt: group, ref: opts.firstInGroup(group), side: 'before' } }
      }
      if (kind === 'group-end' && group != null)
        return { mark: gKey(group), mode: 'into', drop: { zone: 'group', groupAt: group } }
      if (kind === 'pinzone') return { mark: 'pinzone', mode: 'zone', drop: { zone: 'pinned' } }
      if (kind === 'end') return { mark: 'end', mode: 'zone', drop: { zone: 'root' } }
      return null
    }

    // Группа встаёт только среди групп и плейлистов вне групп
    const self = gKey(item.g.createdAt)
    if (kind === 'row' && el.dataset.zone === 'pinned') return null
    if ((kind === 'row' && el.dataset.zone === 'group') || kind === 'group-end') {
      if (group == null || group === item.g.createdAt) return null
      const gk = gKey(group)
      return { mark: gk, mode: 'after', drop: { zone: 'root', ref: gk, side: 'after' } }
    }
    if ((kind === 'row' || kind === 'group') && ref) {
      if (ref === self) return null
      return { mark: ref, mode: side, drop: { zone: 'root', ref, side } }
    }
    if (kind === 'end') return { mark: 'end', mode: 'zone', drop: { zone: 'root' } }
    return null
  }

  /** Класс строки: её тянут, или перед/после неё встанет, или в неё (группа) */
  function markOf(key: string): string | undefined {
    const d = drag.value?.item
    if (d && (d.kind === 'playlist' ? pKey(d.p.id) : gKey(d.g.createdAt)) === key) return 'lifted'
    const t = target.value
    if (!t || t.mark !== key) return undefined
    return `drop-${t.mode}`
  }

  return { drag, target, down, markOf, swallowed: () => swallowClick }
}
