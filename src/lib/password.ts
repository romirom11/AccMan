// Pure password generation and strength estimation. No React and no "@/" runtime imports.

export interface PasswordOptions {
  length: number
  lowercase: boolean
  uppercase: boolean
  digits: boolean
  symbols: boolean
  /** Leave out characters that are easy to confuse (I l 1 O 0 o). */
  excludeAmbiguous: boolean
}

export const MIN_GENERATED_LENGTH = 8
export const MAX_GENERATED_LENGTH = 128

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
}

export const CHARSETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  // No quotes, backslash, backtick or space: those are the ones sites and shells reject most often.
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
} as const

export const AMBIGUOUS_CHARS = "Il1O0o"

type CharClass = keyof typeof CHARSETS
const CLASS_ORDER: CharClass[] = ["lowercase", "uppercase", "digits", "symbols"]

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("crypto.getRandomValues is not available")
  }
  return c
}

/** Uniform random integer in [0, maxExclusive) from the CSPRNG, without modulo bias (rejection sampling). */
export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 2 ** 32) {
    throw new RangeError(`randomInt: invalid bound ${maxExclusive}`)
  }
  const range = 2 ** 32
  // Largest multiple of maxExclusive that fits in 32 bits; values at or above it are rejected.
  const limit = range - (range % maxExclusive)
  const buf = new Uint32Array(1)
  const crypto = getCrypto()
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % maxExclusive
  }
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)]
}

function stripAmbiguous(chars: string): string {
  return [...chars].filter((c) => !AMBIGUOUS_CHARS.includes(c)).join("")
}

/** Clamps a requested length to the supported range. */
export function clampPasswordLength(length: number): number {
  if (!Number.isFinite(length)) return DEFAULT_PASSWORD_OPTIONS.length
  return Math.min(MAX_GENERATED_LENGTH, Math.max(MIN_GENERATED_LENGTH, Math.round(length)))
}

/**
 * Generates a random password with at least one character of every selected class.
 * If no class is selected, lowercase + uppercase + digits are used.
 */
export function generatePassword(options: Partial<PasswordOptions> = {}): string {
  const opts: PasswordOptions = { ...DEFAULT_PASSWORD_OPTIONS, ...options }
  let classes = CLASS_ORDER.filter((c) => opts[c])
  if (classes.length === 0) classes = ["lowercase", "uppercase", "digits"]

  const sets = classes.map((c) => (opts.excludeAmbiguous ? stripAmbiguous(CHARSETS[c]) : CHARSETS[c]))
  const all = sets.join("")
  const length = Math.max(clampPasswordLength(opts.length), sets.length)

  const chars: string[] = sets.map((set) => pick(set))
  while (chars.length < length) chars.push(pick(all))

  // Fisher-Yates so the guaranteed characters are not always at the start.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}

export type StrengthScore = 0 | 1 | 2 | 3 | 4

export interface PasswordStrength {
  score: StrengthScore
  /** i18n key: password_strength.{very_weak|weak|fair|strong|very_strong} */
  labelKey: string
  /** Rough estimate in bits. */
  entropyBits: number
}

const STRENGTH_LABELS = ["very_weak", "weak", "fair", "strong", "very_strong"] as const

// Small list of the most common passwords/stems; checked after removing trailing digits/symbols.
const COMMON_PASSWORDS = new Set([
  "password", "passw0rd", "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbnm", "letmein",
  "welcome", "admin", "administrator", "iloveyou", "monkey", "dragon", "master", "football",
  "baseball", "sunshine", "princess", "shadow", "superman", "trustno1", "login", "abc", "abcdef",
  "qazwsx", "secret", "changeme", "default", "root", "test", "user", "hello", "freedom", "whatever",
  "пароль", "йцукен", "йцукенгшщзх", "кохання", "україна",
])

function charPoolSize(password: string): number {
  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/[0-9]/.test(password)) pool += 10
  if (/[^A-Za-z0-9\p{L}]/u.test(password)) pool += 33
  if (/[^\x00-\x7F]/.test(password) && /\p{L}/u.test(password)) pool += 33
  return Math.max(pool, 1)
}

/** Counts characters, discounting repeats and keyboard/alphabet sequences (aaa, abc, 321). */
function effectiveLength(password: string): number {
  const cps = [...password].map((c) => c.codePointAt(0) ?? 0)
  let length = 0
  for (let i = 0; i < cps.length; i++) {
    const prev = cps[i - 1]
    const isRun = i > 0 && (cps[i] === prev || Math.abs(cps[i] - prev) === 1)
    length += isRun ? 0.25 : 1
  }
  return length
}

function scoreFromBits(bits: number): StrengthScore {
  if (bits < 28) return 0
  if (bits < 40) return 1
  if (bits < 60) return 2
  if (bits < 80) return 3
  return 4
}

/** Heuristic strength estimate (entropy-like). Fast and dependency-free; not a guarantee. */
export function estimateStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, labelKey: `password_strength.${STRENGTH_LABELS[0]}`, entropyBits: 0 }

  let bits = effectiveLength(password) * Math.log2(charPoolSize(password))
  const stem = password.toLowerCase().replace(/[^\p{L}]+$/u, "")
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || COMMON_PASSWORDS.has(stem)) {
    bits = Math.min(bits, 10)
  }
  const unique = new Set(password).size
  if (unique <= 2) bits = Math.min(bits, 10)

  const score = scoreFromBits(bits)
  return { score, labelKey: `password_strength.${STRENGTH_LABELS[score]}`, entropyBits: Math.round(bits) }
}
