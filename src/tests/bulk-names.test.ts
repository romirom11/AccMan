import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_BULK_COUNT,
  MAX_U32,
  countMatchingServices,
  parseNonNegativeInt,
  previewBulkNames,
  renderBulkName,
  validateBulkNumbers,
  withNumberPlaceholder,
} from "../lib/bulk-names.ts"

test("withNumberPlaceholder appends ' %n%' only when missing, after trimming", () => {
  assert.equal(withNumberPlaceholder("Work%n%"), "Work%n%")
  assert.equal(withNumberPlaceholder("  Work "), "Work %n%")
  assert.equal(withNumberPlaceholder("Mail"), "Mail %n%")
})

test("renderBulkName uses the real number and replaces every placeholder", () => {
  assert.equal(renderBulkName("Work%n%", 5), "Work5")
  assert.equal(renderBulkName("Farm2024-%n%", 7), "Farm2024-7")
  assert.equal(renderBulkName("Mail", 1), "Mail 1")
  assert.equal(renderBulkName("A%n%-B%n%", 3), "A3-B3")
  assert.equal(renderBulkName("Work%n%", 0), "Work0")
})

test("parseNonNegativeInt accepts only plain decimal integers", () => {
  assert.equal(parseNonNegativeInt("0"), 0)
  assert.equal(parseNonNegativeInt(" 42 "), 42)
  assert.equal(parseNonNegativeInt(""), null)
  assert.equal(parseNonNegativeInt("-3"), null)
  assert.equal(parseNonNegativeInt("1.5"), null)
  assert.equal(parseNonNegativeInt("1e3"), null)
  assert.equal(parseNonNegativeInt("abc"), null)
  assert.equal(parseNonNegativeInt("99999999999999999999"), null)
})

test("validateBulkNumbers enforces 1..=1000 and the u32 range", () => {
  assert.deepEqual(validateBulkNumbers("10", "1"), { ok: true, count: 10, startNumber: 1, lastNumber: 10 })
  assert.deepEqual(validateBulkNumbers("1", "0"), { ok: true, count: 1, startNumber: 0, lastNumber: 0 })
  assert.equal(validateBulkNumbers(String(MAX_BULK_COUNT), "1").ok, true)

  const zero = validateBulkNumbers("0", "1")
  assert.equal(zero.ok, false)
  assert.equal(!zero.ok && zero.countError, "count_invalid")
  const tooMany = validateBulkNumbers(String(MAX_BULK_COUNT + 1), "1")
  assert.equal(!tooMany.ok && tooMany.countError, "count_invalid")
  const empty = validateBulkNumbers("", "")
  assert.equal(!empty.ok && empty.countError, "count_invalid")
  assert.equal(!empty.ok && empty.startError, "start_invalid")
  const negative = validateBulkNumbers("2", "-3")
  assert.equal(!negative.ok && negative.startError, "start_invalid")

  assert.equal(validateBulkNumbers("1", String(MAX_U32)).ok, true)
  const overflow = validateBulkNumbers("2", String(MAX_U32))
  assert.equal(!overflow.ok && overflow.startError, "range_too_large")
  const beyondU32 = validateBulkNumbers("1", String(MAX_U32 + 1))
  assert.equal(!beyondU32.ok && beyondU32.startError, "start_invalid")
})

test("previewBulkNames shows the first and last names", () => {
  assert.deepEqual(previewBulkNames("Work%n%", 5, 3), { first: "Work5", last: "Work7" })
  assert.deepEqual(previewBulkNames("Mail", 1, 1), { first: "Mail 1" })
  assert.equal(previewBulkNames("   ", 1, 3), null)
})

test("countMatchingServices matches exact labels of the same type with the same numbering", () => {
  const services = [
    { serviceTypeId: "email", label: "Mail 1" },
    { serviceTypeId: "email", label: "Mail 2" },
    { serviceTypeId: "discord", label: "Mail 3" },
    { serviceTypeId: "email", label: "mail 3" },
  ]
  assert.equal(countMatchingServices(services, "email", "Mail", 1, 3), 2)
  assert.equal(countMatchingServices(services, "email", "Mail %n%", 2, 1), 1)
  assert.equal(countMatchingServices(services, "discord", "Mail", 1, 3), 1)
  assert.equal(countMatchingServices(services, "", "Mail", 1, 3), 0)
  assert.equal(countMatchingServices(services, "email", "", 1, 3), 0)
})
