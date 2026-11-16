import { test } from "node:test"
import assert from "node:assert/strict"
import type { Account, Service, ServiceType } from "../types/index.ts"
import {
  buildAccountSearchText,
  buildServiceSearchText,
  getServiceTitle,
  isEmailService,
  isSecretField,
  isTotpField,
  matchesSearch,
} from "../lib/service-helpers.ts"

const type: ServiceType = {
  id: "discord",
  name: "Discord",
  icon: "",
  fields: [
    { id: "d-1", key: "username", label: "Username", type: "text", masked: false, required: true },
    { id: "d-3", key: "password", label: "Password", type: "secret", masked: true, required: true },
    { id: "d-6", key: "auth_token", label: "Auth Token", type: "textarea", masked: true, required: false },
    { id: "d-7", key: "2fa_key", label: "2FA Key", type: "2fa", masked: false, required: false },
    { id: "d-9", key: "proxy", label: "Proxy", type: "linked_service", masked: false, required: false, linkedServiceTypeId: "proxy" },
    { id: "d-10", key: "site", label: "Site", type: "url", masked: false, required: false },
  ],
}

const service: Service = {
  id: "s1",
  serviceTypeId: "discord",
  label: "Main",
  tags: ["farm", "eu"],
  data: {
    username: "neo_user",
    password: "hunter2-secret",
    auth_token: "tok-SECRET",
    "2fa_key": "JBSWY3DPEHPK3PXP",
    proxy: "11111111-2222",
    site: "https://discord.com",
    orphan: "leftover-value",
  },
  pinned: false,
  createdAt: 0,
  updatedAt: 0,
}

test("secret and 2fa fields are secret", () => {
  assert.equal(isSecretField(type.fields[0]), false)
  assert.equal(isSecretField(type.fields[1]), true)
  assert.equal(isSecretField(type.fields[2]), true)
  assert.equal(isSecretField(type.fields[3]), true)
  assert.equal(isTotpField(type.fields[3]), true)
  assert.equal(isTotpField(type.fields[1]), false)
})

test("service search text never contains secret values", () => {
  const text = buildServiceSearchText(service, type)
  assert.ok(text.includes("main"))
  assert.ok(text.includes("farm"))
  assert.ok(text.includes("discord"))
  assert.ok(text.includes("neo_user"))
  assert.ok(text.includes("https://discord.com"))
  for (const secret of ["hunter2", "tok-secret", "jbswy3dp", "11111111", "leftover"]) {
    assert.equal(text.includes(secret), false, secret)
  }
  assert.equal(matchesSearch(text, "hunter2"), false)
  assert.equal(matchesSearch(text, "MAIN farm"), true)
  // Without a known type only label/tags are searchable.
  assert.equal(buildServiceSearchText(service, undefined).includes("neo_user"), false)
})

test("account search text", () => {
  const account: Account = {
    id: "a1",
    label: "Persona 7",
    notes: "Bought in May",
    tags: ["tier-1"],
    linkedServices: [],
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
  }
  const text = buildAccountSearchText(account)
  assert.equal(matchesSearch(text, "persona tier-1"), true)
  assert.equal(matchesSearch(text, "may"), true)
  assert.equal(matchesSearch(text, "june"), false)
})

test("email service detection and titles", () => {
  assert.equal(isEmailService({ id: "email", name: "Mail" }), true)
  assert.equal(isEmailService({ id: "custom", name: " EMAIL " }), true)
  assert.equal(isEmailService({ id: "custom", name: "Email 2" }), false)
  assert.equal(isEmailService(undefined), false)
  assert.equal(getServiceTitle({ label: "  " }, { name: "Discord" }), "Discord")
  assert.equal(getServiceTitle({ label: "Main" }, { name: "Discord" }), "Main")
})

test("list search is exact-substring and multi-term", () => {
  const text = "binance-main\nfarm\ntier-1\nbought in may"
  // Every whitespace-separated term must occur somewhere, in any order, case-insensitively.
  assert.equal(matchesSearch(text, "FARM binance"), true)
  assert.equal(matchesSearch(text, "  main \t tier-1  "), true)
  assert.equal(matchesSearch(text, "binance june"), false)
  // Exact substrings only: no fuzzy/typo matching on the list pages (the palette is fuzzy).
  assert.equal(matchesSearch(text, "binanse"), false)
  // Blank queries match everything.
  assert.equal(matchesSearch(text, ""), true)
  assert.equal(matchesSearch(text, "   "), true)
  // Non-Latin text is case-insensitive too.
  assert.equal(matchesSearch("Особистий Акаунт", "особистий акаунт"), true)
})
