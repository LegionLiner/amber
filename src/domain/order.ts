/**
 * Дробный порядок: чтобы поставить элемент между соседями с местами 1 и 2, ему дают 1.5,
 * и перенумеровывать остальных не нужно (для синхронизации это одна изменённая запись, а не все).
 */
export function between(before: number | null | undefined, after: number | null | undefined): number {
  const a = before ?? null
  const b = after ?? null
  if (a != null && b != null) return a === b ? a : (a + b) / 2
  if (a != null) return a + 1
  if (b != null) return b - 1
  return 0
}

/**
 * Место для вставки в список (отсортированный по месту) перед элементом с индексом index;
 * index = длине списка — в конец. Сам переносимый элемент из списка уже исключён.
 */
export function posAt(list: { pos: number | null }[], index: number): number {
  const i = Math.max(0, Math.min(index, list.length))
  return between(i > 0 ? (list[i - 1]!.pos ?? 0) : null, i < list.length ? (list[i]!.pos ?? 0) : null)
}
