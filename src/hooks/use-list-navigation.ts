import { useMemo } from "react"
import { useVaultStore } from "@/stores/vault-store"
import { useAccountsListView, useServicesListView } from "@/stores/list-view-store"
import { collectAccountTags, filterAndSortAccounts, resolveTagFilter } from "@/lib/account-list"
import { filterAndSortServices, resolveTypeFilter } from "@/lib/service-list"
import { findListNeighbors, type ListNeighbors } from "@/lib/list-navigation"

/** Neighbours of an account in the order the Accounts page currently shows. */
export function useAccountNeighbors(id: string | undefined): ListNeighbors {
  const accounts = useVaultStore((s) => s.vault?.accounts)
  const search = useAccountsListView((s) => s.search)
  const storedTag = useAccountsListView((s) => s.tag)
  const sort = useAccountsListView((s) => s.sort)

  return useMemo(() => {
    const list = accounts ?? []
    // Same resolution as the list page: a tag that no longer exists means "all tags".
    const tag = resolveTagFilter(storedTag, collectAccountTags(list))
    const filtered = filterAndSortAccounts(list, { search, tag, sort }).map((a) => a.id)
    return findListNeighbors(id, filtered, () =>
      filterAndSortAccounts(list, { search: "", tag: null, sort }).map((a) => a.id),
    )
  }, [accounts, search, storedTag, sort, id])
}

/** Neighbours of a service in the order the Services page currently shows. */
export function useServiceNeighbors(id: string | undefined): ListNeighbors {
  const services = useVaultStore((s) => s.vault?.services)
  const serviceTypes = useVaultStore((s) => s.vault?.serviceTypes)
  const search = useServicesListView((s) => s.search)
  const storedTypeId = useServicesListView((s) => s.typeId)
  const sortBy = useServicesListView((s) => s.sortBy)
  const sortOrder = useServicesListView((s) => s.sortOrder)

  return useMemo(() => {
    const list = services ?? []
    const types = serviceTypes ?? []
    // Same resolution as the list page: a type that no longer exists means "all types".
    const typeId = resolveTypeFilter(storedTypeId, types)
    const filtered = filterAndSortServices(list, types, { search, typeId, sortBy, sortOrder }).map((s) => s.id)
    return findListNeighbors(id, filtered, () =>
      filterAndSortServices(list, types, { search: "", typeId: null, sortBy, sortOrder }).map((s) => s.id),
    )
  }, [services, serviceTypes, search, storedTypeId, sortBy, sortOrder, id])
}
