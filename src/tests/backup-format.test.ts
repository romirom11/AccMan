import { test } from "node:test"
import assert from "node:assert/strict"
import {
  defaultExportFileName,
  exportTargetProblem,
  formatBytes,
  formatDateTime,
  isoLocalDate,
} from "../lib/backup-format.ts"

test("isoLocalDate pads month and day and uses the local calendar date", () => {
  assert.equal(isoLocalDate(new Date(2026, 0, 5, 23, 59)), "2026-01-05")
  assert.equal(isoLocalDate(new Date(2026, 10, 12, 0, 0)), "2026-11-12")
})

test("defaultExportFileName contains the date and a .json extension", () => {
  assert.equal(defaultExportFileName(new Date(2026, 1, 3)), "AccMan-export-2026-02-03.json")
  assert.match(defaultExportFileName(), /^AccMan-export-\d{4}-\d{2}-\d{2}\.json$/)
})

test("formatBytes picks a unit and never throws", () => {
  assert.match(formatBytes(512, "en"), /512/)
  assert.match(formatBytes(512, "en"), /byte/i)
  assert.match(formatBytes(2048, "en"), /^2\s?kB$/i)
  assert.match(formatBytes(1.5 * 1024 * 1024, "en"), /^1\.5\s?MB$/i)
  assert.doesNotThrow(() => formatBytes(1024, "uk"))
  assert.match(formatBytes(-5, "en"), /^0/)
  assert.match(formatBytes(Number.NaN, "en"), /^0/)
  // An invalid locale tag falls back instead of throwing.
  assert.match(formatBytes(4096, "not a locale!"), /4(\.0)? ?KB/i)
})

test("formatDateTime formats valid timestamps and returns '' for invalid ones", () => {
  const ms = new Date(2026, 10, 12, 14, 5).getTime()
  const en = formatDateTime(ms, "en")
  assert.match(en, /2026/)
  assert.match(en, /Nov/)
  assert.match(formatDateTime(ms, "uk"), /2026/)
  assert.equal(formatDateTime(Number.NaN, "en"), "")
  assert.notEqual(formatDateTime(ms, "not a locale!"), "")
})

test("exportTargetProblem recognises the backend's export target refusals", () => {
  // Messages as returned by check_export_target in src-tauri/src/session.rs.
  assert.equal(exportTargetProblem("Choose a location outside the app's data folder for the export."), "data_folder")
  assert.equal(exportTargetProblem("Refusing to overwrite a file that is not an AccMan backup."), "not_export_file")
  assert.equal(exportTargetProblem("The export folder does not exist."), "folder_missing")
  assert.equal(exportTargetProblem("The export path is a folder."), "is_folder")
  assert.equal(exportTargetProblem("The export path must be an absolute file path."), "not_absolute")
})

test("exportTargetProblem returns null for unrelated messages", () => {
  assert.equal(exportTargetProblem(""), null)
  assert.equal(exportTargetProblem("Password must be at least 8 characters."), null)
  assert.equal(exportTargetProblem("Invalid backup file name."), null)
})
