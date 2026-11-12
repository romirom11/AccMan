// Pure helpers over the vault model. Only type imports from "@/", so it also runs under `node --test`.
import type { Account, Service, ServiceField, ServiceType } from "@/types"

type FieldLike = Pick<ServiceField, "type" | "masked">

/** Secret fields are masked in the UI, copied as secrets and never searchable. */
export function isSecretField(field: FieldLike | null | undefined): boolean {
  if (!field) return false
  return field.type === "secret" || field.type === "2fa" || field.masked === true
}

/** Fields that hold a TOTP secret (live code is shown for them). */
export function isTotpField(field: Pick<ServiceField, "type"> | null | undefined): boolean {
  return field?.type === "2fa"
}

/** Values that should be rendered with preserved line breaks. */
export function isMultilineValue(field: Pick<ServiceField, "type"> | null | undefined, value: string): boolean {
  return field?.type === "textarea" || /\r|\n/.test(value)
}

/** The Email service type: id "email" or a name equal to "email" (case-insensitive). */
export function isEmailService(type: Pick<ServiceType, "id" | "name"> | null | undefined): boolean {
  if (!type) return false
  return type.id === "email" || type.name.trim().toLowerCase() === "email"
}

export function findServiceType(
  serviceTypes: readonly ServiceType[] | null | undefined,
  serviceTypeId: string | null | undefined,
): ServiceType | undefined {
  if (!serviceTypes || !serviceTypeId) return undefined
  return serviceTypes.find((type) => type.id === serviceTypeId)
}

/** Display title of a service: its label, falling back to the type name. */
export function getServiceTitle(service: Pick<Service, "label">, serviceType?: Pick<ServiceType, "name"> | null): string {
  const label = service.label.trim()
  return label || serviceType?.name || ""
}

/**
 * Field values that may be shown in search: secret, masked and 2FA fields are excluded, and so are
 * linked_service values (they are service ids) and data keys that no field of the type declares.
 */
export function getSearchableFieldValues(service: Pick<Service, "data">, serviceType?: ServiceType | null): string[] {
  if (!serviceType) return []
  const values: string[] = []
  for (const field of serviceType.fields) {
    if (isSecretField(field) || field.type === "linked_service") continue
    const value = service.data[field.key]
    if (typeof value === "string" && value.trim()) values.push(value.trim())
  }
  return values
}

/** Lower-cased text to match a service against: label, tags, type name and NON-secret field values. */
export function buildServiceSearchText(service: Service, serviceType?: ServiceType | null): string {
  return [service.label, ...service.tags, serviceType?.name ?? "", ...getSearchableFieldValues(service, serviceType)]
    .filter(Boolean)
    .join("\n")
    .toLowerCase()
}

/** Lower-cased text to match an account against: label, tags and notes. */
export function buildAccountSearchText(account: Account): string {
  return [account.label, ...account.tags, account.notes].filter(Boolean).join("\n").toLowerCase()
}

/**
 * List-page search: case-insensitive, exact-substring, multi-term (every whitespace-separated term
 * of `query` must occur somewhere in `text`, in any order). Deliberately not fuzzy, so results are
 * predictable on long notes/field values; the command palette provides fuzzy search.
 */
export function matchesSearch(text: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = text.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/** Pinned first, then most recently updated, then by label. */
export function compareByPinnedAndRecent<T extends { pinned?: boolean; updatedAt?: number; label: string }>(
  a: T,
  b: T,
): number {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
  const byUpdated = (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  if (byUpdated !== 0) return byUpdated
  return a.label.localeCompare(b.label)
}
