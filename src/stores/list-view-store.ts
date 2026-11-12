// What the Accounts and Services list pages currently show (search text, tag/type filter, sort).
// Shared with the detail pages, whose Previous/Next buttons walk the list in the same order.
//
// Persistence rules:
// - Sort order (accounts, services) and the service type filter are UI preferences: kept in
//   localStorage.
// - Search text and the tag filter are vault content: kept in memory only (surviving navigation
//   within the session) and dropped on lock. Older versions persisted them in localStorage.
import { create } from "zustand"
import { useVaultStore } from "@/stores/vault-store"
import { isAccountSortOrder, type AccountSortOrder } from "@/lib/account-list"
import {
  TYPE_FILTER_ALL,
  isServiceSortBy,
  isServiceSortOrder,
  type ServiceSortBy,
  type ServiceSortOrder,
} from "@/lib/service-list"

const ACCOUNTS_SORT_ORDER_KEY = "accounts-sort-order"
const SERVICES_SORT_ORDER_KEY = "services-sort-order"
const SERVICES_SORT_BY_KEY = "services-sort-by"
const SERVICES_TYPE_FILTER_KEY = "services-selected-type"

try {
  localStorage.removeItem("accounts-search-term")
  localStorage.removeItem("accounts-selected-tag")
  localStorage.removeItem("services-search-query")
} catch {
  // Storage unavailable: nothing to clean up.
}

function readStored<T>(key: string, guard: (value: unknown) => value is T, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return guard(stored) ? stored : fallback
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preferences are optional; the in-memory value still applies.
  }
}

function readTypeFilter(): string | null {
  try {
    const stored = localStorage.getItem(SERVICES_TYPE_FILTER_KEY)
    return stored && stored !== TYPE_FILTER_ALL ? stored : null
  } catch {
    return null
  }
}

interface AccountsListView {
  /** In memory only. */
  search: string
  /** In memory only; null = all tags. May name a tag that no longer exists (resolve before use). */
  tag: string | null
  /** Persisted. */
  sort: AccountSortOrder
  setSearch: (search: string) => void
  setTag: (tag: string | null) => void
  setSort: (sort: AccountSortOrder) => void
}

export const useAccountsListView = create<AccountsListView>((set) => ({
  search: "",
  tag: null,
  sort: readStored(ACCOUNTS_SORT_ORDER_KEY, isAccountSortOrder, "asc"),
  setSearch: (search) => set({ search }),
  setTag: (tag) => set({ tag }),
  setSort: (sort) => {
    writeStored(ACCOUNTS_SORT_ORDER_KEY, sort)
    set({ sort })
  },
}))

interface ServicesListView {
  /** In memory only. */
  search: string
  /** Persisted; null = all types. May name a type that no longer exists (resolve before use). */
  typeId: string | null
  /** Persisted. */
  sortBy: ServiceSortBy
  /** Persisted. */
  sortOrder: ServiceSortOrder
  setSearch: (search: string) => void
  setTypeId: (typeId: string | null) => void
  setSortBy: (sortBy: ServiceSortBy) => void
  setSortOrder: (sortOrder: ServiceSortOrder) => void
}

export const useServicesListView = create<ServicesListView>((set) => ({
  search: "",
  typeId: readTypeFilter(),
  sortBy: readStored(SERVICES_SORT_BY_KEY, isServiceSortBy, "name"),
  sortOrder: readStored(SERVICES_SORT_ORDER_KEY, isServiceSortOrder, "asc"),
  setSearch: (search) => set({ search }),
  setTypeId: (typeId) => {
    writeStored(SERVICES_TYPE_FILTER_KEY, typeId ?? TYPE_FILTER_ALL)
    set({ typeId })
  },
  setSortBy: (sortBy) => {
    writeStored(SERVICES_SORT_BY_KEY, sortBy)
    set({ sortBy })
  },
  setSortOrder: (sortOrder) => {
    writeStored(SERVICES_SORT_ORDER_KEY, sortOrder)
    set({ sortOrder })
  },
}))

// Locking drops the in-memory parts; the persisted preferences stay.
useVaultStore.subscribe((state, prev) => {
  if (prev.vault && !state.vault) {
    useAccountsListView.setState({ search: "", tag: null })
    useServicesListView.setState({ search: "" })
  }
})
