/**
 * Синхронизация папки с музыкой между телефоном и компьютером по Wi-Fi: что делать с каждым файлом.
 *
 * Сравниваются три списка: файлы здесь (local), там (remote) и то, какими они были после прошлой удачной
 * синхронизации (base). Без base нельзя отличить «удалили там» от «появилось здесь» — поэтому он хранит
 * для каждого файла размер и время изменения на обеих сторонах отдельно (часы и точность времени у телефона
 * и компьютера разные, сравниваем каждую сторону только с ней самой).
 *
 * Правила, чтобы ничего не потерялось:
 *  - файл поменяли с одной стороны — копируем на другую; старая версия там уходит в корзину, а не затирается;
 *  - поменяли с обеих сторон (конфликт) — побеждает более новый, проигравший тоже уходит в корзину;
 *  - удалили с одной стороны — удаляем (в корзину) с другой, но только если там его с тех пор не меняли;
 *    поменяли — наоборот, возвращаем удалённое;
 *  - при первой встрече одинаковые файлы (размер и время, как их оставил Syncthing) просто запоминаются,
 *    при одинаковом размере и разном времени решает сравнение содержимого;
 *  - папка с одной стороны вдруг пуста, хотя раньше в ней были файлы (карту вынули, пропал доступ) — ничего
 *    не делаем; удалений слишком много — без подтверждения не удаляем.
 *
 * Модуль без зависимостей: его гоняют тесты (tests/filesync.test.ts).
 */

export interface Stat {
  /** Размер, байт */
  s: number
  /** Время изменения, мс */
  m: number
}

export interface FileEntry extends Stat {
  /** Путь от корня папки, через «/» */
  p: string
}

export interface BaseEntry {
  /** Путь (как на этом устройстве) */
  p: string
  l: Stat
  r: Stat
}

export type Action =
  /** Совпадают — просто запомнить */
  | { op: 'adopt'; lp: string; rp: string; l: Stat; r: Stat }
  /** Размер одинаковый, время разное: решит сравнение содержимого */
  | { op: 'verify'; lp: string; rp: string; l: Stat; r: Stat; conflict: boolean }
  /** Оттуда сюда. expect — каким здесь должен оставаться файл (null — его здесь нет) */
  | { op: 'pull'; lp: string; rp: string; from: Stat; expect: Stat | null; conflict: boolean }
  /** Отсюда туда */
  | { op: 'push'; lp: string; rp: string; from: Stat; expect: Stat | null; conflict: boolean }
  /** Удалили там — здесь в корзину */
  | { op: 'trashLocal'; lp: string; expect: Stat }
  /** Удалили здесь — там в корзину */
  | { op: 'trashRemote'; rp: string; expect: Stat }
  /** Файла больше нет нигде — забыть */
  | { op: 'forget'; key: string }

export interface Plan {
  actions: Action[]
  /** Удаления, которые ждут подтверждения (их слишком много) */
  held: Action[]
  /** Файлы, которые не трогаем, и почему */
  skipped: { p: string; why: string }[]
  /** Одна из папок пуста, хотя раньше в ней были файлы: ничего не делаем */
  error?: 'localEmpty' | 'remoteEmpty'
}

/** Ключ файла: одинаковый для «Song.mp3» и «song.mp3» — и на Windows, и в памяти телефона регистр не различается */
export function keyOf(p: string): string {
  return p.normalize('NFC').toLowerCase()
}

/** Служебное и временное не синхронизируем: скрытые файлы и папки (.stfolder, .amber-trash), недокачанное */
export function ignored(p: string): boolean {
  const parts = p.split('/')
  const name = parts[parts.length - 1]!.toLowerCase()
  return (
    parts.some((x) => x.startsWith('.') || x === '') ||
    name === 'desktop.ini' ||
    name === 'thumbs.db' ||
    name.endsWith('.amber-part') ||
    name.endsWith('.tmp')
  )
}

/** Имя, которое Windows не создаст: такие файлы с телефона на компьютер не передаются */
export function badOnWindows(p: string): boolean {
  return p.split('/').some((x) => /[<>:"\\|?*\u0000-\u001f]/.test(x) || /[. ]$/.test(x))
}

/** Та же сторона, тот же файл: время файловой системы того же устройства сравниваем с допуском на округление */
export function same(a: Stat, b: Stat): boolean {
  return a.s === b.s && Math.abs(a.m - b.m) < 1000
}

/** Разные устройства: Syncthing переносит время изменения, но FAT и телефоны округляют до 2 с */
function looksIdentical(a: Stat, b: Stat): boolean {
  return a.s === b.s && Math.abs(a.m - b.m) <= 2000
}

/** Сколько удалений за раз можно без подтверждения */
export function deleteLimit(baseSize: number): number {
  return Math.max(20, Math.floor(baseSize * 0.1))
}

function index(list: FileEntry[], skipped: Plan['skipped']): Map<string, FileEntry> {
  const out = new Map<string, FileEntry>()
  const clash = new Set<string>()
  for (const f of list) {
    if (ignored(f.p)) continue
    const k = keyOf(f.p)
    if (out.has(k)) clash.add(k)
    else out.set(k, f)
  }
  // Два файла, которые различаются только регистром: на другой стороне это один файл — не трогаем оба
  for (const k of clash) {
    skipped.push({ p: out.get(k)!.p, why: 'есть файл с тем же именем в другом регистре' })
    out.delete(k)
  }
  return out
}

export function makePlan(
  local: FileEntry[],
  remote: FileEntry[],
  base: BaseEntry[],
  opts: { confirmDeletes?: boolean } = {},
): Plan {
  const skipped: Plan['skipped'] = []
  const L = index(local, skipped)
  const R = index(remote, skipped)
  const B = new Map(base.map((b) => [keyOf(b.p), b]))

  // Папка вдруг пуста, а раньше файлы были: скорее всего, она недоступна. Удалять по такому списку нельзя
  // (очистить папку целиком можно только с подтверждением)
  if (B.size && !opts.confirmDeletes) {
    if (!L.size) return { actions: [], held: [], skipped, error: 'localEmpty' }
    if (!R.size) return { actions: [], held: [], skipped, error: 'remoteEmpty' }
  }

  const actions: Action[] = []
  const deletes: Action[] = []
  const keys = new Set([...L.keys(), ...R.keys(), ...B.keys()])
  for (const k of keys) {
    const l = L.get(k)
    const r = R.get(k)
    const b = B.get(k)
    if (l && r) {
      const cl = !b || !same(l, b.l)
      const cr = !b || !same(r, b.r)
      if (b && !cl && !cr) continue
      if (b && cl && !cr) {
        actions.push({ op: 'push', lp: l.p, rp: r.p, from: l, expect: r, conflict: false })
      } else if (b && !cl && cr) {
        actions.push({ op: 'pull', lp: l.p, rp: r.p, from: r, expect: l, conflict: false })
      } else if (looksIdentical(l, r)) {
        // Первая встреча или поменяли одинаково с обеих сторон
        actions.push({ op: 'adopt', lp: l.p, rp: r.p, l, r })
      } else if (l.s === r.s) {
        actions.push({ op: 'verify', lp: l.p, rp: r.p, l, r, conflict: !!b })
      } else {
        // Разное содержимое: побеждает более новый, старый уходит в корзину на своей стороне
        actions.push(winner(l, r, !!b))
      }
    } else if (l) {
      if (badOnWindows(l.p)) {
        skipped.push({ p: l.p, why: 'имя недопустимо в Windows' })
        continue
      }
      if (b && same(l, b.l)) deletes.push({ op: 'trashLocal', lp: l.p, expect: l })
      // Новый здесь — или там удалили, а здесь его с тех пор поменяли: тогда возвращаем
      else actions.push({ op: 'push', lp: l.p, rp: l.p, from: l, expect: null, conflict: false })
    } else if (r) {
      if (b && same(r, b.r)) deletes.push({ op: 'trashRemote', rp: r.p, expect: r })
      else actions.push({ op: 'pull', lp: r.p, rp: r.p, from: r, expect: null, conflict: false })
    } else {
      actions.push({ op: 'forget', key: k })
    }
  }

  const heldAll = !opts.confirmDeletes && deletes.length > deleteLimit(B.size)
  return {
    actions: [...actions.sort(order), ...(heldAll ? [] : deletes)],
    held: heldAll ? deletes : [],
    skipped,
  }
}

function winner(l: FileEntry, r: FileEntry, conflict: boolean): Action {
  return l.m >= r.m
    ? { op: 'push', lp: l.p, rp: r.p, from: l, expect: r, conflict }
    : { op: 'pull', lp: l.p, rp: r.p, from: r, expect: l, conflict }
}

/** Сначала то, что ничего не стоит (запомнить, забыть), потом передачи по пути — папки складываются по порядку */
function order(a: Action, b: Action): number {
  const rank = (x: Action) => (x.op === 'forget' || x.op === 'adopt' ? 0 : x.op === 'verify' ? 1 : 2)
  const path = (x: Action) => ('lp' in x ? x.lp : 'rp' in x ? x.rp : x.key)
  return rank(a) - rank(b) || path(a).localeCompare(path(b))
}
