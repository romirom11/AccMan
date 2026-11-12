// Pure formatting helpers for backups and exports. No React and no "@/" runtime imports.

const KIB = 1024
const MIB = 1024 * 1024

/** Human-readable size in the given locale ("12.3 kB", "1,5 МБ"). Never throws. */
export function formatBytes(bytes: number, locale: string): string {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  const units: { unit: string; size: number; short: string }[] = [
    { unit: "megabyte", size: MIB, short: "MB" },
    { unit: "kilobyte", size: KIB, short: "KB" },
  ]
  for (const { unit, size, short } of units) {
    if (value >= size) {
      try {
        return new Intl.NumberFormat(locale, { style: "unit", unit, maximumFractionDigits: 1 }).format(value / size)
      } catch {
        return `${(value / size).toFixed(1)} ${short}`
      }
    }
  }
  try {
    return new Intl.NumberFormat(locale, { style: "unit", unit: "byte" }).format(value)
  } catch {
    return `${value} B`
  }
}

/** Date and time (medium date, short time) in the given locale. Never throws. */
export function formatDateTime(ms: number, locale: string): string {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ""
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

/** Local calendar date as YYYY-MM-DD. */
export function isoLocalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Suggested file name for a vault export, e.g. "AccMan-export-2026-11-12.json". */
export function defaultExportFileName(date: Date = new Date()): string {
  return `AccMan-export-${isoLocalDate(date)}.json`
}

/** Why the backend refused an export target (`VALIDATION` errors from `export_vault`). */
export type ExportTargetProblem = "data_folder" | "not_export_file" | "folder_missing" | "is_folder" | "not_absolute"

// Stable fragments of the English messages in src-tauri/src/session.rs `check_export_target`.
const EXPORT_TARGET_MESSAGES: [fragment: string, problem: ExportTargetProblem][] = [
  ["outside the app's data folder", "data_folder"],
  ["not an AccMan backup", "not_export_file"],
  ["export folder does not exist", "folder_missing"],
  ["export path is a folder", "is_folder"],
  ["must be an absolute file path", "not_absolute"],
]

/**
 * Maps the backend message of a `VALIDATION` error from `export_vault` to a known export-target
 * problem, so the UI can show a localised text. Returns null for any other message.
 */
export function exportTargetProblem(message: string): ExportTargetProblem | null {
  const text = message.toLowerCase()
  for (const [fragment, problem] of EXPORT_TARGET_MESSAGES) {
    if (text.includes(fragment.toLowerCase())) return problem
  }
  return null
}
