import { test } from "node:test"
import assert from "node:assert/strict"
import type { Account, Service, ServiceType, Vault } from "../types/index.ts"
import {
  filterPaletteActions,
  firstPaletteItem,
  getPaletteIndex,
  searchPalette,
} from "../lib/palette-search.ts"

const proxyType: ServiceType = {
  id: "proxy",
  name: "Proxy",
  icon: "",
  fields: [
    { id: "p-1", key: "proxy", label: "Proxy String", type: "secret", masked: true, required: true },
  ],
}

const account = (id: string, label: string, linkedServices: string[], updatedAt: number, pinned = false): Account => ({
  id,
  label,
  notes: "",
  tags: [],
  linkedServices,
  pinned,
  createdAt: 1,
  updatedAt,
})

const service = (id: string, label: string, proxy: string, updatedAt: number): Service => ({
  id,
  serviceTypeId: "proxy",
  label,
  data: { proxy },
  tags: [],
  pinned: false,
  createdAt: 1,
  updatedAt,
})

// Mirrors the e2e data: Farm2024-5 has more links and is listed (and updated) before Farm2024-6.
const vault: Vault = {
  version: "0.3.0",
  serviceTypes: [proxyType],
  services: [
    service("s5", "px-5", "http://1.1.1.5:80", 10),
    service("s6", "px-6", "http://1.1.1.6:80", 11),
    service("s7", "px-7", "http://1.1.1.7:80", 12),
  ],
  accounts: [
    account("a5", "Farm2024-5", ["s5", "s6"], 30),
    account("a6", "Farm2024-6", ["s6"], 20),
    account("a7", "Farm2024-7", ["s7"], 10),
    account("p", "Pinned old", [], 1, true),
  ],
  settings: { autoLockMinutes: 15, clipboardClearSeconds: 30 },
}

const actions = [
  { id: "new-account", label: "New account", keywords: "new account create add" },
  { id: "lock", label: "Lock vault", keywords: "lock vault" },
]

test("the exact label is the best match, ahead of near misses", () => {
  const index = getPaletteIndex(vault)
  const results = searchPalette(index, "Farm2024-6")
  assert.equal(results.accounts[0]?.label, "Farm2024-6")
  // Near misses are still listed, which is why the palette must re-highlight the first row.
  assert.ok(results.accounts.some((e) => e.label === "Farm2024-5"))
})

test("the index is cached per vault object", () => {
  assert.equal(getPaletteIndex(vault), getPaletteIndex(vault))
  assert.notEqual(getPaletteIndex(vault), getPaletteIndex({ ...vault }))
})

test("an empty query lists pinned, then recently updated items", () => {
  const results = searchPalette(getPaletteIndex(vault), "   ")
  assert.deepEqual(
    results.accounts.map((e) => e.label),
    ["Pinned old", "Farm2024-5", "Farm2024-6", "Farm2024-7"],
  )
  assert.deepEqual(
    results.services.map((e) => e.label),
    ["px-7", "px-6", "px-5"],
  )
})

test("secret field values are not searchable", () => {
  const results = searchPalette(getPaletteIndex(vault), "1.1.1.6")
  assert.deepEqual(results, { accounts: [], services: [] })
})

test("firstPaletteItem follows the display order: actions, accounts, services", () => {
  const index = getPaletteIndex(vault)
  const farm = searchPalette(index, "Farm2024-6")
  assert.equal(filterPaletteActions(actions, "Farm2024-6").length, 0)
  assert.equal(firstPaletteItem(filterPaletteActions(actions, "Farm2024-6"), farm)?.value, "account:a6")

  const lock = searchPalette(index, "lock")
  const first = firstPaletteItem(filterPaletteActions(actions, "lock"), lock)
  assert.equal(first?.value, "action:lock")
  assert.equal(first?.kind === "action" && first.action.id, "lock")

  const px = searchPalette(index, "px-6")
  assert.equal(firstPaletteItem([], px)?.value, "service:s6")

  assert.equal(firstPaletteItem([], { accounts: [], services: [] }), null)
})

test("filterPaletteActions keeps every action for an empty query", () => {
  assert.equal(filterPaletteActions(actions, " ").length, 2)
  assert.deepEqual(
    filterPaletteActions(actions, "create").map((a) => a.id),
    ["new-account"],
  )
})
