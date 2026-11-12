import { test } from "node:test"
import assert from "node:assert/strict"
import type { Account } from "../types/index.ts"
import { findListNeighbors } from "../lib/list-navigation.ts"
import { filterAndSortAccounts } from "../lib/account-list.ts"

const ids = ["a", "b", "c", "d"]

test("middle item has both neighbours", () => {
  assert.deepEqual(findListNeighbors("b", ids, []), { prevId: "a", nextId: "c", index: 1, total: 4, unfiltered: false })
})

test("no previous at the start, no next at the end", () => {
  assert.deepEqual(findListNeighbors("a", ids, []), { prevId: null, nextId: "b", index: 0, total: 4, unfiltered: false })
  assert.deepEqual(findListNeighbors("d", ids, []), { prevId: "c", nextId: null, index: 3, total: 4, unfiltered: false })
})

test("single item has no neighbours", () => {
  assert.deepEqual(findListNeighbors("x", ["x"], ["x"]), { prevId: null, nextId: null, index: 0, total: 1, unfiltered: false })
})

test("item hidden by the filters falls back to the unfiltered list", () => {
  assert.deepEqual(findListNeighbors("x", ["a", "b"], ["a", "x", "b"]), {
    prevId: "a",
    nextId: "b",
    index: 1,
    total: 3,
    unfiltered: true,
  })
})

test("the unfiltered list is only computed when needed", () => {
  let calls = 0
  const all = () => {
    calls++
    return ["a", "b", "x"]
  }
  findListNeighbors("a", ["a", "b"], all)
  assert.equal(calls, 0)
  assert.equal(findListNeighbors("x", ["a", "b"], all).prevId, "b")
  assert.equal(calls, 1)
})

test("unknown or missing id gives no neighbours", () => {
  const none = { prevId: null, nextId: null, index: -1, total: 2, unfiltered: false }
  assert.deepEqual(findListNeighbors("zzz", ["a", "b"], ["a", "b", "c"]), none)
  assert.deepEqual(findListNeighbors(undefined, ["a", "b"], ["a", "b", "c"]), none)
  assert.deepEqual(findListNeighbors("a", [], []), { ...none, total: 0 })
})

function account(id: string, label: string, extra: Partial<Account> = {}): Account {
  return { id, label, notes: "", tags: [], linkedServices: [], pinned: false, createdAt: 0, updatedAt: 0, ...extra }
}

test("follows the list page order (pinned first, natural sort, filters)", () => {
  const accounts = [
    account("w10", "Work10", { tags: ["farm"] }),
    account("w2", "Work2", { tags: ["farm"] }),
    account("p", "Personal", { pinned: true }),
    account("w1", "work1"),
  ]
  const query = { search: "", tag: "farm", sort: "asc" as const }
  const filtered = filterAndSortAccounts(accounts, query).map((a) => a.id)
  const all = () => filterAndSortAccounts(accounts, { ...query, search: "", tag: null }).map((a) => a.id)
  assert.deepEqual(filtered, ["w2", "w10"])
  assert.deepEqual(findListNeighbors("w2", filtered, all), { prevId: null, nextId: "w10", index: 0, total: 2, unfiltered: false })
  // "work1" has no "farm" tag: navigation uses all accounts, same sort.
  assert.deepEqual(findListNeighbors("w1", filtered, all), { prevId: "p", nextId: "w2", index: 1, total: 4, unfiltered: true })
})
