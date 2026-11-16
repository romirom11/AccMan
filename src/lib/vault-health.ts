// Pure vault health analysis (no React). Only type imports from "@/", so it runs under `node --test`.
//
// The report never contains secret values: reused values are grouped in memory by their normalised
// value, but only field labels, counts and the affected service/account ids and labels are returned.
import type { Account, Service, ServiceField, ServiceType, Vault } from "@/types"
import { getServiceTitle, isSecretField } from "./service-helpers.ts"
import { isValidTotpSecret, normalizeBase32Secret } from "./totp.ts"
import { estimateStrength } from "./password.ts"

export type HealthSeverity = "info" | "warning" | "critical"

export type HealthStatus = "healthy" | "needs_attention" | "at_risk"

export type HealthIssueKind =
  | "reused_values"
  | "invalid_totp"
  | "missing_type"
  | "weak_passwords"
  | "missing_required"
  | "orphan_services"
  | "empty_accounts"

export interface AccountRef {
  id: string
  label: string
}

export interface ServiceRef {
  id: string
  /** Display title (label, falling back to the type name). */
  label: string
  serviceTypeId: string
  /** null when the service type no longer exists. */
  typeName: string | null
}

export interface FieldRef {
  key: string
  label: string
}

/** One service and the fields of it that have the problem (labels only, never values). */
export interface ServiceFieldsItem {
  service: ServiceRef
  fields: FieldRef[]
}

export type ReuseCategory = "password" | "email" | "proxy" | "linked_service" | "field"

/**
 * Why a reuse group is reported:
 * - cross_account: the services belong to two or more accounts, so the shared value links those personas
 *   (whichever fields hold it, recovery fields included);
 * - same_type: two or more services of the same type share it in the same field (duplicate entry or identity);
 * - password: a password is reused by several services in primary password fields (within one persona or
 *   unlinked services).
 * Inside one persona, recovery/backup fields (e.g. the Email type's recovery mailbox) are not compared.
 */
export type ReuseReason = "cross_account" | "same_type" | "password"

export interface ReuseGroup {
  /** Stable within one report; contains no value. */
  key: string
  category: ReuseCategory
  reason: ReuseReason
  severity: HealthSeverity
  /** Whether the shared value comes from a secret field. */
  secret: boolean
  /** Distinct labels of the fields that hold the shared value. */
  fieldLabels: string[]
  /** Distinct type names of the services involved. */
  typeNames: string[]
  serviceCount: number
  accountCount: number
  services: ServiceRef[]
  /** For linked_service groups: the service that several services point to. */
  linkedService?: ServiceRef
}

interface IssueBase {
  severity: HealthSeverity
  /** Number of rows (items) in the issue. */
  count: number
  /** Number of distinct accounts/services affected. */
  affected: number
}

export type HealthIssue =
  | (IssueBase & { kind: "reused_values"; items: ReuseGroup[] })
  | (IssueBase & { kind: "invalid_totp"; items: ServiceFieldsItem[] })
  | (IssueBase & { kind: "missing_type"; items: ServiceRef[] })
  | (IssueBase & { kind: "weak_passwords"; items: ServiceFieldsItem[] })
  | (IssueBase & { kind: "missing_required"; items: ServiceFieldsItem[] })
  | (IssueBase & { kind: "orphan_services"; items: ServiceRef[] })
  | (IssueBase & { kind: "empty_accounts"; items: AccountRef[] })

export interface HealthReport {
  /** Only issues with at least one item, most severe first. */
  issues: HealthIssue[]
  /** 0..100 */
  score: number
  status: HealthStatus
  totals: {
    accounts: number
    services: number
    serviceTypes: number
    /** Sum of all issue counts. */
    issues: number
    critical: number
    warning: number
    info: number
  }
}

export const SEVERITY_RANK: Record<HealthSeverity, number> = { critical: 2, warning: 1, info: 0 }

/** Password strength scores at or below this are reported as weak. */
export const WEAK_PASSWORD_MAX_SCORE = 1

const KIND_ORDER: readonly HealthIssueKind[] = [
  "reused_values",
  "invalid_totp",
  "missing_type",
  "weak_passwords",
  "missing_required",
  "orphan_services",
  "empty_accounts",
]

// ---------------------------------------------------------------------------------------------
// Field classification

const PASSWORD_RE = /pass|pwd|парол|parol/i
const EMAIL_RE = /e-?mail|пошт/i
const PROXY_RE = /proxy|проксі/i
// Non-secret text fields that identify a persona. Hosts, ports, names, URLs and notes are not
// compared because sharing them is normal (every Gmail service has the same IMAP host).
const IDENTIFIER_RE =
  /(^|[_\s])(e?mail|login|user(name)?|address|wallet|phone|tel|ip|proxy|nick(name)?|handle)([_\s]|$)|e-?mail|пошт|логін|телефон|адрес|гаман/i
const LEGACY_TOTP_KEYS = new Set(["2fa_key", "totp", "totp_secret"])
// Recovery/backup identities (the Email type's recovery mailbox and its password). Inside one persona
// they normally repeat another of its mailboxes (or are shared by several of them), so there they are
// ignored. Across personas they are compared with every other field: persona A's mailbox stored as
// persona B's recovery mailbox links the two personas.
const SECONDARY_RE = /recover|backup|secondary|резерв|відновл|запасн/i

function fieldText(field: Pick<ServiceField, "key" | "label">): string {
  return `${field.key} ${field.label}`
}

/** Password-like fields: secret fields whose key or label mentions a password. */
export function isPasswordField(field: Pick<ServiceField, "key" | "label" | "type">): boolean {
  return field.type === "secret" && PASSWORD_RE.test(fieldText(field))
}

function isTotpLikeField(field: Pick<ServiceField, "key" | "type">): boolean {
  return field.type === "2fa" || LEGACY_TOTP_KEYS.has(field.key)
}

function reuseCategory(field: ServiceField): ReuseCategory {
  if (field.type === "linked_service") return "linked_service"
  const text = fieldText(field)
  if (PASSWORD_RE.test(text) && isSecretField(field)) return "password"
  if (EMAIL_RE.test(text)) return "email"
  if (PROXY_RE.test(text)) return "proxy"
  return "field"
}

type ReuseRole = "primary" | "secondary"

function reuseRole(field: ServiceField, category: ReuseCategory): ReuseRole {
  if (category !== "email" && category !== "password") return "primary"
  return SECONDARY_RE.test(fieldText(field)) ? "secondary" : "primary"
}

/** Fields whose values are compared across services. */
function isReuseCandidate(field: ServiceField): boolean {
  if (field.type === "linked_service") return true
  if (isSecretField(field)) return true
  return field.type === "text" && IDENTIFIER_RE.test(fieldText(field))
}

/**
 * Full identity of a proxy string in either usual format (scheme://user:pass@host:port or
 * host:port:user:pass): lower-cased host:port plus the credentials, kept verbatim. Providers give
 * every customer one gateway host:port and tell sessions apart by the username, so the endpoint
 * alone is not a reuse; the same endpoint with the same credentials is, in whichever format.
 */
function proxyIdentity(value: string): string {
  let rest = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
  let credentials = ""
  const at = rest.lastIndexOf("@")
  if (at >= 0) {
    credentials = rest.slice(0, at)
    rest = rest.slice(at + 1)
  }
  rest = rest.replace(/\/+$/, "")
  const parts = rest.split(":")
  if (at < 0 && parts.length > 2) credentials = parts.slice(2).join(":")
  const endpoint = parts.length >= 2 ? `${parts[0].toLowerCase()}:${parts[1]}` : rest.toLowerCase()
  return credentials ? `${endpoint}\u0000${credentials}` : endpoint
}

/** The comparable form of a value, or "" when it should not be compared. */
function normaliseValue(field: ServiceField, category: ReuseCategory, raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  if (category === "linked_service") return trimmed
  if (isTotpLikeField(field)) return normalizeBase32Secret(trimmed) ?? trimmed.toUpperCase()
  if (category === "password") return trimmed
  const collapsed = trimmed.replace(/\s+/g, " ")
  if (category === "proxy") return proxyIdentity(collapsed)
  if (category === "email" || !isSecretField(field)) return collapsed.toLowerCase()
  return collapsed
}

// ---------------------------------------------------------------------------------------------
// Analysis

interface ReuseBucket {
  category: ReuseCategory
  /** Service id → its fields that hold the value, in first-seen order of services. */
  fieldsByService: Map<string, ServiceField[]>
  /** First field key seen; used for the group key only. */
  fieldKey: string
  linkedTargetId?: string
}

function maxSeverity(severities: Iterable<HealthSeverity>): HealthSeverity {
  let best: HealthSeverity = "info"
  for (const s of severities) if (SEVERITY_RANK[s] > SEVERITY_RANK[best]) best = s
  return best
}

function makeIssue<K extends HealthIssue["kind"]>(
  kind: K,
  severity: HealthSeverity,
  items: Extract<HealthIssue, { kind: K }>["items"],
  affected: number,
): HealthIssue {
  return { kind, severity, count: items.length, affected, items } as HealthIssue
}

const FIRST_ITEM_PENALTY: Record<HealthSeverity, number> = { critical: 20, warning: 8, info: 2 }
const EXTRA_ITEM_PENALTY: Record<HealthSeverity, number> = { critical: 4, warning: 1.5, info: 0.25 }
const MAX_EXTRA_ITEMS = 10

/** 100 for a clean vault; each issue costs a base penalty by severity plus a little per extra item. */
export function computeHealthScore(issues: readonly Pick<HealthIssue, "severity" | "count">[]): number {
  let penalty = 0
  for (const issue of issues) {
    if (issue.count <= 0) continue
    penalty += FIRST_ITEM_PENALTY[issue.severity]
    penalty += EXTRA_ITEM_PENALTY[issue.severity] * Math.min(issue.count - 1, MAX_EXTRA_ITEMS)
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)))
}

/**
 * Analyses the vault in O(services × fields + accounts × links) using maps.
 * Never throws for well-formed vaults; tolerates missing arrays and data.
 */
export function analyseVault(vault: Vault): HealthReport {
  const serviceTypes: readonly ServiceType[] = vault.serviceTypes ?? []
  const services: readonly Service[] = vault.services ?? []
  const accounts: readonly Account[] = vault.accounts ?? []

  const typesById = new Map<string, ServiceType>()
  for (const type of serviceTypes) typesById.set(type.id, type)

  const servicesById = new Map<string, Service>()
  for (const service of services) servicesById.set(service.id, service)

  const refCache = new Map<string, ServiceRef>()
  const serviceRef = (service: Service): ServiceRef => {
    let ref = refCache.get(service.id)
    if (!ref) {
      const type = typesById.get(service.serviceTypeId)
      ref = {
        id: service.id,
        label: getServiceTitle(service, type),
        serviceTypeId: service.serviceTypeId,
        typeName: type ? type.name : null,
      }
      refCache.set(service.id, ref)
    }
    return ref
  }

  // Accounts that link each (existing) service.
  const accountsByService = new Map<string, string[]>()
  const emptyAccounts: AccountRef[] = []
  for (const account of accounts) {
    let linked = 0
    const seen = new Set<string>()
    for (const serviceId of account.linkedServices ?? []) {
      if (!servicesById.has(serviceId) || seen.has(serviceId)) continue
      seen.add(serviceId)
      linked++
      const list = accountsByService.get(serviceId)
      if (list) list.push(account.id)
      else accountsByService.set(serviceId, [account.id])
    }
    if (linked === 0) emptyAccounts.push({ id: account.id, label: account.label })
  }

  const missingType: ServiceRef[] = []
  const orphanServices: ServiceRef[] = []
  const missingRequired: ServiceFieldsItem[] = []
  const invalidTotp: ServiceFieldsItem[] = []
  const weakPasswords: ServiceFieldsItem[] = []
  const buckets = new Map<string, ReuseBucket>()

  for (const service of services) {
    if (!accountsByService.has(service.id)) orphanServices.push(serviceRef(service))

    const type = typesById.get(service.serviceTypeId)
    if (!type) {
      missingType.push(serviceRef(service))
      continue
    }

    const data = service.data ?? {}
    const missing: FieldRef[] = []
    const invalid: FieldRef[] = []
    const weak: FieldRef[] = []

    for (const field of type.fields) {
      const raw = data[field.key]
      const value = typeof raw === "string" ? raw : ""
      const hasValue = value.trim() !== ""

      if (!hasValue) {
        if (field.required) missing.push({ key: field.key, label: field.label })
        continue
      }

      if (isTotpLikeField(field) && !isValidTotpSecret(value)) {
        invalid.push({ key: field.key, label: field.label })
      }

      if (isPasswordField(field) && estimateStrength(value).score <= WEAK_PASSWORD_MAX_SCORE) {
        weak.push({ key: field.key, label: field.label })
      }

      if (!isReuseCandidate(field)) continue
      const category = reuseCategory(field)
      const normalised = normaliseValue(field, category, value)
      if (!normalised) continue
      // linked_service values only matter when they point to an existing service.
      if (category === "linked_service" && !servicesById.has(normalised)) continue

      // The role (primary/recovery) is deliberately not part of the key: a primary value and a
      // recovery value still meet here, so a cross-account link through a recovery field is found.
      const bucketKey =
        category === "field" ? `field\u0000${field.key}\u0000${normalised}` : `${category}\u0000${normalised}`
      let bucket = buckets.get(bucketKey)
      if (!bucket) {
        bucket = {
          category,
          fieldsByService: new Map(),
          fieldKey: field.key,
          linkedTargetId: category === "linked_service" ? normalised : undefined,
        }
        buckets.set(bucketKey, bucket)
      }
      const held = bucket.fieldsByService.get(service.id)
      if (held) held.push(field)
      else bucket.fieldsByService.set(service.id, [field])
    }

    if (missing.length) missingRequired.push({ service: serviceRef(service), fields: missing })
    if (invalid.length) invalidTotp.push({ service: serviceRef(service), fields: invalid })
    if (weak.length) weakPasswords.push({ service: serviceRef(service), fields: weak })
  }

  // Reuse groups. The bucket map (which holds values) is local and never leaves this function.
  const reuseGroups: ReuseGroup[] = []
  let groupIndex = 0
  for (const bucket of buckets.values()) {
    if (bucket.fieldsByService.size < 2) continue

    const accountIds = new Set<string>()
    for (const serviceId of bucket.fieldsByService.keys()) {
      for (const accountId of accountsByService.get(serviceId) ?? []) accountIds.add(accountId)
    }
    const crossAccount = accountIds.size >= 2

    // Across accounts every field holding the value counts, whatever its key or role. Inside one
    // persona (or among unlinked services) recovery fields are ignored: a recovery mailbox repeating
    // another mailbox of the persona, or shared by several of them, is normal.
    const held = new Map<string, ServiceField[]>()
    for (const [serviceId, fields] of bucket.fieldsByService) {
      const kept = crossAccount ? fields : fields.filter((f) => reuseRole(f, bucket.category) === "primary")
      if (kept.length) held.set(serviceId, kept)
    }
    if (held.size < 2) continue

    // A same-type duplicate needs two services of one type holding the value in the SAME field.
    const servicesPerTypeField = new Map<string, number>()
    let sameTypeDuplicate = false
    let secret = false
    const fieldLabels = new Set<string>()
    for (const [serviceId, fields] of held) {
      const typeId = servicesById.get(serviceId)?.serviceTypeId ?? ""
      for (const field of fields) {
        if (isSecretField(field)) secret = true
        fieldLabels.add(field.label)
        const slot = `${typeId}\u0000${field.key}`
        const n = (servicesPerTypeField.get(slot) ?? 0) + 1
        servicesPerTypeField.set(slot, n)
        if (n >= 2) sameTypeDuplicate = true
      }
    }

    let reason: ReuseReason
    let severity: HealthSeverity
    if (crossAccount) {
      reason = "cross_account"
      severity = secret ? "critical" : "warning"
    } else if (sameTypeDuplicate && bucket.category !== "linked_service") {
      reason = "same_type"
      severity = secret ? "warning" : "info"
    } else if (bucket.category === "password") {
      reason = "password"
      severity = "warning"
    } else {
      continue
    }

    const groupServices = [...held.keys()].map((id) => serviceRef(servicesById.get(id) as Service))
    const typeNames: string[] = []
    const seenTypeNames = new Set<string>()
    for (const ref of groupServices) {
      const name = ref.typeName ?? ""
      if (name && !seenTypeNames.has(name)) {
        seenTypeNames.add(name)
        typeNames.push(name)
      }
    }
    const linkedTarget = bucket.linkedTargetId ? servicesById.get(bucket.linkedTargetId) : undefined

    reuseGroups.push({
      key: `reuse-${groupIndex++}-${bucket.category}-${bucket.fieldKey}`,
      category: bucket.category,
      reason,
      severity,
      secret,
      fieldLabels: [...fieldLabels],
      typeNames,
      serviceCount: groupServices.length,
      accountCount: accountIds.size,
      services: groupServices,
      ...(linkedTarget ? { linkedService: serviceRef(linkedTarget) } : {}),
    })
  }
  reuseGroups.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.accountCount - a.accountCount ||
      b.serviceCount - a.serviceCount,
  )

  const issues: HealthIssue[] = []
  if (reuseGroups.length) {
    const affected = new Set<string>()
    for (const group of reuseGroups) for (const s of group.services) affected.add(s.id)
    issues.push(makeIssue("reused_values", maxSeverity(reuseGroups.map((g) => g.severity)), reuseGroups, affected.size))
  }
  if (invalidTotp.length) issues.push(makeIssue("invalid_totp", "critical", invalidTotp, invalidTotp.length))
  if (missingType.length) issues.push(makeIssue("missing_type", "warning", missingType, missingType.length))
  if (weakPasswords.length) issues.push(makeIssue("weak_passwords", "warning", weakPasswords, weakPasswords.length))
  if (missingRequired.length) {
    issues.push(makeIssue("missing_required", "warning", missingRequired, missingRequired.length))
  }
  if (orphanServices.length) issues.push(makeIssue("orphan_services", "info", orphanServices, orphanServices.length))
  if (emptyAccounts.length) issues.push(makeIssue("empty_accounts", "info", emptyAccounts, emptyAccounts.length))

  issues.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  )

  const bySeverity: Record<HealthSeverity, number> = { critical: 0, warning: 0, info: 0 }
  let issueTotal = 0
  for (const issue of issues) {
    issueTotal += issue.count
    if (issue.kind === "reused_values") {
      for (const group of issue.items) bySeverity[group.severity]++
    } else {
      bySeverity[issue.severity] += issue.count
    }
  }

  const status: HealthStatus =
    bySeverity.critical > 0 ? "at_risk" : bySeverity.warning > 0 ? "needs_attention" : "healthy"

  return {
    issues,
    score: computeHealthScore(issues),
    status,
    totals: {
      accounts: accounts.length,
      services: services.length,
      serviceTypes: serviceTypes.length,
      issues: issueTotal,
      critical: bySeverity.critical,
      warning: bySeverity.warning,
      info: bySeverity.info,
    },
  }
}
