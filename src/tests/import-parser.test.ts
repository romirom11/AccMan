import { test } from "node:test"
import assert from "node:assert/strict"
import type { Service, ServiceField, ServiceType } from "../types/index.ts"
import {
  assignColumnMapping,
  buildImportPlan,
  buildMappingOptions,
  countSkippedByReason,
  getColumnMapping,
  mappingToOptionValue,
  optionValueToMapping,
  parseNonNegativeInteger,
  parseRows,
  parseTags,
  reconcileLabelStrategy,
  reconcileMappings,
  renderGeneratedLabel,
  resolveLinkedService,
  resolveSeparator,
  suggestColumnCount,
  type ColumnMappings,
  type LabelStrategy,
} from "../lib/import-parser.ts"

// --- fixtures ---

function field(key: string, overrides: Partial<ServiceField> = {}): ServiceField {
  return { id: `id-${key}`, key, label: key.toUpperCase(), type: "text", masked: false, required: false, ...overrides }
}

function service(id: string, serviceTypeId: string, label: string, data: Record<string, string> = {}): Service {
  return { id, serviceTypeId, label, data, tags: [], pinned: false, createdAt: 0, updatedAt: 0 }
}

const emailType: ServiceType = {
  id: "email",
  name: "Email",
  icon: "Mail",
  fields: [field("email", { required: true }), field("password", { type: "secret", masked: true, required: true })],
}

// Type id and keys deliberately contain '-' and ':'.
const walletType: ServiceType = {
  id: "evm-wallet:v2",
  name: "EVM Wallet",
  icon: "Wallet",
  fields: [field("address"), field("seed-phrase:main", { type: "secret", masked: true }), field("private-key")],
}

const twitterType: ServiceType = {
  id: "twitter-x",
  name: "Twitter",
  icon: "Twitter",
  fields: [
    field("username", { required: true }),
    field("password", { type: "secret" }),
    field("mail-account:link", { type: "linked_service", linkedServiceTypeId: "email", label: "Mail" }),
  ],
}

const allTypes = [emailType, walletType, twitterType]

let counter = 0
const newId = () => `new-${++counter}`

const col = (column: number | null): LabelStrategy => ({ kind: "column", column })
const gen = (pattern: string, startNumber: number): LabelStrategy => ({ kind: "generate", pattern, startNumber })

// --- parseRows ---

test("CRLF file whose values contain the separator, with BOM and blank lines", () => {
  const text = "﻿user1@x.com:pa:ss:word\r\n\r\n   \r\nuser2@x.com:plain\r\n\t\r\nuser3@x.com:http://h:8080/p\r\n"
  const plain = parseRows(text, { separator: ":" })
  assert.deepEqual(
    plain.rows.map((r) => r.cells),
    [["user1@x.com", "pa", "ss", "word"], ["user2@x.com", "plain"], ["user3@x.com", "http", "//h", "8080/p"]],
  )
  assert.equal(plain.columnCount, 4)
  assert.deepEqual(plain.rows.map((r) => r.line), [1, 4, 6])
  assert.equal(plain.columnLimit, null)
  assert.ok(plain.rows.every((r) => r.cells.every((c) => !c.includes("\r") && !c.includes("﻿"))))

  const rest = parseRows(text, { separator: ":", lastColumnTakesRest: true, columns: 2 })
  assert.deepEqual(
    rest.rows.map((r) => r.cells),
    [["user1@x.com", "pa:ss:word"], ["user2@x.com", "plain"], ["user3@x.com", "http://h:8080/p"]],
  )
  assert.equal(rest.columnCount, 2)
  assert.equal(rest.columnLimit, 2)
})

test("lastColumnTakesRest defaults to the most common column count", () => {
  const text = "1.2.3.4:8080:user:pass\n5.6.7.8:3128:u:p:with:colons\n9.9.9.9:80:a:b"
  assert.equal(suggestColumnCount(text, ":"), 4)
  const result = parseRows(text, { separator: ":", lastColumnTakesRest: true })
  assert.equal(result.columnLimit, 4)
  assert.deepEqual(result.rows[1].cells, ["5.6.7.8", "3128", "u", "p:with:colons"])
  assert.equal(result.columnCount, 4)
})

test("suggestColumnCount prefers the smaller count on ties and ignores blank lines", () => {
  assert.equal(suggestColumnCount("a:b\na:b:c\n\n  \n", ":"), 2)
  assert.equal(suggestColumnCount("", ":"), 0)
})

test("cells are trimmed; column count is the maximum over rows", () => {
  const result = parseRows("  a  ;  b \nc\n d ; e ; f ", { separator: ";" })
  assert.deepEqual(result.rows.map((r) => r.cells), [["a", "b"], ["c"], ["d", "e", "f"]])
  assert.equal(result.columnCount, 3)
})

test("multi-character separators and old Mac line endings", () => {
  const result = parseRows("a||b|c\rd||e", { separator: "||" })
  assert.deepEqual(result.rows.map((r) => r.cells), [["a", "b|c"], ["d", "e"]])
  const rest = parseRows("a||b||c||d", { separator: "||", lastColumnTakesRest: true, columns: 2 })
  assert.deepEqual(rest.rows[0].cells, ["a", "b||c||d"])
})

test("empty separator keeps each line as one cell; tab token resolves to a tab", () => {
  const result = parseRows("a:b\nc", { separator: "" })
  assert.deepEqual(result.rows.map((r) => r.cells), [["a:b"], ["c"]])
  assert.equal(result.columnCount, 1)
  assert.equal(resolveSeparator("\\t"), "\t")
  assert.equal(resolveSeparator(":"), ":")
  assert.deepEqual(parseRows("a\tb", { separator: resolveSeparator("\\t") }).rows[0].cells, ["a", "b"])
})

test("empty and whitespace-only input gives no rows", () => {
  assert.deepEqual(parseRows("", { separator: ":" }), { rows: [], columnCount: 0, columnLimit: null })
  assert.equal(parseRows(" \r\n\t\n", { separator: ":" }).rows.length, 0)
})

test("parseNonNegativeInteger", () => {
  assert.equal(parseNonNegativeInteger("0"), 0)
  assert.equal(parseNonNegativeInteger(" 101 "), 101)
  for (const bad of ["", "-1", "1.5", "1e3", "abc", "99999999999999999999"]) {
    assert.equal(parseNonNegativeInteger(bad), null, bad)
  }
})

test("parseTags trims, drops empty and duplicate tags", () => {
  assert.deepEqual(parseTags(" a, b ,,a, c ,"), ["a", "b", "c"])
  assert.deepEqual(parseTags(""), [])
})

// --- mappings ---

test("mapping options round-trip keys containing '-' and ':' without string parsing", () => {
  const options = buildMappingOptions(walletType)
  assert.deepEqual(options.map((o) => o.value), ["ignore", "tags", "field:0", "field:1", "field:2"])
  for (const f of walletType.fields) {
    const value = mappingToOptionValue(options, { kind: "field", fieldKey: f.key })
    assert.deepEqual(optionValueToMapping(options, value), { kind: "field", fieldKey: f.key })
  }
  assert.equal(mappingToOptionValue(options, { kind: "field", fieldKey: "unknown" }), "ignore")
  assert.equal(mappingToOptionValue(options, { kind: "tags" }), "tags")
  assert.deepEqual(optionValueToMapping(options, "garbage"), { kind: "ignore" })
  assert.deepEqual(buildMappingOptions(null).map((o) => o.value), ["ignore", "tags"])
})

test("assignColumnMapping moves a field away from its previous column and deletes 'ignore'", () => {
  let m: ColumnMappings = {}
  m = assignColumnMapping(m, 0, { kind: "field", fieldKey: "seed-phrase:main" })
  m = assignColumnMapping(m, 1, { kind: "tags" })
  m = assignColumnMapping(m, 2, { kind: "field", fieldKey: "seed-phrase:main" })
  assert.deepEqual(m, { 1: { kind: "tags" }, 2: { kind: "field", fieldKey: "seed-phrase:main" } })
  m = assignColumnMapping(m, 2, { kind: "ignore" })
  assert.deepEqual(m, { 1: { kind: "tags" } })
  assert.deepEqual(getColumnMapping(m, 5), { kind: "ignore" })
})

test("reconcileMappings never mutates the stored mappings, so a temporary column drop loses nothing", () => {
  const stored: ColumnMappings = {
    0: { kind: "field", fieldKey: "email" },
    3: { kind: "field", fieldKey: "password" },
    5: { kind: "tags" },
  }
  const snapshot = structuredClone(stored)
  assert.deepEqual(reconcileMappings(stored, 1, emailType), { 0: { kind: "field", fieldKey: "email" } })
  assert.deepEqual(stored, snapshot)
  assert.equal(reconcileMappings(stored, 8, emailType), stored)
  // On a type change only the keys the type lacks go; column indexes are not bounded.
  assert.deepEqual(reconcileMappings(stored, Number.POSITIVE_INFINITY, walletType), { 5: { kind: "tags" } })
})

test("reconcileMappings drops out-of-range columns and keys the new type lacks", () => {
  const m: ColumnMappings = {
    0: { kind: "field", fieldKey: "password" },
    1: { kind: "field", fieldKey: "username" },
    2: { kind: "tags" },
    3: { kind: "field", fieldKey: "email" },
  }
  // Switch to Email with 3 columns: password stays, username is not an Email field, column 3 is gone.
  assert.deepEqual(reconcileMappings(m, 3, emailType), { 0: { kind: "field", fieldKey: "password" }, 2: { kind: "tags" } })
  assert.deepEqual(reconcileMappings(m, 10, null), { 2: { kind: "tags" } })
  const stable: ColumnMappings = { 0: { kind: "field", fieldKey: "email" } }
  assert.equal(reconcileMappings(stable, 2, emailType), stable)
})

test("reconcileLabelStrategy resets an out-of-range label column", () => {
  assert.deepEqual(reconcileLabelStrategy(col(3), 2), col(null))
  const ok = col(1)
  assert.equal(reconcileLabelStrategy(ok, 2), ok)
  const g = gen("ACC", 1)
  assert.equal(reconcileLabelStrategy(g, 0), g)
})

// --- planning ---

test("one column can be both the label and a field (email:password into Email)", () => {
  const { rows } = parseRows("a@x.com:p1\r\nb@x.com:p2\r\n", { separator: ":" })
  const mappings: ColumnMappings = { 0: { kind: "field", fieldKey: "email" }, 1: { kind: "field", fieldKey: "password" } }
  const plan = buildImportPlan(rows, mappings, emailType, allTypes, [], col(0), { newId })
  assert.equal(plan.services.length, 2)
  assert.deepEqual(plan.services[0].data, { email: "a@x.com", password: "p1" })
  assert.equal(plan.services[0].label, "a@x.com")
  assert.equal(plan.services[0].serviceTypeId, "email")
  assert.deepEqual(plan.sourceRows, [1, 2])
  assert.deepEqual(plan.skipped, [])
  assert.deepEqual(plan.warnings, [])
})

test("type ids and field keys with '-' and ':' are stored under the exact key", () => {
  const { rows } = parseRows("0xabc|seed words here|priv", { separator: "|" })
  const mappings: ColumnMappings = {
    0: { kind: "field", fieldKey: "address" },
    1: { kind: "field", fieldKey: "seed-phrase:main" },
    2: { kind: "field", fieldKey: "private-key" },
  }
  const plan = buildImportPlan(rows, mappings, walletType, allTypes, [], gen("W", 1), { newId })
  assert.equal(plan.services[0].serviceTypeId, "evm-wallet:v2")
  assert.deepEqual(plan.services[0].data, { address: "0xabc", "seed-phrase:main": "seed words here", "private-key": "priv" })
})

test("mappings to keys the type does not have are ignored; empty cells are not stored", () => {
  const { rows } = parseRows("a@x.com::junk", { separator: ":" })
  const mappings: ColumnMappings = {
    0: { kind: "field", fieldKey: "email" },
    1: { kind: "field", fieldKey: "password" },
    2: { kind: "field", fieldKey: "username" },
  }
  const plan = buildImportPlan(rows, mappings, emailType, allTypes, [], col(0), { newId })
  assert.deepEqual(plan.services[0].data, { email: "a@x.com" })
})

test("missing label and duplicate labels within the type (existing and in-file, case-insensitive)", () => {
  const existing = [service("s1", "email", "Taken@x.com"), service("s2", "twitter-x", "other@x.com")]
  const { rows } = parseRows(":p0\ntaken@x.com:p1\nother@x.com:p2\nNEW@x.com:p3\nnew@x.com:p4", { separator: ":" })
  const mappings: ColumnMappings = { 1: { kind: "field", fieldKey: "password" } }
  const plan = buildImportPlan(rows, mappings, emailType, allTypes, existing, col(0), { newId })
  // A label used by another type is not a duplicate.
  assert.deepEqual(plan.services.map((s) => s.label), ["other@x.com", "NEW@x.com"])
  assert.deepEqual(plan.skipped, [
    { row: 1, reason: "missing_label" },
    { row: 2, reason: "duplicate_label", value: "taken@x.com" },
    { row: 5, reason: "duplicate_label", value: "new@x.com" },
  ])
  assert.deepEqual(countSkippedByReason(plan.skipped), {
    missing_label: 1,
    duplicate_label: 2,
    unresolved_link: 0,
    ambiguous_link: 0,
  })
})

test("label column out of range or unset counts as missing label", () => {
  const { rows } = parseRows("a\nb", { separator: ":" })
  assert.equal(buildImportPlan(rows, {}, emailType, allTypes, [], col(4), { newId }).skipped.length, 2)
  assert.equal(buildImportPlan(rows, {}, emailType, allTypes, [], col(null), { newId }).skipped.length, 2)
})

test("no service type gives an empty plan", () => {
  const { rows } = parseRows("a", { separator: ":" })
  assert.deepEqual(buildImportPlan(rows, {}, undefined, allTypes, [], col(0)), {
    services: [],
    sourceRows: [],
    skipped: [],
    warnings: [],
  })
})

test("generated labels start at the start number and skip numbers taken in the same type only", () => {
  const existing = [
    service("e1", "email", "ACC101"),
    service("e2", "email", "acc103"),
    service("t1", "twitter-x", "ACC102"),
    service("e3", "email", "ACC5-old"),
  ]
  const { rows } = parseRows("a@x\nb@x\nc@x", { separator: ":" })
  const mappings: ColumnMappings = { 0: { kind: "field", fieldKey: "email" } }
  const plan = buildImportPlan(rows, mappings, emailType, allTypes, existing, gen("ACC", 101), { newId })
  assert.deepEqual(plan.services.map((s) => s.label), ["ACC102", "ACC104", "ACC105"])

  // Existing labels in other types never push the start number up.
  const other = buildImportPlan(rows, mappings, twitterType, allTypes, existing, gen("ACC", 1), { newId })
  assert.deepEqual(other.services.map((s) => s.label), ["ACC1", "ACC2", "ACC3"])
})

test("generated labels replace %n% like bulk create, otherwise append the number", () => {
  assert.equal(renderGeneratedLabel("ACC", 7), "ACC7")
  assert.equal(renderGeneratedLabel("px-%n%", 5), "px-5")
  assert.equal(renderGeneratedLabel("%n%-proxy-%n%", 3), "3-proxy-3")
  assert.equal(renderGeneratedLabel("  Farm %n% ", 12), "Farm 12")
  assert.equal(renderGeneratedLabel("TW ", 1), "TW 1")

  const existing = [service("e1", "email", "px-5")]
  const { rows } = parseRows("a@x\nb@x", { separator: ":" })
  const mappings: ColumnMappings = { 0: { kind: "field", fieldKey: "email" } }
  const plan = buildImportPlan(rows, mappings, emailType, allTypes, existing, gen("px-%n%", 5), { newId })
  assert.deepEqual(plan.services.map((s) => s.label), ["px-6", "px-7"])
})

test("generated labels are only consumed by imported rows", () => {
  const { rows } = parseRows("u1:nobody@x\nu2:a@x", { separator: ":" })
  const existing = [service("m1", "email", "a@x", { email: "a@x" })]
  const mappings: ColumnMappings = {
    0: { kind: "field", fieldKey: "username" },
    1: { kind: "field", fieldKey: "mail-account:link" },
  }
  const plan = buildImportPlan(rows, mappings, twitterType, allTypes, existing, gen("TW ", 1), { newId })
  assert.deepEqual(plan.services.map((s) => s.label), ["TW 1"])
  assert.equal(plan.skipped[0].reason, "unresolved_link")
})

test("linked_service cells resolve by label first, then by a non-secret field value", () => {
  const existing = [
    service("m1", "email", "Main mailbox", { email: "main@x.com", password: "secret-pass" }),
    service("m2", "email", "main@x.com", { email: "other@x.com" }),
    service("m3", "email", "Third", { email: "third@x.com" }),
    service("m4", "email", "Dup", { email: "dup@x.com" }),
    service("m5", "email", "dup", { email: "dup2@x.com" }),
    service("m6", "email", "Six", { email: "shared@x.com" }),
    service("m7", "email", "Seven", { email: "SHARED@x.com" }),
    service("t1", "twitter-x", "Fourth", { username: "fourth@x.com" }),
  ]
  const text = [
    "u1:main@x.com", // label of m2 wins over m1's email value
    "u2:THIRD@x.com", // field value, case-insensitive
    "u3:Main mailbox", // label
    "u4:secret-pass", // secret values are never matched
    "u5:dup", // two labels -> ambiguous
    "u6:shared@x.com", // two field values -> ambiguous
    "u7:fourth@x.com", // services of other types are never matched
  ].join("\n")
  const { rows } = parseRows(text, { separator: ":" })
  const mappings: ColumnMappings = {
    0: { kind: "field", fieldKey: "username" },
    1: { kind: "field", fieldKey: "mail-account:link" },
  }
  const plan = buildImportPlan(rows, mappings, twitterType, allTypes, existing, col(0), { newId })
  assert.deepEqual(
    plan.services.map((s) => [s.label, s.data["mail-account:link"]]),
    [
      ["u1", "m2"],
      ["u2", "m3"],
      ["u3", "m1"],
    ],
  )
  assert.deepEqual(plan.skipped, [
    { row: 4, reason: "unresolved_link", value: "secret-pass", field: "Mail" },
    { row: 5, reason: "ambiguous_link", value: "dup", field: "Mail" },
    { row: 6, reason: "ambiguous_link", value: "shared@x.com", field: "Mail" },
    { row: 7, reason: "unresolved_link", value: "fourth@x.com", field: "Mail" },
  ])
  assert.deepEqual(resolveLinkedService(emailType, existing, " third@x.com "), { status: "ok", serviceId: "m3" })
})

test("linked field whose target type does not exist is unresolved", () => {
  const brokenType: ServiceType = {
    ...twitterType,
    id: "broken",
    fields: [field("link", { type: "linked_service", linkedServiceTypeId: "gone" })],
  }
  const { rows } = parseRows("a:b", { separator: ":" })
  const plan = buildImportPlan(rows, { 1: { kind: "field", fieldKey: "link" } }, brokenType, allTypes, [], col(0), { newId })
  assert.equal(plan.skipped[0].reason, "unresolved_link")
})

test("missing required fields still import but are reported as warnings", () => {
  const { rows } = parseRows("a@x.com\nb@x.com:pw", { separator: ":" })
  const mappings: ColumnMappings = { 0: { kind: "field", fieldKey: "email" }, 1: { kind: "field", fieldKey: "password" } }
  const plan = buildImportPlan(rows, mappings, emailType, allTypes, [], col(0), { newId })
  assert.equal(plan.services.length, 2)
  assert.deepEqual(plan.warnings, [{ row: 1, label: "a@x.com", missingFields: ["PASSWORD"] }])
})

test("tags from several columns are merged and de-duplicated", () => {
  const { rows } = parseRows("a@x;t1, t2;t2,t3", { separator: ";" })
  const mappings: ColumnMappings = { 1: { kind: "tags" }, 2: { kind: "tags" } }
  const plan = buildImportPlan(rows, mappings, emailType, allTypes, [], col(0), { newId })
  assert.deepEqual(plan.services[0].tags, ["t1", "t2", "t3"])
})

test("default ids are unique UUIDs", () => {
  const { rows } = parseRows("a\nb", { separator: ":" })
  const plan = buildImportPlan(rows, {}, emailType, allTypes, [], col(0))
  assert.equal(new Set(plan.services.map((s) => s.id)).size, 2)
  assert.match(plan.services[0].id, /^[0-9a-f-]{36}$/)
})

test("10k lines parse and plan quickly", () => {
  const lines: string[] = []
  for (let i = 0; i < 10_000; i++) lines.push(`user${i}@x.com:pass:${i}:with:colons`)
  const started = Date.now()
  const parsed = parseRows(lines.join("\r\n"), { separator: ":", lastColumnTakesRest: true, columns: 2 })
  const plan = buildImportPlan(
    parsed.rows,
    { 0: { kind: "field", fieldKey: "email" }, 1: { kind: "field", fieldKey: "password" } },
    emailType,
    allTypes,
    [],
    col(0),
    { newId },
  )
  assert.equal(plan.services.length, 10_000)
  assert.equal(plan.services[9_999].data.password, "pass:9999:with:colons")
  assert.ok(Date.now() - started < 2000)
})
