// Pure filtering/sorting/selection helpers for the services library and service view.
// Only type imports from "@/", so it also runs under `node --test`.
import type { Service, ServiceType, Vault } from "@/types"
import { buildServiceSearchText, matchesSearch } from "./service-helpers.ts"

export type ServiceSortBy = "name" | "type"
export type ServiceSortOrder = "asc" | "desc" | "none"

export const SERVICE_SORT_BYS: readonly ServiceSortBy[] = ["name", "type"]
export const SERVICE_SORT_ORDERS: readonly ServiceSortOrder[] = ["asc", "desc", "none"]

/** Select value meaning "all service types". Type ids are user-chosen, so the filter state is kept apart from them. */
export const TYPE_FILTER_ALL = "all"

export function isServiceSortBy(value: unknown): value is ServiceSortBy {
  return typeof value === "string" && (SERVICE_SORT_BYS as readonly string[]).includes(value)
}

export function isServiceSortOrder(value: unknown): value is ServiceSortOrder {
  return typeof value === "string" && (SERVICE_SORT_ORDERS as readonly string[]).includes(value)
}

/** asc -> desc -> none -> asc */
export function nextServiceSortOrder(order: ServiceSortOrder): ServiceSortOrder {
  return order === "asc" ? "desc" : order === "desc" ? "none" : "asc"
}

/** The type filter to apply: null (all types) when the stored type no longer exists. */
export function resolveTypeFilter(
  typeId: string | null,
  serviceTypes: readonly Pick<ServiceType, "id">[],
): string | null {
  return typeId !== null && serviceTypes.some((type) => type.id === typeId) ? typeId : null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/** Natural order ("Mail2" before "Mail10"), case-insensitive. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b)
}

export interface ServiceListQuery {
  search: string
  /** null = all types */
  typeId: string | null
  sortBy: ServiceSortBy
  sortOrder: ServiceSortOrder
}

/**
 * Filters by type and search text (label, tags, type name and NON-secret field values; every term
 * must match), then sorts with pinned services first. Within each group the order is by label or
 * type name (asc/desc), or the vault order for "none".
 */
export function filterAndSortServices<T extends Service>(
  services: readonly T[],
  serviceTypes: readonly ServiceType[],
  query: ServiceListQuery,
): T[] {
  const typesById = new Map(serviceTypes.map((type) => [type.id, type]))
  const search = query.search.trim()
  const filtered = services.filter(
    (service) =>
      (query.typeId === null || service.serviceTypeId === query.typeId) &&
      (!search || matchesSearch(buildServiceSearchText(service, typesById.get(service.serviceTypeId)), search)),
  )
  // Array.prototype.sort is stable, so "none" keeps the vault order inside each group.
  return filtered.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    if (query.sortOrder === "none") return 0
    let result: number
    if (query.sortBy === "type") {
      const typeA = typesById.get(a.serviceTypeId)?.name ?? ""
      const typeB = typesById.get(b.serviceTypeId)?.name ?? ""
      result = naturalCompare(typeA, typeB) || naturalCompare(a.label, b.label)
    } else {
      result = naturalCompare(a.label, b.label)
    }
    return query.sortOrder === "asc" ? result : -result
  })
}

/**
 * Keeps only the selected ids that are still visible. Returns the SAME set when nothing changed,
 * so it can be used in a state updater without causing a re-render loop.
 */
export function pruneSelection(selected: ReadonlySet<string>, visibleIds: Iterable<string>): ReadonlySet<string> {
  if (selected.size === 0) return selected
  const visible = new Set(visibleIds)
  let changed = false
  const next = new Set<string>()
  for (const id of selected) {
    if (visible.has(id)) next.add(id)
    else changed = true
  }
  return changed ? next : selected
}

export interface ServiceReferences {
  /** Accounts that link the service. */
  accountIds: string[]
  /** Other services whose linked_service fields point to the service. */
  serviceIds: string[]
}

/**
 * Who refers to a service: accounts that link it, and other services that point to it through a
 * `linked_service` field of their type.
 */
export function findServiceReferences(
  vault: Pick<Vault, "accounts" | "services" | "serviceTypes"> | null | undefined,
  serviceId: string,
): ServiceReferences {
  if (!vault) return { accountIds: [], serviceIds: [] }
  const accountIds = vault.accounts.filter((account) => account.linkedServices.includes(serviceId)).map((a) => a.id)
  const typesById = new Map(vault.serviceTypes.map((type) => [type.id, type]))
  const serviceIds = vault.services
    .filter((service) => {
      if (service.id === serviceId) return false
      const type = typesById.get(service.serviceTypeId)
      if (!type) return false
      return type.fields.some((field) => field.type === "linked_service" && service.data[field.key] === serviceId)
    })
    .map((s) => s.id)
  return { accountIds, serviceIds }
}

/** Accounts linking at least one of the given services (each counted once). */
export function countLinkedAccounts(
  vault: Pick<Vault, "accounts"> | null | undefined,
  serviceIds: Iterable<string>,
): number {
  if (!vault) return 0
  const ids = new Set(serviceIds)
  return vault.accounts.filter((account) => account.linkedServices.some((id) => ids.has(id))).length
}
