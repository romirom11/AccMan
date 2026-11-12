// Search model of the command palette. Only type imports from "@/", so it also runs under
// `node --test`.
import Fuse from "fuse.js"
import type { ServiceType, Vault } from "@/types"
import {
  buildAccountSearchText,
  buildServiceSearchText,
  compareByPinnedAndRecent,
  getServiceTitle,
  matchesSearch,
} from "./service-helpers.ts"

export interface PaletteEntry {
  kind: "account" | "service"
  id: string
  title: string
  typeName: string
  tags: string[]
  /** Non-secret search text (see service-helpers). */
  text: string
  pinned: boolean
  updatedAt: number
  label: string
  linkedCount: number
}

export interface PaletteIndex {
  entries: PaletteEntry[]
  fuse: Fuse<PaletteEntry>
}

export interface PaletteResults {
  accounts: PaletteEntry[]
  services: PaletteEntry[]
}

/** An action row of the palette: what `filterPaletteActions` needs to know about it. */
export interface PaletteActionLike {
  id: string
  label: string
  keywords: string
}

export const EMPTY_QUERY_LIMIT = 6
export const ACCOUNT_LIMIT = 15
export const SERVICE_LIMIT = 25

// Every mutation returns a new vault object, so the cache never serves stale data.
const indexCache = new WeakMap<Vault, PaletteIndex>()

function buildEntries(vault: Vault): PaletteEntry[] {
  const typesById = new Map<string, ServiceType>(vault.serviceTypes.map((type) => [type.id, type]))
  const accounts: PaletteEntry[] = vault.accounts.map((account) => ({
    kind: "account",
    id: account.id,
    title: account.label,
    label: account.label,
    typeName: "",
    tags: account.tags,
    text: buildAccountSearchText(account),
    pinned: account.pinned,
    updatedAt: account.updatedAt,
    linkedCount: account.linkedServices.length,
  }))
  const services: PaletteEntry[] = vault.services.map((service) => {
    const type = typesById.get(service.serviceTypeId)
    const title = getServiceTitle(service, type)
    return {
      kind: "service",
      id: service.id,
      title,
      label: title,
      typeName: type?.name ?? "",
      tags: service.tags,
      text: buildServiceSearchText(service, type),
      pinned: service.pinned,
      updatedAt: service.updatedAt,
      linkedCount: 0,
    }
  })
  return [...accounts, ...services]
}

/** Built lazily (only while the palette is open), once per vault object. */
export function getPaletteIndex(vault: Vault): PaletteIndex {
  let index = indexCache.get(vault)
  if (!index) {
    const entries = buildEntries(vault)
    const fuse = new Fuse(entries, {
      keys: [
        { name: "title", weight: 3 },
        { name: "tags", weight: 2 },
        { name: "typeName", weight: 1.5 },
        { name: "text", weight: 1 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
    })
    index = { entries, fuse }
    indexCache.set(vault, index)
  }
  return index
}

/** Best matches first; with an empty query the pinned and most recently updated items. */
export function searchPalette({ entries, fuse }: PaletteIndex, query: string): PaletteResults {
  const trimmed = query.trim()
  if (!trimmed) {
    const byRecent = (kind: PaletteEntry["kind"]) =>
      entries
        .filter((e) => e.kind === kind)
        .sort(compareByPinnedAndRecent)
        .slice(0, EMPTY_QUERY_LIMIT)
    return { accounts: byRecent("account"), services: byRecent("service") }
  }
  const results = fuse.search(trimmed).map((r) => r.item)
  return {
    accounts: results.filter((e) => e.kind === "account").slice(0, ACCOUNT_LIMIT),
    services: results.filter((e) => e.kind === "service").slice(0, SERVICE_LIMIT),
  }
}

export function filterPaletteActions<A extends PaletteActionLike>(actions: A[], query: string): A[] {
  const trimmed = query.trim()
  return trimmed ? actions.filter((action) => matchesSearch(`${action.label}\n${action.keywords}`, trimmed)) : actions
}

/** cmdk item values; `firstPaletteItem` and the rendered rows must agree on them. */
export const actionItemValue = (id: string) => `action:${id}`
export const accountItemValue = (id: string) => `account:${id}`
export const serviceItemValue = (id: string) => `service:${id}`

export type PaletteItem<A> =
  | { kind: "action"; value: string; action: A }
  | { kind: "account" | "service"; value: string; entry: PaletteEntry }

/** The top row in display order (actions, accounts, services): what Enter opens after typing. */
export function firstPaletteItem<A extends { id: string }>(
  actions: A[],
  { accounts, services }: PaletteResults,
): PaletteItem<A> | null {
  if (actions.length > 0) return { kind: "action", value: actionItemValue(actions[0].id), action: actions[0] }
  if (accounts.length > 0) return { kind: "account", value: accountItemValue(accounts[0].id), entry: accounts[0] }
  if (services.length > 0) return { kind: "service", value: serviceItemValue(services[0].id), entry: services[0] }
  return null
}
