import { test } from "node:test"
import assert from "node:assert/strict"
import type { Account, Service, ServiceType, Vault } from "../types/index.ts"
import { analyseVault, computeHealthScore, isPasswordField, type HealthIssue, type HealthReport } from "../lib/vault-health.ts"

const discord: ServiceType = {
  id: "discord",
  name: "Discord",
  icon: "",
  fields: [
    { id: "d-1", key: "username", label: "Username", type: "text", masked: false, required: true },
    { id: "d-2", key: "email", label: "Email", type: "text", masked: false, required: true },
    { id: "d-3", key: "password", label: "Password", type: "secret", masked: true, required: true },
    { id: "d-7", key: "2fa_key", label: "2FA Key", type: "2fa", masked: true, required: false },
    { id: "d-9", key: "site", label: "Site", type: "url", masked: false, required: false },
    { id: "d-10", key: "proxy", label: "Proxy", type: "linked_service", masked: false, required: false, linkedServiceTypeId: "proxy" },
  ],
}

const gmail: ServiceType = {
  id: "email",
  name: "Email",
  icon: "",
  fields: [
    { id: "g-2", key: "email", label: "Email", type: "text", masked: false, required: true },
    { id: "g-3", key: "password", label: "Password", type: "secret", masked: true, required: true },
    { id: "g-8", key: "imap_host", label: "IMAP Host", type: "text", masked: false, required: false },
  ],
}

const proxy: ServiceType = {
  id: "proxy",
  name: "Proxy",
  icon: "",
  fields: [{ id: "p-1", key: "proxy_string", label: "Proxy String", type: "secret", masked: true, required: true }],
}

const STRONG_A = "Kx9#vQ2$mLp7&Zt4"
const STRONG_B = "Zq8$wN3!rT6^yU1@"
const STRONG_C = "Hy7&kP2#xM5!sB9$"
const WEAK = "qwerty123"
const TOTP_OK = "JBSWY3DPEHPK3PXP"
const TOTP_BAD = "not-a-valid-secret!!"

function svc(id: string, serviceTypeId: string, label: string, data: Record<string, string>): Service {
  return { id, serviceTypeId, label, data, tags: [], pinned: false, createdAt: 0, updatedAt: 0 }
}

function acc(id: string, label: string, linkedServices: string[]): Account {
  return { id, label, notes: "", tags: [], linkedServices, pinned: false, createdAt: 0, updatedAt: 0 }
}

function makeVault(services: Service[], accounts: Account[], serviceTypes = [discord, gmail, proxy]): Vault {
  return {
    version: "0.3.0",
    serviceTypes,
    services,
    accounts,
    settings: { autoLockMinutes: 15, clipboardClearSeconds: 30 },
  }
}

const services: Service[] = [
  svc("d1", "discord", "Alice Discord", {
    username: "alice_handle",
    email: "alice@example.com",
    password: STRONG_A,
    "2fa_key": TOTP_OK,
    site: "https://discord.com",
    proxy: "p1",
  }),
  svc("d2", "discord", "Bob Discord", {
    username: "bob_handle",
    email: "  ALICE@example.com ",
    password: STRONG_A,
    "2fa_key": TOTP_BAD,
    site: "https://discord.com",
    proxy: "p1",
  }),
  svc("d3", "discord", "Dave Discord", {
    username: "",
    email: "dave@example.com",
    password: WEAK,
  }),
  svc("g1", "email", "Alice Mail", { email: "alice@example.com", password: STRONG_B, imap_host: "imap.example.com" }),
  svc("g2", "email", "Bob Mail", { email: "bob@example.com", password: STRONG_C, imap_host: "imap.example.com" }),
  svc("o1", "email", "Loose Mail", { email: "loose@example.com", password: WEAK }),
  svc("p1", "proxy", "Shared Proxy", { proxy_string: "http://user1:pw1@10.20.30.40:8080" }),
  // The same proxy as p1 (same endpoint and credentials), written in the other format.
  svc("p2", "proxy", "Spare Proxy", { proxy_string: "10.20.30.40:8080:user1:pw1" }),
  svc("x1", "deleted-type", "Ghost", { token: "ghost-token-value" }),
]

const accounts: Account[] = [
  acc("A", "Alice", ["d1", "g1", "p1"]),
  acc("B", "Bob", ["d2", "g2"]),
  acc("C", "Carol", ["missing-service"]),
  acc("D", "Dave", ["d3"]),
]

const vault = makeVault(services, accounts)

function issue<K extends HealthIssue["kind"]>(report: HealthReport, kind: K): Extract<HealthIssue, { kind: K }> {
  const found = report.issues.find((i) => i.kind === kind)
  assert.ok(found, `issue ${kind} present`)
  return found as Extract<HealthIssue, { kind: K }>
}

const report = analyseVault(vault)

test("services not linked to any account", () => {
  const orphans = issue(report, "orphan_services")
  assert.equal(orphans.severity, "info")
  assert.deepEqual(
    orphans.items.map((s) => s.id),
    ["o1", "p2", "x1"],
  )
  assert.equal(orphans.count, 3)
})

test("accounts without (existing) services", () => {
  const empty = issue(report, "empty_accounts")
  assert.deepEqual(empty.items, [{ id: "C", label: "Carol" }])
})

test("services with missing required fields list the field labels", () => {
  const missing = issue(report, "missing_required")
  assert.equal(missing.items.length, 1)
  assert.equal(missing.items[0].service.id, "d3")
  assert.deepEqual(
    missing.items[0].fields.map((f) => f.label),
    ["Username"],
  )
})

test("invalid 2FA secrets", () => {
  const invalid = issue(report, "invalid_totp")
  assert.equal(invalid.severity, "critical")
  assert.deepEqual(
    invalid.items.map((i) => [i.service.id, i.fields.map((f) => f.key)]),
    [["d2", ["2fa_key"]]],
  )
})

test("services whose type no longer exists", () => {
  const missingType = issue(report, "missing_type")
  assert.deepEqual(missingType.items, [{ id: "x1", label: "Ghost", serviceTypeId: "deleted-type", typeName: null }])
})

test("weak passwords in password-like secret fields", () => {
  const weak = issue(report, "weak_passwords")
  assert.deepEqual(
    weak.items.map((i) => i.service.id),
    ["d3", "o1"],
  )
  assert.ok(isPasswordField({ key: "recovery_email_access_password", label: "Recovery Password", type: "secret" }))
  assert.ok(!isPasswordField({ key: "proxy_string", label: "Proxy String", type: "secret" }))
  assert.ok(!isPasswordField({ key: "password", label: "Password", type: "text" }))
})

test("reused values: grouped by normalised value with reasons and severities", () => {
  const reuse = issue(report, "reused_values")
  assert.equal(reuse.severity, "critical")
  const byIds = new Map(reuse.items.map((g) => [`${g.category}:${g.services.map((s) => s.id).sort().join(",")}`, g]))

  // Same password in two services of different accounts: links the personas.
  const pw = byIds.get("password:d1,d2")
  assert.ok(pw, "password reuse across accounts")
  assert.equal(pw.category, "password")
  assert.equal(pw.reason, "cross_account")
  assert.equal(pw.severity, "critical")
  assert.equal(pw.accountCount, 2)
  assert.ok(pw.secret)

  // Email reused across types and accounts, case/whitespace-insensitive.
  const email = byIds.get("email:d1,d2,g1")
  assert.ok(email, "email reuse")
  assert.equal(email.category, "email")
  assert.equal(email.reason, "cross_account")
  assert.equal(email.severity, "warning")
  assert.deepEqual(email.typeNames.sort(), ["Discord", "Email"])

  // Weak password reused by two services of one account + an unlinked one (different types).
  const weakPw = byIds.get("password:d3,o1")
  assert.ok(weakPw, "password reuse within one persona")
  assert.equal(weakPw.reason, "password")
  assert.equal(weakPw.severity, "warning")

  // Same proxy (endpoint and credentials) written in two formats: duplicate within the Proxy type.
  const px = byIds.get("proxy:p1,p2")
  assert.ok(px, "proxy reuse")
  assert.equal(px.category, "proxy")
  assert.equal(px.reason, "same_type")

  // Both Discord services point to the same Proxy service from different accounts.
  const link = reuse.items.find((g) => g.category === "linked_service")
  assert.ok(link, "shared linked service")
  assert.equal(link.linkedService?.id, "p1")
  assert.equal(link.reason, "cross_account")

  // Non-identifying values (IMAP host, URLs) are never compared.
  assert.ok(!reuse.items.some((g) => g.fieldLabels.includes("IMAP Host") || g.fieldLabels.includes("Site")))
  assert.equal(reuse.items.length, 5)
})

test("identifiers shared inside one persona are not reported", () => {
  const r = analyseVault(
    makeVault(
      [
        svc("m", "email", "Mail", { email: "same@example.com", password: STRONG_A }),
        svc("d", "discord", "Discord", { username: "u", email: "same@example.com", password: STRONG_B }),
      ],
      [acc("A", "A", ["m", "d"])],
    ),
  )
  assert.equal(
    r.issues.find((i) => i.kind === "reused_values"),
    undefined,
  )
})

// The default Email type, with its recovery mailbox fields (src-tauri/src/defaults.rs).
const emailFull: ServiceType = {
  id: "email",
  name: "Email",
  icon: "",
  fields: [
    { id: "g-1", key: "display_name", label: "Name", type: "text", masked: false, required: false },
    { id: "g-2", key: "email", label: "Email", type: "text", masked: false, required: true },
    { id: "g-3", key: "password", label: "Password", type: "secret", masked: true, required: true },
    { id: "g-4", key: "recovery_email", label: "Recovery Email", type: "text", masked: false, required: false },
    { id: "g-5", key: "recovery_email_access_url", label: "Recovery Email Access URL", type: "url", masked: false, required: false },
    {
      id: "g-6",
      key: "recovery_email_access_password",
      label: "Recovery Email Access Password",
      type: "secret",
      masked: true,
      required: false,
    },
    { id: "g-7", key: "2fa_key", label: "2FA Key", type: "2fa", masked: true, required: false },
  ],
}

function reuseGroups(r: HealthReport) {
  return r.issues.find((i) => i.kind === "reused_values")?.items ?? []
}

test("a mailbox stored as another mailbox's recovery is not reuse", () => {
  const r = analyseVault(
    makeVault(
      [
        svc("main", "email", "Main", { email: "main.persona@example.com", password: STRONG_A }),
        svc("second", "email", "Second", {
          email: "second.persona@example.com",
          password: STRONG_B,
          recovery_email: "main.persona@example.com",
          recovery_email_access_password: STRONG_A,
        }),
      ],
      [acc("A", "A", ["main", "second"])],
      [emailFull],
    ),
  )
  assert.deepEqual(reuseGroups(r), [])
  assert.equal(r.status, "healthy")
  assert.equal(r.score, 100)
})

test("several mailboxes of one persona sharing one recovery mailbox are not reuse", () => {
  const recovery = { recovery_email: "rescue@example.com", recovery_email_access_password: STRONG_C }
  const r = analyseVault(
    makeVault(
      [
        svc("m1", "email", "M1", { email: "m1@example.com", password: STRONG_A, ...recovery }),
        svc("m2", "email", "M2", { email: "m2@example.com", password: STRONG_B, ...recovery }),
        svc("m3", "email", "M3", { email: "m3@example.com", password: `${STRONG_A}x`, ...recovery }),
      ],
      [acc("A", "A", ["m1", "m2", "m3"])],
      [emailFull],
    ),
  )
  assert.deepEqual(reuseGroups(r), [])
})

test("one recovery mailbox shared by two personas links them", () => {
  const recovery = { recovery_email: "rescue@example.com", recovery_email_access_password: STRONG_C }
  const r = analyseVault(
    makeVault(
      [
        svc("m1", "email", "M1", { email: "m1@example.com", password: STRONG_A, ...recovery }),
        svc("m2", "email", "M2", { email: "m2@example.com", password: STRONG_B, ...recovery }),
      ],
      [acc("A", "A", ["m1"]), acc("B", "B", ["m2"])],
      [emailFull],
    ),
  )
  const groups = reuseGroups(r)
  assert.deepEqual(
    groups.map((g) => [g.category, g.reason, g.severity, g.fieldLabels]),
    [
      ["password", "cross_account", "critical", ["Recovery Email Access Password"]],
      ["email", "cross_account", "warning", ["Recovery Email"]],
    ],
  )
  const json = JSON.stringify(r)
  assert.ok(!json.includes("rescue@example.com") && !json.includes(STRONG_C))
})

test("one persona's mailbox stored as another persona's recovery mailbox links them", () => {
  const r = analyseVault(
    makeVault(
      [
        svc("a1", "email", "A mail", { email: "persona.a@example.com", password: STRONG_A }),
        svc("b1", "email", "B mail", {
          email: "persona.b@example.com",
          password: STRONG_B,
          recovery_email: " Persona.A@example.com",
          recovery_email_access_password: STRONG_A,
        }),
      ],
      [acc("A", "A", ["a1"]), acc("B", "B", ["b1"])],
      [emailFull],
    ),
  )
  const groups = reuseGroups(r)
  assert.deepEqual(
    groups.map((g) => [g.category, g.reason, g.severity, g.accountCount, g.services.map((s) => s.id), g.fieldLabels]),
    [
      ["password", "cross_account", "critical", 2, ["a1", "b1"], ["Password", "Recovery Email Access Password"]],
      ["email", "cross_account", "warning", 2, ["a1", "b1"], ["Email", "Recovery Email"]],
    ],
  )
  assert.equal(r.status, "at_risk")
  const json = JSON.stringify(r)
  assert.ok(!json.toLowerCase().includes("persona.a@example.com") && !json.includes(STRONG_A))
})

test("a recovery link across personas is found whatever the field holding the primary value", () => {
  // Persona A's Discord login email is persona B's recovery mailbox.
  const r = analyseVault(
    makeVault(
      [
        svc("d", "discord", "A Discord", { username: "a_handle", email: "persona.a@example.com", password: STRONG_A }),
        svc("m", "email", "B mail", { email: "persona.b@example.com", password: STRONG_B, recovery_email: "persona.a@example.com" }),
      ],
      [acc("A", "A", ["d"]), acc("B", "B", ["m"])],
      [discord, emailFull],
    ),
  )
  assert.deepEqual(
    reuseGroups(r).map((g) => [g.category, g.reason, g.fieldLabels]),
    [["email", "cross_account", ["Email", "Recovery Email"]]],
  )
})

test("default Email schema: a mailbox's own recovery fields inside one persona are not reuse", () => {
  const r = analyseVault(
    makeVault(
      [
        // The recovery fields repeat the service's own primary values.
        svc("self", "email", "Self", {
          email: "self@example.com",
          password: STRONG_A,
          recovery_email: "SELF@example.com",
          recovery_email_access_password: STRONG_A,
        }),
        // Another mailbox of the same persona whose recovery is the first one.
        svc("other", "email", "Other", {
          email: "other@example.com",
          password: STRONG_B,
          recovery_email: "self@example.com",
          recovery_email_access_password: STRONG_A,
        }),
        // An unlinked mailbox pointing at the same recovery mailbox.
        svc("loose", "email", "Loose", {
          email: "loose@example.com",
          password: STRONG_C,
          recovery_email: "self@example.com",
          recovery_email_access_password: STRONG_A,
        }),
      ],
      [acc("A", "A", ["self", "other"])],
      [emailFull],
    ),
  )
  assert.deepEqual(reuseGroups(r), [])
})

test("within one persona, primary reuse is reported without the recovery copies", () => {
  const r = analyseVault(
    makeVault(
      [
        svc("m1", "email", "M1", { email: "m1@example.com", password: STRONG_A }),
        svc("m2", "email", "M2", { email: "m2@example.com", password: STRONG_A }),
        svc("m3", "email", "M3", { email: "m3@example.com", password: STRONG_B, recovery_email_access_password: STRONG_A }),
        svc("d", "discord", "D", { username: "u", email: "m3@example.com", password: STRONG_C }),
        svc("d2", "discord", "D2", { username: "u2", email: "d2@example.com", password: STRONG_C }),
      ],
      [acc("A", "A", ["m1", "m2", "m3", "d", "d2"])],
      [discord, emailFull],
    ),
  )
  const groups = reuseGroups(r)
  assert.deepEqual(
    groups.map((g) => [g.category, g.reason, g.severity, g.services.map((s) => s.id), g.fieldLabels]),
    [
      ["password", "same_type", "warning", ["m1", "m2"], ["Password"]],
      ["password", "same_type", "warning", ["d", "d2"], ["Password"]],
    ],
  )
})

test("primary values are still compared across types and accounts under the same class", () => {
  const r = analyseVault(
    makeVault(
      [
        svc("m1", "email", "M1", { email: "shared@example.com", password: STRONG_A }),
        svc("m2", "email", "M2", { email: "SHARED@example.com ", password: STRONG_B }),
      ],
      [acc("A", "A", ["m1"]), acc("B", "B", ["m2"])],
      [emailFull],
    ),
  )
  const groups = reuseGroups(r)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].reason, "cross_account")
  assert.deepEqual(groups[0].fieldLabels, ["Email"])
})

test("same-type duplicates need the value in the same field", () => {
  const contacts: ServiceType = {
    id: "contacts",
    name: "Contacts",
    icon: "",
    fields: [
      { id: "c-1", key: "email", label: "Email", type: "text", masked: false, required: false },
      { id: "c-2", key: "work_email", label: "Work Email", type: "text", masked: false, required: false },
    ],
  }
  const crossField = analyseVault(
    makeVault(
      [svc("c1", "contacts", "C1", { email: "x@example.com" }), svc("c2", "contacts", "C2", { work_email: "x@example.com" })],
      [acc("A", "A", ["c1", "c2"])],
      [contacts],
    ),
  )
  assert.deepEqual(reuseGroups(crossField), [])

  const sameField = analyseVault(
    makeVault(
      [svc("c1", "contacts", "C1", { email: "x@example.com" }), svc("c2", "contacts", "C2", { email: "x@example.com" })],
      [acc("A", "A", ["c1", "c2"])],
      [contacts],
    ),
  )
  assert.deepEqual(
    reuseGroups(sameField).map((g) => [g.reason, g.severity]),
    [["same_type", "info"]],
  )
})

test("different users on one proxy gateway are not reuse; the same full proxy is", () => {
  const gateway = analyseVault(
    makeVault(
      [
        svc("pa", "proxy", "PA", { proxy_string: "gate.example-proxy.io:7000:customer-abc-session-111:pw1" }),
        svc("pb", "proxy", "PB", { proxy_string: "gate.example-proxy.io:7000:customer-abc-session-222:pw2" }),
        svc("pc", "proxy", "PC", { proxy_string: "http://customer-abc-country-de:pw3@gate.example-proxy.io:7000" }),
      ],
      [acc("A", "A", ["pa"]), acc("B", "B", ["pb"]), acc("C", "C", ["pc"])],
    ),
  )
  assert.deepEqual(reuseGroups(gateway), [])
  assert.equal(gateway.status, "healthy")

  const shared = analyseVault(
    makeVault(
      [
        svc("pa", "proxy", "PA", { proxy_string: "GATE.example-proxy.io:7000:customer-abc-session-111:pw1" }),
        svc("pb", "proxy", "PB", { proxy_string: "socks5://customer-abc-session-111:pw1@gate.example-proxy.io:7000" }),
        // Same user, different password: a different identity.
        svc("pc", "proxy", "PC", { proxy_string: "gate.example-proxy.io:7000:customer-abc-session-111:PW1" }),
      ],
      [acc("A", "A", ["pa"]), acc("B", "B", ["pb"]), acc("C", "C", ["pc"])],
    ),
  )
  const groups = reuseGroups(shared)
  assert.equal(groups.length, 1)
  assert.deepEqual(
    groups[0].services.map((s) => s.id),
    ["pa", "pb"],
  )
  assert.equal(groups[0].reason, "cross_account")
  assert.equal(groups[0].severity, "critical")
  assert.ok(!JSON.stringify(shared).includes("example-proxy"))
})

test("the report contains no secret or field values", () => {
  const json = JSON.stringify(report)
  for (const service of services) {
    for (const [key, value] of Object.entries(service.data)) {
      if (key === "proxy") continue // linked_service values are service ids
      const trimmed = value.trim()
      if (!trimmed) continue
      assert.ok(!json.includes(trimmed), `report leaks ${service.id}.${key}`)
      assert.ok(!json.toLowerCase().includes(trimmed.toLowerCase()), `report leaks ${service.id}.${key} (case)`)
    }
  }
  assert.ok(!json.includes("10.20.30.40"))
})

test("totals, score and status", () => {
  assert.equal(report.status, "at_risk")
  assert.ok(report.score < 100 && report.score >= 0)
  assert.equal(report.totals.accounts, 4)
  assert.equal(report.totals.services, 9)
  assert.equal(
    report.totals.issues,
    report.issues.reduce((sum, i) => sum + i.count, 0),
  )
  // Most severe first.
  assert.equal(report.issues[0].severity, "critical")
})

test("a clean vault is healthy with score 100", () => {
  const clean = analyseVault(
    makeVault(
      [svc("m", "email", "Mail", { email: "a@example.com", password: STRONG_A })],
      [acc("A", "A", ["m"])],
    ),
  )
  assert.deepEqual(clean.issues, [])
  assert.equal(clean.score, 100)
  assert.equal(clean.status, "healthy")
  assert.equal(computeHealthScore([]), 100)
})

test("tolerates an empty vault and handles thousands of services quickly", () => {
  assert.equal(analyseVault(makeVault([], [])).status, "healthy")

  const many: Service[] = []
  const manyAccounts: Account[] = []
  for (let i = 0; i < 5000; i++) {
    many.push(svc(`s${i}`, "email", `Mail ${i}`, { email: `user${i}@example.com`, password: `${STRONG_A}${i}` }))
    manyAccounts.push(acc(`a${i}`, `Acc ${i}`, [`s${i}`]))
  }
  const started = Date.now()
  const big = analyseVault(makeVault(many, manyAccounts))
  assert.ok(Date.now() - started < 3000, "analysis is fast")
  assert.equal(big.status, "healthy")
})
