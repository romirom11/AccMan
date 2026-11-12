// Pure TOTP helpers (RFC 6238). No React and no "@/" runtime imports, so it runs under `node --test`.
import * as OTPAuth from "otpauth"

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512"

export interface TotpConfig {
  /** Normalised base32 secret: uppercase A-Z2-7, no spaces, dashes or padding. */
  secret: string
  digits: number
  /** Seconds */
  period: number
  algorithm: TotpAlgorithm
}

export interface TotpResult {
  code: string
  /** Seconds until the code changes (1..period). */
  remainingSeconds: number
  period: number
  digits: number
}

export const DEFAULT_TOTP_DIGITS = 6
export const DEFAULT_TOTP_PERIOD = 30
export const DEFAULT_TOTP_ALGORITHM: TotpAlgorithm = "SHA1"

/** Shortest secret accepted (8 base32 chars = 40 bits); anything shorter is almost certainly a typo. */
const MIN_SECRET_LENGTH = 8
const MAX_SECRET_LENGTH = 1024
const MIN_DIGITS = 4
const MAX_DIGITS = 10
const MAX_PERIOD = 3600
const BASE32_RE = /^[A-Z2-7]+$/
const ALGORITHMS: readonly TotpAlgorithm[] = ["SHA1", "SHA256", "SHA512"]

/**
 * Normalises a plain base32 secret as users paste it: strips whitespace (including newlines),
 * dashes and "=" padding, and uppercases it. Returns null when the result is not valid base32.
 */
export function normalizeBase32Secret(input: string): string | null {
  if (typeof input !== "string") return null
  const cleaned = input.replace(/[\s\-]+/g, "").replace(/=+$/, "").toUpperCase()
  if (cleaned.length < MIN_SECRET_LENGTH || cleaned.length > MAX_SECRET_LENGTH) return null
  return BASE32_RE.test(cleaned) ? cleaned : null
}

function parseIntParam(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value.trim() === "") return fallback
  if (!/^\d+$/.test(value.trim())) return null
  const n = Number(value.trim())
  return n >= min && n <= max ? n : null
}

/** Parses an `otpauth://totp/...` URI. HOTP and malformed URIs return null. */
function parseOtpauthUri(input: string): TotpConfig | null {
  const match = /^otpauth:\/\/([^/?#]+)(?:\/[^?#]*)?\?([^#]*)/i.exec(input)
  if (!match || match[1].toLowerCase() !== "totp") return null

  let params: URLSearchParams
  try {
    params = new URLSearchParams(match[2])
  } catch {
    return null
  }
  const secret = normalizeBase32Secret(params.get("secret") ?? "")
  if (!secret) return null

  const digits = parseIntParam(params.get("digits"), DEFAULT_TOTP_DIGITS, MIN_DIGITS, MAX_DIGITS)
  const period = parseIntParam(params.get("period"), DEFAULT_TOTP_PERIOD, 1, MAX_PERIOD)
  if (digits === null || period === null) return null

  const rawAlgorithm = (params.get("algorithm") ?? DEFAULT_TOTP_ALGORITHM).trim().toUpperCase().replace("-", "")
  const algorithm = ALGORITHMS.find((a) => a === rawAlgorithm)
  if (!algorithm) return null

  return { secret, digits, period, algorithm }
}

/**
 * Parses whatever is stored in a 2FA field: a base32 secret (spaces, dashes, lowercase and padding
 * allowed) or an `otpauth://totp/...` URI (its digits/period/algorithm are honoured).
 * Returns null when the value cannot produce a code. Never throws.
 */
export function parseTotpSecret(input: string | null | undefined): TotpConfig | null {
  if (typeof input !== "string") return null
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    if (/^otpauth:\/\//i.test(trimmed)) return parseOtpauthUri(trimmed)
    const secret = normalizeBase32Secret(trimmed)
    if (!secret) return null
    return {
      secret,
      digits: DEFAULT_TOTP_DIGITS,
      period: DEFAULT_TOTP_PERIOD,
      algorithm: DEFAULT_TOTP_ALGORITHM,
    }
  } catch {
    return null
  }
}

/** True if the value can produce a TOTP code. */
export function isValidTotpSecret(input: string | null | undefined): boolean {
  return parseTotpSecret(input) !== null
}

/** Seconds left in the current period at `now` (ms), in 1..period. */
export function totpRemainingSeconds(period: number, now: number = Date.now()): number {
  const periodMs = period * 1000
  const elapsed = ((now % periodMs) + periodMs) % periodMs
  return Math.ceil((periodMs - elapsed) / 1000)
}

/**
 * The code valid at `now` (Unix ms) plus the seconds until the period boundary.
 * Returns null for invalid input. Never throws.
 */
export function generateTotp(input: string | null | undefined, now: number = Date.now()): TotpResult | null {
  const config = parseTotpSecret(input)
  if (!config || !Number.isFinite(now)) return null
  try {
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(config.secret),
      digits: config.digits,
      period: config.period,
      algorithm: config.algorithm,
    })
    const code = totp.generate({ timestamp: now })
    return {
      code,
      remainingSeconds: totpRemainingSeconds(config.period, now),
      period: config.period,
      digits: config.digits,
    }
  } catch {
    return null
  }
}
