import i18n from "@/i18n"
import { ERROR_CODES, type ErrorCode } from "@/types"

const KNOWN_CODES = new Set<string>(ERROR_CODES)

/**
 * Error thrown by every API call. `code` is one of the backend codes (see `ERROR_CODES`)
 * or "UNKNOWN"; `message` is the backend's English text (not localised).
 */
export class ApiError extends Error {
  readonly code: ErrorCode | string
  readonly command?: string

  constructor(code: ErrorCode | string, message: string, command?: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
    this.command = command
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Converts whatever a Tauri command (or anything else) rejected with into an ApiError. */
export function toApiError(error: unknown, command?: string): ApiError {
  if (error instanceof ApiError) return error

  // Backend CommandError: { code, message }
  if (isRecord(error) && typeof error.code === "string") {
    const message = typeof error.message === "string" ? error.message : ""
    return new ApiError(error.code, message, command)
  }

  if (typeof error === "string") {
    const trimmed = error.trim()
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (isRecord(parsed) && typeof parsed.code === "string") {
          return toApiError(parsed, command)
        }
      } catch {
        // not JSON, fall through
      }
    }
    if (KNOWN_CODES.has(trimmed)) return new ApiError(trimmed, "", command)
    return new ApiError("UNKNOWN", error, command)
  }

  if (error instanceof Error) return new ApiError("UNKNOWN", error.message, command)

  if (isRecord(error) && typeof error.message === "string") {
    return new ApiError("UNKNOWN", error.message, command)
  }

  let message = ""
  try {
    message = JSON.stringify(error) ?? ""
  } catch {
    message = String(error)
  }
  return new ApiError("UNKNOWN", message, command)
}

/** True if `error` is an ApiError, optionally with one of the given codes. */
export function isApiError(error: unknown, code?: ErrorCode | ErrorCode[]): error is ApiError {
  if (!(error instanceof ApiError)) return false
  if (code === undefined) return true
  return Array.isArray(code) ? code.includes(error.code as ErrorCode) : error.code === code
}

/** Returns the error code of any thrown value ("UNKNOWN" if it has none). */
export function getErrorCode(error: unknown): ErrorCode | string {
  return toApiError(error).code
}

/**
 * Localised, user-facing text for any thrown value: `errors.<CODE>` (with the backend
 * message available as `{{message}}`), falling back to the backend message.
 */
export function getErrorMessage(error: unknown): string {
  const apiError = toApiError(error)
  const key = `errors.${apiError.code}`
  if (apiError.code !== "UNKNOWN" && i18n.exists(key)) {
    return i18n.t(key, { message: apiError.message })
  }
  return apiError.message || i18n.t("errors.UNKNOWN")
}
