import { test } from "node:test"
import assert from "node:assert/strict"
import type { Service, ServiceType } from "../types/index.ts"
import {
  buildServicePayload,
  compactData,
  formErrorKey,
  lostKeysOnTypeChange,
  parseTags,
  retainTypeKeys,
  serviceDiffers,
  checkServiceForm,
  validateServiceForm,
} from "../lib/service-form.ts"

const types: ServiceType[] = [
  {
    id: "discord",
    name: "Discord",
    icon: "",
    fields: [
      { id: "d-1", key: "username", label: "Username", type: "text", masked: false, required: true },
      { id: "d-3", key: "password", label: "Password", type: "secret", masked: true, required: true },
      { id: "d-7", key: "2fa_key", label: "2FA", type: "2fa", masked: true, required: false },
      { id: "d-9", key: "mail", label: "Mail", type: "linked_service", masked: false, required: true, linkedServiceTypeId: "email" },
    ],
  },
  {
    id: "email",
    name: "Email",
    icon: "",
    fields: [
      { id: "g-2", key: "email", label: "Email", type: "text", masked: false, required: true },
      { id: "g-3", key: "password", label: "Password", type: "secret", masked: true, required: true },
      { id: "g-5", key: "recovery", label: "Recovery", type: "linked_service", masked: false, required: true, linkedServiceTypeId: "email" },
    ],
  },
  { id: "proxy", name: "Proxy", icon: "", fields: [{ id: "p-1", key: "proxy_string", label: "Proxy", type: "secret", masked: true, required: true }] },
]

const existing = new Set(["m-old"])
const exists = (id: string) => existing.has(id)

test("parseTags trims, drops empties and duplicates", () => {
  assert.deepEqual(parseTags(" a, b ,, a ,"), ["a", "b"])
  assert.deepEqual(parseTags(""), [])
})

test("compactData drops blank values only", () => {
  assert.deepEqual(compactData({ a: "", b: "  ", c: " x ", d: "0" }), { c: " x ", d: "0" })
})

test("type change: lost keys and retained keys", () => {
  const data = { username: "u", password: "p", "2fa_key": "", legacy: "kept?" }
  assert.deepEqual(lostKeysOnTypeChange(data, types[2]), ["username", "password", "legacy"])
  assert.deepEqual(lostKeysOnTypeChange(data, types[0]), ["legacy"])
  assert.deepEqual(retainTypeKeys(data, types[1]), { password: "p" })
  assert.deepEqual(retainTypeKeys(data, undefined), {})
})

test("validation: label, type and required fields", () => {
  assert.deepEqual(validateServiceForm({ label: " ", typeId: "", data: {}, inline: {} }, types, exists), {
    [formErrorKey.label]: "required",
    [formErrorKey.type]: "required",
  })
  const errors = validateServiceForm({ label: "D1", typeId: "discord", data: { username: "u", password: " ", mail: "gone" }, inline: {} }, types, exists)
  assert.deepEqual(errors, { [formErrorKey.field("password")]: "required", [formErrorKey.field("mail")]: "required" })
  assert.deepEqual(
    validateServiceForm({ label: "D1", typeId: "discord", data: { username: "u", password: "p", mail: "m-old" }, inline: {} }, types, exists),
    {},
  )
})

test("validation on edit: required fields that were already empty only warn, newly emptied ones block", () => {
  const form = { label: "D1", typeId: "discord", data: { username: "", password: "", mail: "gone" }, inline: {} }
  // Create: everything missing blocks.
  assert.deepEqual(checkServiceForm(form, types, exists).warnings, {})
  // Edit of an imported service that never had username/mail (mail points to a deleted service),
  // but whose password the user has just cleared.
  const previous = { serviceTypeId: "discord", data: { password: "old-pass", mail: "gone" } }
  const result = checkServiceForm(form, types, exists, { previous })
  assert.deepEqual(result.errors, { [formErrorKey.field("password")]: "required" })
  assert.deepEqual(result.warnings, {
    [formErrorKey.field("username")]: "required",
    [formErrorKey.field("mail")]: "required",
  })
  assert.deepEqual(validateServiceForm(form, types, exists, { previous }), result.errors)
  // Unlinking a link that worked before blocks; label and type still always block.
  const unlinked = checkServiceForm({ ...form, label: " ", data: { username: "u", password: "p", mail: "" } }, types, exists, {
    previous: { serviceTypeId: "discord", data: { username: "u", password: "p", mail: "m-old" } },
  })
  assert.deepEqual(unlinked.errors, { [formErrorKey.label]: "required", [formErrorKey.field("mail")]: "required" })
  assert.deepEqual(unlinked.warnings, {})
})

test("validation on edit: after switching the type, the new type's required fields block", () => {
  // An incomplete Proxy service is edited and switched to Email without filling Email's fields.
  const previous = { serviceTypeId: "proxy", data: {} as Record<string, string> }
  const switched = { label: "P1", typeId: "email", data: {}, inline: {} }
  const result = checkServiceForm(switched, types, exists, { previous })
  assert.deepEqual(result.errors, {
    [formErrorKey.field("email")]: "required",
    [formErrorKey.field("password")]: "required",
    [formErrorKey.field("recovery")]: "required",
  })
  assert.deepEqual(result.warnings, {})
  // Even a key the old data happens to share (and left empty) blocks under the new type.
  const fromDiscord = checkServiceForm(
    { label: "D1", typeId: "email", data: { email: "a@b.c", recovery: "m-old" }, inline: {} },
    types,
    exists,
    { previous: { serviceTypeId: "discord", data: { username: "u", mail: "m-old" } } },
  )
  assert.deepEqual(fromDiscord.errors, { [formErrorKey.field("password")]: "required" })
  assert.deepEqual(fromDiscord.warnings, {})
  // Switching back to the stored type restores the relaxation for fields that were empty in storage.
  const back = checkServiceForm({ label: "P1", typeId: "proxy", data: {}, inline: {} }, types, exists, { previous })
  assert.deepEqual(back.errors, {})
  assert.deepEqual(back.warnings, { [formErrorKey.field("proxy_string")]: "required" })
})

test("validation: an inline draft satisfies the linked field but its own fields are checked", () => {
  const draft = { id: "m-new", label: "", data: { email: "a@b.c", recovery: "nope" }, tags: "" }
  const errors = validateServiceForm(
    { label: "D1", typeId: "discord", data: { username: "u", password: "p" }, inline: { mail: draft } },
    types,
    exists,
  )
  assert.deepEqual(errors, {
    [formErrorKey.inlineLabel("mail")]: "required",
    [formErrorKey.inlineField("mail", "password")]: "required",
    [formErrorKey.inlineField("mail", "recovery")]: "required",
  })
})

test("payload: inline drafts become linked services referenced by id", () => {
  const payload = buildServicePayload(
    "main-id",
    {
      label: " D1 ",
      typeId: "discord",
      data: { username: "u", password: "p", "2fa_key": "", mail: "m-old" },
      tags: "x, y",
      inline: {
        mail: { id: "m-new", label: " Mail ", data: { email: "a@b.c", password: "pw", stray: "z" }, tags: "t" },
        notAField: { id: "ignored", label: "nope", data: {}, tags: "" },
      },
    },
    types,
  )
  assert.deepEqual(payload.linked, [
    { id: "m-new", label: "Mail", serviceTypeId: "email", data: { email: "a@b.c", password: "pw" }, tags: ["t"] },
  ])
  assert.deepEqual(payload.main, {
    id: "main-id",
    label: "D1",
    serviceTypeId: "discord",
    data: { username: "u", password: "p", mail: "m-new" },
    tags: ["x", "y"],
  })
})

test("serviceDiffers compares label, type, tags and non-empty data", () => {
  const stored: Service = {
    id: "s",
    label: "D1",
    serviceTypeId: "discord",
    data: { username: "u", empty: "" },
    tags: ["a"],
    pinned: true,
    createdAt: 1,
    updatedAt: 2,
  }
  const same = { id: "s", label: "D1", serviceTypeId: "discord", data: { username: "u" }, tags: ["a"] }
  assert.equal(serviceDiffers(stored, same), false)
  assert.equal(serviceDiffers(stored, { ...same, label: "D2" }), true)
  assert.equal(serviceDiffers(stored, { ...same, tags: [] }), true)
  assert.equal(serviceDiffers(stored, { ...same, data: { username: "v" } }), true)
  assert.equal(serviceDiffers(stored, { ...same, data: { username: "u", password: "p" } }), true)
})
