import { test } from "node:test"
import assert from "node:assert/strict"
import type { Account } from "../types/index.ts"
import {
  TAG_FILTER_ALL,
  collectAccountTags,
  filterAndSortAccounts,
  isAccountSortOrder,
  nextSortOrder,
  parseTagFilterValue,
  rangeBetween,
  resolveTagFilter,
  tagFilterValue,
} from "../lib/account-list.ts"

function account(id: string, label: string, extra: Partial<Account> = {}): Account {
  return { id, label, notes: "", tags: [], linkedServices: [], pinned: false, createdAt: 0, updatedAt: 0, ...extra }
}

const accounts = [
  account("a", "Work10", { tags: ["farm"] }),
  account("b", "Work2", { tags: ["farm", "all"], notes: "Main proxy in DE" }),
  account("c", "Personal", { pinned: true }),
  account("d", "work1", { tags: ["season 2"] }),
]

test("tag filter values never collide with the 'all' sentinel", () => {
  assert.equal(tagFilterValue(null), TAG_FILTER_ALL)
  assert.notEqual(tagFilterValue("all"), TAG_FILTER_ALL)
  assert.equal(parseTagFilterValue(tagFilterValue("all")), "all")
  assert.equal(parseTagFilterValue(tagFilterValue("tag:x")), "tag:x")
  assert.equal(parseTagFilterValue(TAG_FILTER_ALL), null)
})

test("collectAccountTags is unique and naturally sorted", () => {
  assert.deepEqual(collectAccountTags(accounts), ["all", "farm", "season 2"])
})

test("resolveTagFilter falls back to all for deleted tags", () => {
  const tags = collectAccountTags(accounts)
  assert.equal(resolveTagFilter("farm", tags), "farm")
  assert.equal(resolveTagFilter("gone", tags), null)
  assert.equal(resolveTagFilter(null, tags), null)
})

test("filterAndSortAccounts puts pinned first and sorts naturally", () => {
  const ids = (list: Account[]) => list.map((a) => a.id)
  assert.deepEqual(ids(filterAndSortAccounts(accounts, { search: "", tag: null, sort: "asc" })), ["c", "d", "b", "a"])
  assert.deepEqual(ids(filterAndSortAccounts(accounts, { search: "", tag: null, sort: "desc" })), ["c", "a", "b", "d"])
  assert.deepEqual(ids(filterAndSortAccounts(accounts, { search: "", tag: null, sort: "none" })), ["c", "a", "b", "d"])
})

test("filterAndSortAccounts filters by tag (including a tag named 'all') and search terms", () => {
  const ids = (list: Account[]) => list.map((a) => a.id)
  assert.deepEqual(ids(filterAndSortAccounts(accounts, { search: "", tag: "all", sort: "asc" })), ["b"])
  assert.deepEqual(ids(filterAndSortAccounts(accounts, { search: "", tag: "farm", sort: "asc" })), ["b", "a"])
  assert.deepEqual(ids(filterAndSortAccounts(accounts, { search: "proxy de", tag: null, sort: "asc" })), ["b"])
  assert.deepEqual(ids(filterAndSortAccounts(accounts, { search: "SEASON", tag: null, sort: "asc" })), ["d"])
  assert.deepEqual(ids(filterAndSortAccounts(accounts, { search: "nothing", tag: null, sort: "asc" })), [])
})

test("filterAndSortAccounts does not mutate its input", () => {
  const before = accounts.map((a) => a.id)
  filterAndSortAccounts(accounts, { search: "", tag: null, sort: "desc" })
  assert.deepEqual(accounts.map((a) => a.id), before)
})

test("sort order helpers", () => {
  assert.equal(nextSortOrder("asc"), "desc")
  assert.equal(nextSortOrder("desc"), "none")
  assert.equal(nextSortOrder("none"), "asc")
  assert.equal(isAccountSortOrder("asc"), true)
  assert.equal(isAccountSortOrder("bogus"), false)
  assert.equal(isAccountSortOrder(null), false)
})

test("rangeBetween selects an inclusive range in visible order", () => {
  const order = ["a", "b", "c", "d"]
  assert.deepEqual(rangeBetween(order, "b", "d"), ["b", "c", "d"])
  assert.deepEqual(rangeBetween(order, "d", "b"), ["b", "c", "d"])
  assert.deepEqual(rangeBetween(order, null, "c"), ["c"])
  assert.deepEqual(rangeBetween(order, "x", "c"), ["c"])
  assert.deepEqual(rangeBetween(order, "a", "x"), [])
})
