// Pure filtering/sorting for the accounts list. Only type imports from "@/", so it also runs
// under `node --test`.
import type { Account } from "@/types"
import { buildAccountSearchText, matchesSearch } from "./service-helpers.ts"

export type AccountSortOrder = "asc" | "desc" | "none"

export const ACCOUNT_SORT_ORDERS: readonly AccountSortOrder[] = ["asc", "desc", "none"]

export function isAccountSortOrder(value: unknown): value is AccountSortOrder {
  return typeof value === "string" && (ACCOUNT_SORT_ORDERS as readonly string[]).includes(value)
}

/** asc -> desc -> none -> asc */
export function nextSortOrder(order: AccountSortOrder): AccountSortOrder {
  return order === "asc" ? "desc" : order === "desc" ? "none" : "asc"
}

/**
 * Select values for the tag filter. Tags are prefixed so that no tag name (not even one equal to
 * the "all" value) can collide with the sentinel.
 */
export const TAG_FILTER_ALL = "all"
const TAG_PREFIX = "tag:"

export function tagFilterValue(tag: string | null): string {
  return tag === null ? TAG_FILTER_ALL : `${TAG_PREFIX}${tag}`
}

export function parseTagFilterValue(value: string): string | null {
  return value.startsWith(TAG_PREFIX) ? value.slice(TAG_PREFIX.length) : null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/** Natural order ("Work2" before "Work10"), case-insensitive. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b)
}

/** All distinct tags of the accounts, naturally sorted. */
export function collectAccountTags(accounts: readonly Pick<Account, "tags">[]): string[] {
  const tags = new Set<string>()
  for (const account of accounts) for (const tag of account.tags) tags.add(tag)
  return [...tags].sort(naturalCompare)
}

/** The tag filter to apply: null (all) when the tag no longer exists on any account. */
export function resolveTagFilter(tag: string | null, availableTags: readonly string[]): string | null {
  return tag !== null && availableTags.includes(tag) ? tag : null
}

export interface AccountListQuery {
  search: string
  /** null = all tags */
  tag: string | null
  sort: AccountSortOrder
}

/**
 * Filters by search text (label, tags, notes; every term must match) and tag, then sorts with
 * pinned accounts first. Within each group the order is by label (asc/desc) or the vault order.
 */
export function filterAndSortAccounts<T extends Account>(accounts: readonly T[], query: AccountListQuery): T[] {
  const search = query.search.trim()
  const filtered = accounts.filter(
    (account) =>
      (query.tag === null || account.tags.includes(query.tag)) &&
      (!search || matchesSearch(buildAccountSearchText(account), search)),
  )
  // Array.prototype.sort is stable, so "none" keeps the vault order inside each group.
  return filtered.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    if (query.sort === "none") return 0
    const byLabel = naturalCompare(a.label, b.label)
    return query.sort === "asc" ? byLabel : -byLabel
  })
}

/**
 * Ids between `fromId` and `toId` (inclusive) in the given visible order, for shift-click range
 * selection. Falls back to just `toId` when the anchor is not visible.
 */
export function rangeBetween(orderedIds: readonly string[], fromId: string | null, toId: string): string[] {
  const to = orderedIds.indexOf(toId)
  if (to === -1) return []
  const from = fromId === null ? -1 : orderedIds.indexOf(fromId)
  if (from === -1) return [toId]
  const [start, end] = from <= to ? [from, to] : [to, from]
  return orderedIds.slice(start, end + 1)
}
