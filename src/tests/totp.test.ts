import { test } from "node:test"
import assert from "node:assert/strict"
import {
  generateTotp,
  isValidTotpSecret,
  normalizeBase32Secret,
  parseTotpSecret,
  totpRemainingSeconds,
} from "../lib/totp.ts"

// RFC 6238 Appendix B. Seeds are the ASCII strings "1234567890..." of 20/32/64 bytes, base32-encoded.
const SHA1_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
const SHA256_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA"
const SHA512_SEED =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA"

const RFC_VECTORS: Array<[number, string, string, string]> = [
  // [unix seconds, SHA1, SHA256, SHA512]
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
]

const uri = (seed: string, algorithm: string) =>
  `otpauth://totp/RFC:test?secret=${seed}&digits=8&period=30&algorithm=${algorithm}&issuer=RFC`

test("RFC 6238 vectors (SHA1, 8 digits) via otpauth URI", () => {
  for (const [seconds, sha1] of RFC_VECTORS) {
    const result = generateTotp(uri(SHA1_SEED, "SHA1"), seconds * 1000)
    assert.ok(result, `code at ${seconds}`)
    assert.equal(result.code, sha1, `SHA1 at ${seconds}`)
    assert.equal(result.digits, 8)
    assert.equal(result.period, 30)
  }
})

test("RFC 6238 vectors (SHA256 and SHA512) via otpauth URI", () => {
  for (const [seconds, , sha256, sha512] of RFC_VECTORS) {
    assert.equal(generateTotp(uri(SHA256_SEED, "SHA256"), seconds * 1000)?.code, sha256, `SHA256 at ${seconds}`)
    assert.equal(generateTotp(uri(SHA512_SEED, "SHA512"), seconds * 1000)?.code, sha512, `SHA512 at ${seconds}`)
  }
})

test("plain base32 secret uses SHA1, 6 digits, 30 s (last 6 digits of the RFC vector)", () => {
  for (const [seconds, sha1] of RFC_VECTORS) {
    const result = generateTotp(SHA1_SEED, seconds * 1000)
    assert.ok(result)
    assert.equal(result.code, sha1.slice(-6))
    assert.equal(result.digits, 6)
  }
})

test("normalisation: spaces, newlines, dashes, lowercase and padding", () => {
  const expected = generateTotp(SHA1_SEED, 59_000)?.code
  const variants = [
    "gezd gnbv gy3t qojq gezd gnbv gy3t qojq",
    "GEZD-GNBV-GY3T-QOJQ-GEZD-GNBV-GY3T-QOJQ",
    "  GEZDGNBVGY3TQOJQ\nGEZDGNBVGY3TQOJQ  ",
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ====",
    "\tgezdgnbvgy3tqojq\r\ngezdgnbvgy3tqojq",
  ]
  for (const v of variants) {
    assert.equal(normalizeBase32Secret(v), SHA1_SEED, JSON.stringify(v))
    assert.equal(generateTotp(v, 59_000)?.code, expected, JSON.stringify(v))
  }
})

test("otpauth URI defaults and parameters", () => {
  const config = parseTotpSecret("otpauth://totp/ACME:alice@example.com?secret=jbsw%20y3dp%20ehpk%203pxp&issuer=ACME")
  assert.deepEqual(config, { secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 30, algorithm: "SHA1" })

  const custom = parseTotpSecret("OTPAUTH://TOTP/x?secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=sha256")
  assert.deepEqual(custom, { secret: "JBSWY3DPEHPK3PXP", digits: 8, period: 60, algorithm: "SHA256" })

  const r = generateTotp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=60", 61_000)
  assert.ok(r)
  assert.equal(r.period, 60)
  assert.equal(r.remainingSeconds, 59)
})

test("invalid input returns null and never throws", () => {
  const invalid: unknown[] = [
    "",
    "   ",
    null,
    undefined,
    "abc",
    "not a secret!",
    "GEZDGNBVGY3TQOJ1", // 1 is not base32
    "ЖЖЖЖЖЖЖЖЖЖ",
    "otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1",
    "otpauth://totp/x?issuer=ACME",
    "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=abc",
    "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0",
    "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5",
    "otpauth://totp/x",
    12345,
    {},
  ]
  for (const value of invalid) {
    assert.doesNotThrow(() => generateTotp(value as string))
    assert.equal(generateTotp(value as string), null, JSON.stringify(value))
    assert.equal(isValidTotpSecret(value as string), false, JSON.stringify(value))
  }
  assert.equal(generateTotp(SHA1_SEED, Number.NaN), null)
})

test("valid secrets are recognised", () => {
  assert.equal(isValidTotpSecret("JBSWY3DPEHPK3PXP"), true)
  assert.equal(isValidTotpSecret("jbsw y3dp ehpk 3pxp"), true)
  assert.equal(isValidTotpSecret("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP"), true)
})

test("remaining seconds are aligned to the period boundary", () => {
  assert.equal(totpRemainingSeconds(30, 0), 30)
  assert.equal(totpRemainingSeconds(30, 1_000), 29)
  assert.equal(totpRemainingSeconds(30, 28_500), 2)
  assert.equal(totpRemainingSeconds(30, 29_999), 1)
  assert.equal(totpRemainingSeconds(30, 30_000), 30)
  assert.equal(generateTotp(SHA1_SEED, 1111111109_000)?.remainingSeconds, 1)
  // The code changes exactly at the boundary.
  const before = generateTotp(SHA1_SEED, 29_999)?.code
  const after = generateTotp(SHA1_SEED, 30_000)?.code
  assert.notEqual(before, after)
})
