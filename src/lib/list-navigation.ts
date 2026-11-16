// Previous/Next navigation between detail pages, in the order a list page shows. Pure and
// dependency-free, so it also runs under `node --test`.

export interface ListNeighbors {
  prevId: string | null
  nextId: string | null
  /** 0-based position of the item in the list used, or -1 when it is in neither list. */
  index: number
  /** Length of the list used (the filtered one when the item is not found anywhere). */
  total: number
  /** True when the item is hidden by the filters and the unfiltered list was used instead. */
  unfiltered: boolean
}

function neighborsIn(orderedIds: readonly string[], index: number, unfiltered: boolean): ListNeighbors {
  return {
    prevId: index > 0 ? orderedIds[index - 1] : null,
    nextId: index < orderedIds.length - 1 ? orderedIds[index + 1] : null,
    index,
    total: orderedIds.length,
    unfiltered,
  }
}

/**
 * Neighbours of `id` in `filteredIds` (what the list page shows). When the item is not in it, e.g.
 * opened from the command palette while a filter hides it, `unfilteredIds` (all items, same sort)
 * is used instead so Previous/Next still work. `unfilteredIds` may be a function, so it is only
 * computed when needed.
 */
export function findListNeighbors(
  id: string | undefined,
  filteredIds: readonly string[],
  unfilteredIds: readonly string[] | (() => readonly string[]),
): ListNeighbors {
  if (id === undefined) return { prevId: null, nextId: null, index: -1, total: filteredIds.length, unfiltered: false }
  const index = filteredIds.indexOf(id)
  if (index !== -1) return neighborsIn(filteredIds, index, false)
  const all = typeof unfilteredIds === "function" ? unfilteredIds() : unfilteredIds
  const fallbackIndex = all.indexOf(id)
  if (fallbackIndex !== -1) return neighborsIn(all, fallbackIndex, true)
  return { prevId: null, nextId: null, index: -1, total: filteredIds.length, unfiltered: false }
}
