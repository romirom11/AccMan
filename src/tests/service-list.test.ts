import { test } from "node:test"
import assert from "node:assert/strict"
import type { Account, Service, ServiceType } from "../types/index.ts"
import {
  countLinkedAccounts,
  filterAndSortServices,
  findServiceReferences,
  isServiceSortBy,
  isServiceSortOrder,
  nextServiceSortOrder,
  pruneSelection,
  resolveTypeFilter,
} from "../lib/service-list.ts"

const types: ServiceType[] = [
  {
    id: "discord",
    name: "Discord",
    icon: "",
    fields: [
      { id: "d-1", key: "username", label: "Username", type: "text", masked: false, required: true },
      { id: "d-3", key: "password", label: "Password", type: "secret", masked: true, required: true },
      { id: "d-4", key: "mail", label: "Mail", type: "linked_service", masked: false, required: false, linkedServiceTypeId: "email" },
    ],
  },
  {
    id: "email",
    name: "Email",
    icon: "",
    fields: [{ id: "g-2", key: "email", label: "Email", type: "text", masked: false, required: true }],
  },
]

function service(id: string, label: string, serviceTypeId: string, extra: Partial<Service> = {}): Service {
  return { id, label, serviceTypeId, data: {}, tags: [], pinned: false, createdAt: 0, updatedAt: 0, ...extra }
}

function account(id: string, linkedServices: string[]): Account {
  return { id, label: id, notes: "", tags: [], linkedServices, pinned: false, createdAt: 0, updatedAt: 0 }
}

const services = [
  service("s1", "Discord10", "discord", { data: { username: "alpha", password: "hunter2", mail: "m1" } }),
  service("s2", "Discord2", "discord", { tags: ["farm"] }),
  service("m1", "Mail main", "email", { data: { email: "alpha@example.com" }, pinned: true }),
  service("x1", "Orphan", "deleted-type"),
]

test("sort option guards and cycling", () => {
  assert.ok(isServiceSortBy("type"))
  assert.ok(!isServiceSortBy("date"))
  assert.ok(isServiceSortOrder("none"))
  assert.ok(!isServiceSortOrder(null))
  assert.equal(nextServiceSortOrder("asc"), "desc")
  assert.equal(nextServiceSortOrder("desc"), "none")
  assert.equal(nextServiceSortOrder("none"), "asc")
})

test("a type filter on a deleted type falls back to all types", () => {
  assert.equal(resolveTypeFilter("discord", types), "discord")
  assert.equal(resolveTypeFilter("twitter", types), null)
  assert.equal(resolveTypeFilter(null, types), null)
})

test("pinned first, natural label order, desc and none", () => {
  const query = { search: "", typeId: null, sortBy: "name" as const, sortOrder: "asc" as const }
  assert.deepEqual(filterAndSortServices(services, types, query).map((s) => s.id), ["m1", "s2", "s1", "x1"])
  assert.deepEqual(
    filterAndSortServices(services, types, { ...query, sortOrder: "desc" }).map((s) => s.id),
    ["m1", "x1", "s1", "s2"],
  )
  assert.deepEqual(
    filterAndSortServices(services, types, { ...query, sortOrder: "none" }).map((s) => s.id),
    ["m1", "s1", "s2", "x1"],
  )
})

test("sort by type puts unknown types first in asc and breaks ties by label", () => {
  const result = filterAndSortServices(services, types, { search: "", typeId: null, sortBy: "type", sortOrder: "asc" })
  assert.deepEqual(result.map((s) => s.id), ["m1", "x1", "s2", "s1"])
})

test("search matches non-secret values and tags, never secrets", () => {
  const query = { search: "", typeId: null, sortBy: "name" as const, sortOrder: "asc" as const }
  assert.deepEqual(filterAndSortServices(services, types, { ...query, search: "alpha" }).map((s) => s.id), ["m1", "s1"])
  assert.deepEqual(filterAndSortServices(services, types, { ...query, search: "hunter2" }), [])
  assert.deepEqual(filterAndSortServices(services, types, { ...query, search: "FARM disc" }).map((s) => s.id), ["s2"])
  assert.deepEqual(filterAndSortServices(services, types, { ...query, typeId: "email" }).map((s) => s.id), ["m1"])
})

test("pruneSelection keeps the same set when nothing is hidden", () => {
  const selected = new Set(["s1", "s2"])
  assert.equal(pruneSelection(selected, ["s1", "s2", "m1"]), selected)
  assert.deepEqual([...pruneSelection(selected, ["s2"])], ["s2"])
  const empty = new Set<string>()
  assert.equal(pruneSelection(empty, []), empty)
})

test("service references: accounts and linked_service fields only", () => {
  const vault = { serviceTypes: types, services, accounts: [account("a1", ["m1", "s1"]), account("a2", ["s2"])] }
  assert.deepEqual(findServiceReferences(vault, "m1"), { accountIds: ["a1"], serviceIds: ["s1"] })
  assert.deepEqual(findServiceReferences(vault, "s2"), { accountIds: ["a2"], serviceIds: [] })
  assert.deepEqual(findServiceReferences(null, "s2"), { accountIds: [], serviceIds: [] })
  assert.equal(countLinkedAccounts(vault, ["s1", "s2", "m1"]), 2)
  assert.equal(countLinkedAccounts(vault, ["x1"]), 0)
})
