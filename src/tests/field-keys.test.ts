import { test } from "node:test"
import assert from "node:assert/strict"
import type { Service, ServiceField } from "../types/index.ts"
import { FIELD_KEY_PATTERN, MAX_FIELD_KEY_LENGTH, fieldValueLosses, generateFieldKey, slugifyFieldKey } from "../lib/field-keys.ts"

test("Latin labels", () => {
  assert.equal(generateFieldKey("Password", []), "password")
  assert.equal(generateFieldKey("  2FA Key ", []), "2fa_key")
  assert.equal(generateFieldKey("Recovery e-mail (backup)", []), "recovery_e_mail_backup")
  assert.equal(generateFieldKey("Café Crème", []), "cafe_creme")
  assert.equal(generateFieldKey("IMAP_Port", []), "imap_port")
})

test("Ukrainian / Cyrillic labels are transliterated", () => {
  assert.equal(generateFieldKey("Пароль", []), "parol")
  assert.equal(generateFieldKey("Електронна пошта", []), "elektronna_poshta")
  assert.equal(generateFieldKey("Ключ 2FA", []), "kliuch_2fa")
  assert.equal(generateFieldKey("Щоденник", []), "shchodennyk")
  assert.equal(generateFieldKey("Їжак", []), "yizhak")
  assert.equal(generateFieldKey("Юрій", []), "yurii")
  assert.equal(generateFieldKey("Згода", []), "zghoda")
  assert.equal(generateFieldKey("Сім'я", []), "simia")
  assert.equal(generateFieldKey("Ґанок", []), "ganok")
  assert.equal(generateFieldKey("Почта (рус)", []), "pochta_rus")
})

test("collisions get numeric suffixes", () => {
  assert.equal(generateFieldKey("Password", ["password"]), "password_2")
  assert.equal(generateFieldKey("Password", ["password", "password_2", "password_3"]), "password_4")
  assert.equal(generateFieldKey("Пароль", new Set(["parol"])), "parol_2")
})

test("empty or unusable labels fall back to field_N", () => {
  assert.equal(generateFieldKey("", []), "field_1")
  assert.equal(generateFieldKey("   ", []), "field_1")
  assert.equal(generateFieldKey("!!!", ["field_1"]), "field_2")
  assert.equal(generateFieldKey("🔑🔑", ["field_1", "field_2"]), "field_3")
  assert.equal(generateFieldKey("密码", []), "field_1")
})

test("results always match the backend pattern and length", () => {
  const labels = ["Password", "Пароль", "", "a".repeat(200), "Ключ ".repeat(40), "__x__", "Ünïcödé ✓"]
  for (const label of labels) {
    const existing: string[] = []
    for (let i = 0; i < 5; i++) {
      const key = generateFieldKey(label, existing)
      assert.match(key, FIELD_KEY_PATTERN, label)
      assert.ok(key.length <= MAX_FIELD_KEY_LENGTH, `${key} too long`)
      assert.ok(!existing.includes(key), `${key} duplicated`)
      assert.ok(!key.startsWith("_") && !key.endsWith("_"), key)
      existing.push(key)
    }
  }
})

test("slugify keeps nothing but [a-z0-9_]", () => {
  assert.equal(slugifyFieldKey("A--B  C"), "a_b_c")
  assert.equal(slugifyFieldKey("___"), "")
})

// --- fieldValueLosses ---

function f(id: string, key: string, type: ServiceField["type"] = "text", linkedServiceTypeId?: string): ServiceField {
  return { id, key, label: key.toUpperCase(), type, masked: false, required: false, linkedServiceTypeId }
}

function svc(id: string, serviceTypeId: string, data: Record<string, string> = {}): Pick<Service, "id" | "serviceTypeId" | "data"> {
  return { id, serviceTypeId, data }
}

const custom = { id: "custom", fields: [f("a", "recovery"), f("b", "proxy"), f("c", "mail", "linked_service", "email")] }
const services = [
  svc("e1", "email"),
  svc("e2", "email"),
  svc("c1", "custom", { recovery: "a@b.com", proxy: "1.2.3.4", mail: "e1" }),
  svc("c2", "custom", { recovery: "e2", mail: "c1" }),
  svc("c3", "custom", { proxy: "5.6.7.8" }),
  svc("x1", "other", { recovery: "zzz" }),
]

test("fieldValueLosses: text -> linked counts values that are not ids of the target type", () => {
  const edited = { ...custom, fields: [f("a", "recovery", "linked_service", "email"), custom.fields[1], custom.fields[2]] }
  const losses = fieldValueLosses(custom, edited, services)
  assert.equal(losses.length, 1)
  assert.equal(losses[0].reason, "link")
  assert.equal(losses[0].field.id, "a")
  // c1 holds an email address (cleared); c2 holds the id of an Email service (kept).
  assert.equal(losses[0].count, 1)
})

test("fieldValueLosses: a new link target (also the type itself) clears links to the old target", () => {
  const toSelf = { ...custom, fields: [custom.fields[0], custom.fields[1], f("c", "mail_ref", "linked_service", "custom")] }
  const [loss] = fieldValueLosses(custom, toSelf, services)
  // c1 -> e1 is an Email service (cleared); c2 -> c1 is a service of this type (kept).
  assert.deepEqual([loss.reason, loss.storedKey, loss.count], ["link", "mail", 1])
  // Unchanged target, linked -> text and plain edits lose nothing.
  const harmless = { ...custom, fields: [f("a", "recovery_2"), f("b", "proxy", "secret"), f("c", "mail", "text")] }
  assert.deepEqual(fieldValueLosses(custom, harmless, services), [])
  assert.deepEqual(fieldValueLosses(undefined, custom, services), [])
})

test("fieldValueLosses: a new field reusing a removed field's key starts empty", () => {
  const edited = { ...custom, fields: [custom.fields[0], custom.fields[2], f("new-id", "proxy", "2fa")] }
  const losses = fieldValueLosses(custom, edited, services)
  assert.deepEqual(
    losses.map((l) => [l.reason, l.field.id, l.storedKey, l.count]),
    [["reused_key", "new-id", "proxy", 2]],
  )
  // Reusing the old key of a field that was only renamed loses nothing: values follow the id.
  const renamed = { ...custom, fields: [custom.fields[0], f("b", "proxy_old"), custom.fields[2], f("new-id", "proxy")] }
  assert.deepEqual(fieldValueLosses(custom, renamed, services), [])
})
