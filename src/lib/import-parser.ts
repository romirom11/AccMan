// Pure parsing and planning for the bulk service import (pages/services-import.tsx).
// No React and only type imports from "@/", so it also runs under `node --test`.
//
// Column mappings are structured objects keyed by column index. They are never encoded into or
// decoded from strings with split(), because type ids and field keys may contain any character.
// The label column is part of the LabelStrategy, not of the column mapping, so one column can be
// both the service label and a field (e.g. an email column used as label and as the email field).
import type { Service, ServiceField, ServiceInput, ServiceType } from "@/types"
import { isSecretField } from "./service-helpers.ts"

// --- Parsing ---------------------------------------------------------------------------------

/** What the user may type in the separator box to mean a tab character. */
export const TAB_SEPARATOR_TOKEN = "\\t"

/** Turns the separator typed by the user into the real separator ("\t" typed literally = tab). */
export function resolveSeparator(input: string): string {
  return input === TAB_SEPARATOR_TOKEN ? "\t" : input
}

export interface ParseOptions {
  /** Literal separator, may be several characters. Empty = no splitting (one column per line). */
  separator: string
  /**
   * Split each line into at most `columns` cells; the last cell keeps the rest of the line,
   * separators included (proxy strings, URLs, passwords containing the separator).
   */
  lastColumnTakesRest?: boolean
  /** Column limit for `lastColumnTakesRest`. Defaults to the most common column count. */
  columns?: number
}

export interface ParsedRow {
  /** 1-based line number in the source text (blank lines count). */
  line: number
  cells: string[]
}

export interface ParseResult {
  rows: ParsedRow[]
  /** Largest number of cells in any row. */
  columnCount: number
  /** The column limit actually applied when `lastColumnTakesRest` is on, otherwise null. */
  columnLimit: number | null
}

const LINE_BREAK = /\r\n|\r|\n/

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function splitLine(line: string, separator: string): string[] {
  return separator ? line.split(separator) : [line]
}

/** Most common column count among non-blank lines (ties: the smaller count); 0 for no rows. */
export function suggestColumnCount(text: string, separator: string): number {
  const counts = new Map<number, number>()
  for (const line of stripBom(text ?? "").split(LINE_BREAK)) {
    if (!line.trim()) continue
    const n = splitLine(line, separator).length
    counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  let best = 0
  let bestFreq = 0
  for (const [n, freq] of counts) {
    if (freq > bestFreq || (freq === bestFreq && n < best)) {
      best = n
      bestFreq = freq
    }
  }
  return best
}

/**
 * Splits text into rows of trimmed cells. Handles a UTF-8 BOM, CRLF / CR / LF line endings,
 * skips blank and whitespace-only lines, and supports multi-character separators.
 */
export function parseRows(text: string, options: ParseOptions): ParseResult {
  const separator = options.separator ?? ""
  const source = stripBom(text ?? "")
  let columnLimit: number | null = null
  if (options.lastColumnTakesRest && separator) {
    const requested = options.columns
    columnLimit =
      requested !== undefined && Number.isInteger(requested) && requested >= 1
        ? requested
        : suggestColumnCount(source, separator) || null
  }

  const rows: ParsedRow[] = []
  let columnCount = 0
  const lines = source.split(LINE_BREAK)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    let parts = splitLine(raw, separator)
    if (columnLimit !== null && parts.length > columnLimit) {
      parts = [...parts.slice(0, columnLimit - 1), parts.slice(columnLimit - 1).join(separator)]
    }
    const cells = parts.map((cell) => cell.trim())
    if (cells.length > columnCount) columnCount = cells.length
    rows.push({ line: i + 1, cells })
  }
  return { rows, columnCount, columnLimit }
}

/** Parses a non-negative integer typed by the user; null for anything else ("", "-1", "1.5", "1e3"). */
export function parseNonNegativeInteger(raw: string): number | null {
  const text = (raw ?? "").trim()
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : null
}

// --- Mapping ---------------------------------------------------------------------------------

export type ColumnMapping = { kind: "ignore" } | { kind: "tags" } | { kind: "field"; fieldKey: string }

/** Mapping per column index; a missing entry means "ignore". */
export type ColumnMappings = Readonly<Record<number, ColumnMapping>>

export type LabelStrategy =
  | { kind: "column"; column: number | null }
  | { kind: "generate"; pattern: string; startNumber: number }

export const IGNORE_MAPPING: ColumnMapping = { kind: "ignore" }

function sameMapping(a: ColumnMapping, b: ColumnMapping): boolean {
  if (a.kind !== b.kind) return false
  return a.kind !== "field" || a.fieldKey === (b as { fieldKey: string }).fieldKey
}

/** The mapping of a column ("ignore" when unset). */
export function getColumnMapping(mappings: ColumnMappings, column: number): ColumnMapping {
  return mappings[column] ?? IGNORE_MAPPING
}

/**
 * Sets the mapping of one column. A field can only be filled from one column, so mapping a field
 * removes it from any other column that had it.
 */
export function assignColumnMapping(mappings: ColumnMappings, column: number, mapping: ColumnMapping): ColumnMappings {
  const next: Record<number, ColumnMapping> = {}
  for (const [key, value] of Object.entries(mappings)) {
    const index = Number(key)
    if (index === column) continue
    if (mapping.kind === "field" && value.kind === "field" && value.fieldKey === mapping.fieldKey) continue
    next[index] = value
  }
  if (mapping.kind !== "ignore") next[column] = mapping
  return next
}

/**
 * Drops mappings that no longer apply: columns at or beyond `columnCount`, and field mappings
 * whose key is not a field of `serviceType` (all field mappings when there is no type).
 * Returns the same object when nothing changed.
 */
export function reconcileMappings(
  mappings: ColumnMappings,
  columnCount: number,
  serviceType: Pick<ServiceType, "fields"> | null | undefined,
): ColumnMappings {
  const keys = new Set((serviceType?.fields ?? []).map((f) => f.key))
  let changed = false
  const next: Record<number, ColumnMapping> = {}
  for (const [key, value] of Object.entries(mappings)) {
    const index = Number(key)
    const keep =
      Number.isInteger(index) &&
      index >= 0 &&
      index < columnCount &&
      value.kind !== "ignore" &&
      (value.kind !== "field" || keys.has(value.fieldKey))
    if (keep) next[index] = value
    else changed = true
  }
  return changed ? next : mappings
}

/** Resets a label column that is out of range. Returns the same object when nothing changed. */
export function reconcileLabelStrategy(strategy: LabelStrategy, columnCount: number): LabelStrategy {
  if (strategy.kind === "column" && strategy.column !== null && (strategy.column < 0 || strategy.column >= columnCount)) {
    return { kind: "column", column: null }
  }
  return strategy
}

export interface MappingOption {
  /** Opaque value for a <Select>; never parsed. */
  value: string
  mapping: ColumnMapping
  /** The field for "field" options. */
  field?: ServiceField
}

/**
 * Options for a column-mapping <Select>: "ignore", "tags" and one per field of the type.
 * Field option values are positional ("field:0", "field:1", ...) and are only ever looked up in
 * this list, so field keys and type ids are never parsed out of strings.
 */
export function buildMappingOptions(serviceType: Pick<ServiceType, "fields"> | null | undefined): MappingOption[] {
  const options: MappingOption[] = [
    { value: "ignore", mapping: IGNORE_MAPPING },
    { value: "tags", mapping: { kind: "tags" } },
  ]
  ;(serviceType?.fields ?? []).forEach((field, index) => {
    options.push({ value: `field:${index}`, mapping: { kind: "field", fieldKey: field.key }, field })
  })
  return options
}

/** The option value that represents `mapping` ("ignore" when no option matches). */
export function mappingToOptionValue(options: readonly MappingOption[], mapping: ColumnMapping): string {
  return options.find((option) => sameMapping(option.mapping, mapping))?.value ?? "ignore"
}

/** The mapping behind an option value ("ignore" for an unknown value). */
export function optionValueToMapping(options: readonly MappingOption[], value: string): ColumnMapping {
  return options.find((option) => option.value === value)?.mapping ?? IGNORE_MAPPING
}

// --- Planning --------------------------------------------------------------------------------

export type SkipReason = "missing_label" | "duplicate_label" | "unresolved_link" | "ambiguous_link"

export interface SkippedRow {
  /** Source line number (ParsedRow.line). */
  row: number
  reason: SkipReason
  /** The offending value: the label for label reasons, the cell for link reasons. */
  value?: string
  /** Label of the linked_service field for link reasons. */
  field?: string
}

export interface ImportWarning {
  row: number
  label: string
  /** Labels of required fields that stay empty. The service is imported anyway. */
  missingFields: string[]
}

export interface ImportPlan {
  services: ServiceInput[]
  /** Source line number of each planned service (same order as `services`). */
  sourceRows: number[]
  skipped: SkippedRow[]
  /** Services that are imported although required fields are empty (not enforced by the backend). */
  warnings: ImportWarning[]
}

export interface ImportPlanOptions {
  /** Id factory for new services; defaults to crypto.randomUUID(). */
  newId?: () => string
}

/** Comparison form of labels and lookup values: trimmed and case-insensitive. */
export function normalizeLookup(value: string): string {
  return value.trim().toLowerCase()
}

/** Splits a tags cell on commas; trims, drops empty and duplicate tags. */
export function parseTags(cell: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of cell.split(",")) {
    const tag = part.trim()
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      tags.push(tag)
    }
  }
  return tags
}

interface LinkIndex {
  byLabel: Map<string, string[]>
  byValue: Map<string, string[]>
}

function pushUnique(map: Map<string, string[]>, key: string, id: string) {
  if (!key) return
  const list = map.get(key)
  if (!list) map.set(key, [id])
  else if (!list.includes(id)) list.push(id)
}

function buildLinkIndex(targetType: ServiceType, services: readonly Service[]): LinkIndex {
  const byLabel = new Map<string, string[]>()
  const byValue = new Map<string, string[]>()
  const lookupFields = targetType.fields.filter((f) => !isSecretField(f) && f.type !== "linked_service")
  for (const service of services) {
    if (service.serviceTypeId !== targetType.id) continue
    pushUnique(byLabel, normalizeLookup(service.label), service.id)
    for (const field of lookupFields) {
      const value = service.data[field.key]
      if (typeof value === "string") pushUnique(byValue, normalizeLookup(value), service.id)
    }
  }
  return { byLabel, byValue }
}

export type LinkResolution = { status: "ok"; serviceId: string } | { status: "missing" } | { status: "ambiguous" }

/**
 * The rule for linked_service cells: match the target type's services by label first
 * (trimmed, case-insensitive); only if no label matches, by any non-secret field value of the
 * target type. More than one match at the deciding step is ambiguous.
 */
function resolveWithIndex(index: LinkIndex, cell: string): LinkResolution {
  const key = normalizeLookup(cell)
  const byLabel = index.byLabel.get(key)
  if (byLabel && byLabel.length > 0) {
    return byLabel.length === 1 ? { status: "ok", serviceId: byLabel[0] } : { status: "ambiguous" }
  }
  const byValue = index.byValue.get(key)
  if (byValue && byValue.length > 0) {
    return byValue.length === 1 ? { status: "ok", serviceId: byValue[0] } : { status: "ambiguous" }
  }
  return { status: "missing" }
}

/** Resolves one linked_service cell against the services of `targetType` (see resolveWithIndex). */
export function resolveLinkedService(targetType: ServiceType, services: readonly Service[], cell: string): LinkResolution {
  return resolveWithIndex(buildLinkIndex(targetType, services), cell)
}

/** Placeholder for the number in a generated label (the same syntax as bulk create). */
export const LABEL_NUMBER_PLACEHOLDER = "%n%"

/**
 * A generated label: every `%n%` in the pattern is replaced by the number; a pattern without the
 * placeholder gets the number appended. Leading and trailing spaces are trimmed.
 */
export function renderGeneratedLabel(pattern: string, number: number): string {
  const text = String(number)
  const label = pattern.includes(LABEL_NUMBER_PLACEHOLDER)
    ? pattern.split(LABEL_NUMBER_PLACEHOLDER).join(text)
    : `${pattern}${text}`
  return label.trim()
}

function defaultNewId(): string {
  return globalThis.crypto.randomUUID()
}

/**
 * Turns parsed rows into the services to create, plus the rows that are skipped and why.
 *
 * - Fields come from columns mapped to a field of `serviceType`; empty cells are not stored.
 *   Mappings to keys the type does not have are ignored.
 * - Tags: every "tags" column, comma-separated.
 * - Label from a column: an empty cell skips the row ("missing_label"); a label that already
 *   exists in this type, or earlier in the file, skips it ("duplicate_label"). Case-insensitive.
 * - Generated label: the pattern with `%n%` replaced by the number (or the number appended when
 *   there is no `%n%`); numbers start at `startNumber` and skip numbers whose label is already
 *   taken in this service type (other types do not matter).
 * - linked_service cells are resolved with the label-then-field-value rule; no match skips the
 *   row ("unresolved_link"), several matches skip it ("ambiguous_link").
 * - Missing required fields do not skip the row; the row is listed in `warnings`.
 */
export function buildImportPlan(
  rows: readonly ParsedRow[],
  mappings: ColumnMappings,
  serviceType: ServiceType | null | undefined,
  allTypes: readonly ServiceType[],
  existingServices: readonly Service[],
  labelStrategy: LabelStrategy,
  options: ImportPlanOptions = {},
): ImportPlan {
  const plan: ImportPlan = { services: [], sourceRows: [], skipped: [], warnings: [] }
  if (!serviceType) return plan
  const newId = options.newId ?? defaultNewId

  const fieldsByKey = new Map(serviceType.fields.map((f) => [f.key, f] as const))
  const fieldColumns: { column: number; field: ServiceField }[] = []
  const tagColumns: number[] = []
  const columns = Object.keys(mappings)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b)
  const mappedFieldKeys = new Set<string>()
  for (const column of columns) {
    const mapping = mappings[column]
    if (mapping.kind === "tags") tagColumns.push(column)
    else if (mapping.kind === "field") {
      const field = fieldsByKey.get(mapping.fieldKey)
      // One column per field: the first column wins if the mapping was built by hand.
      if (field && !mappedFieldKeys.has(field.key)) {
        mappedFieldKeys.add(field.key)
        fieldColumns.push({ column, field })
      }
    }
  }

  const linkIndexes = new Map<string, LinkIndex | null>()
  const linkIndexFor = (typeId: string | undefined): LinkIndex | null => {
    if (!typeId) return null
    if (!linkIndexes.has(typeId)) {
      const target = allTypes.find((t) => t.id === typeId)
      linkIndexes.set(typeId, target ? buildLinkIndex(target, existingServices) : null)
    }
    return linkIndexes.get(typeId) ?? null
  }

  const takenLabels = new Set<string>()
  for (const service of existingServices) {
    if (service.serviceTypeId === serviceType.id) takenLabels.add(normalizeLookup(service.label))
  }
  let nextNumber = labelStrategy.kind === "generate" ? Math.max(0, Math.floor(labelStrategy.startNumber) || 0) : 0
  const pattern = labelStrategy.kind === "generate" ? labelStrategy.pattern : ""

  for (const row of rows) {
    let label = ""
    if (labelStrategy.kind === "column") {
      label = labelStrategy.column === null ? "" : (row.cells[labelStrategy.column] ?? "").trim()
      if (!label) {
        plan.skipped.push({ row: row.line, reason: "missing_label" })
        continue
      }
    }

    const data: Record<string, string> = {}
    let failure: SkippedRow | null = null
    for (const { column, field } of fieldColumns) {
      const cell = (row.cells[column] ?? "").trim()
      if (!cell) continue
      if (field.type === "linked_service") {
        const index = linkIndexFor(field.linkedServiceTypeId)
        const resolution: LinkResolution = index ? resolveWithIndex(index, cell) : { status: "missing" }
        if (resolution.status !== "ok") {
          failure = {
            row: row.line,
            reason: resolution.status === "ambiguous" ? "ambiguous_link" : "unresolved_link",
            value: cell,
            field: field.label,
          }
          break
        }
        data[field.key] = resolution.serviceId
      } else {
        data[field.key] = cell
      }
    }
    if (failure) {
      plan.skipped.push(failure)
      continue
    }

    if (labelStrategy.kind === "column") {
      const key = normalizeLookup(label)
      if (takenLabels.has(key)) {
        plan.skipped.push({ row: row.line, reason: "duplicate_label", value: label })
        continue
      }
      takenLabels.add(key)
    } else {
      while (takenLabels.has(normalizeLookup(renderGeneratedLabel(pattern, nextNumber)))) nextNumber++
      label = renderGeneratedLabel(pattern, nextNumber)
      takenLabels.add(normalizeLookup(label))
      nextNumber++
    }

    const tags: string[] = []
    for (const column of tagColumns) {
      for (const tag of parseTags(row.cells[column] ?? "")) {
        if (!tags.includes(tag)) tags.push(tag)
      }
    }

    const missingFields = serviceType.fields.filter((f) => f.required && !data[f.key]).map((f) => f.label)
    if (missingFields.length > 0) plan.warnings.push({ row: row.line, label, missingFields })

    plan.services.push({ id: newId(), serviceTypeId: serviceType.id, label, data, tags })
    plan.sourceRows.push(row.line)
  }
  return plan
}

/** Number of skipped rows per reason. */
export function countSkippedByReason(skipped: readonly SkippedRow[]): Record<SkipReason, number> {
  const counts: Record<SkipReason, number> = {
    missing_label: 0,
    duplicate_label: 0,
    unresolved_link: 0,
    ambiguous_link: 0,
  }
  for (const entry of skipped) counts[entry.reason]++
  return counts
}
