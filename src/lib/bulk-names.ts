// Pure helpers for bulk account creation. They mirror the backend rule in
// src-tauri/src/vault_ops.rs (bulk_create_accounts): the number is `startNumber + index`, the same
// number is used for the account label and every service name lookup, and a template without
// `%n%` gets " %n%" appended. Only type imports from "@/", so it also runs under `node --test`.
import type { Service } from "@/types"

export const BULK_NUMBER_PLACEHOLDER = "%n%"
/** Backend limit (MAX_BULK_COUNT). */
export const MAX_BULK_COUNT = 1000
/** count and startNumber are u32 on the backend. */
export const MAX_U32 = 4_294_967_295

/** The template as the backend uses it: trimmed, with " %n%" appended when the placeholder is missing. */
export function withNumberPlaceholder(template: string): string {
  const trimmed = template.trim()
  return trimmed.includes(BULK_NUMBER_PLACEHOLDER) ? trimmed : `${trimmed} ${BULK_NUMBER_PLACEHOLDER}`
}

/** The name generated for `number` (every `%n%` is replaced). */
export function renderBulkName(template: string, number: number): string {
  return withNumberPlaceholder(template).split(BULK_NUMBER_PLACEHOLDER).join(String(number))
}

/** Parses a non-negative decimal integer typed by the user; null for anything else (empty, "-3", "1.5", "1e3"). */
export function parseNonNegativeInt(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : null
}

export type BulkNumbersError = "count_invalid" | "start_invalid" | "range_too_large"

export type BulkNumbersResult =
  | { ok: true; count: number; startNumber: number; lastNumber: number }
  | { ok: false; countError?: BulkNumbersError; startError?: BulkNumbersError }

/** Validates the raw "count" and "start number" inputs against the backend limits. */
export function validateBulkNumbers(countRaw: string, startRaw: string): BulkNumbersResult {
  const count = parseNonNegativeInt(countRaw)
  const startNumber = parseNonNegativeInt(startRaw)
  const countError: BulkNumbersError | undefined =
    count === null || count < 1 || count > MAX_BULK_COUNT ? "count_invalid" : undefined
  let startError: BulkNumbersError | undefined =
    startNumber === null || startNumber > MAX_U32 ? "start_invalid" : undefined
  if (!countError && !startError && startNumber! + count! - 1 > MAX_U32) startError = "range_too_large"
  if (countError || startError) return { ok: false, countError, startError }
  return { ok: true, count: count!, startNumber: startNumber!, lastNumber: startNumber! + count! - 1 }
}

export interface BulkNamePreview {
  first: string
  /** Undefined when only one name is generated. */
  last?: string
}

/** First and last generated names, or null when the template is empty. */
export function previewBulkNames(template: string, startNumber: number, count: number): BulkNamePreview | null {
  if (!template.trim() || count < 1) return null
  const first = renderBulkName(template, startNumber)
  return count > 1 ? { first, last: renderBulkName(template, startNumber + count - 1) } : { first }
}

/**
 * How many of the generated service names match an existing service of the type (exact label,
 * like the backend lookup). Used to warn before submitting.
 */
export function countMatchingServices(
  services: readonly Pick<Service, "serviceTypeId" | "label">[],
  serviceTypeId: string,
  template: string,
  startNumber: number,
  count: number,
): number {
  if (!serviceTypeId || !template.trim() || count < 1) return 0
  const labels = new Set<string>()
  for (const service of services) {
    if (service.serviceTypeId === serviceTypeId) labels.add(service.label)
  }
  if (labels.size === 0) return 0
  let matches = 0
  for (let index = 0; index < count; index++) {
    if (labels.has(renderBulkName(template, startNumber + index))) matches++
  }
  return matches
}
