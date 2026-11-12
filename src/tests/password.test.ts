import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AMBIGUOUS_CHARS,
  CHARSETS,
  MAX_GENERATED_LENGTH,
  MIN_GENERATED_LENGTH,
  estimateStrength,
  generatePassword,
  randomInt,
} from "../lib/password.ts"

const has = (password: string, set: string) => [...password].some((c) => set.includes(c))

test("every selected class is present, unselected classes are absent", () => {
  const combos = [
    { lowercase: true, uppercase: false, digits: false, symbols: false },
    { lowercase: false, uppercase: true, digits: true, symbols: false },
    { lowercase: true, uppercase: true, digits: true, symbols: true },
    { lowercase: false, uppercase: false, digits: true, symbols: true },
  ]
  for (const combo of combos) {
    for (let i = 0; i < 300; i++) {
      const p = generatePassword({ ...combo, length: 8, excludeAmbiguous: false })
      for (const cls of ["lowercase", "uppercase", "digits", "symbols"] as const) {
        assert.equal(has(p, CHARSETS[cls]), combo[cls], `${cls} in ${JSON.stringify(combo)}`)
      }
    }
  }
})

test("length is respected and clamped", () => {
  for (const length of [8, 12, 20, 64, 128]) {
    assert.equal(generatePassword({ length }).length, length)
  }
  assert.equal(generatePassword({ length: 1 }).length, MIN_GENERATED_LENGTH)
  assert.equal(generatePassword({ length: 10_000 }).length, MAX_GENERATED_LENGTH)
  assert.equal(generatePassword({ length: Number.NaN }).length, 20)
})

test("no class selected falls back to letters and digits", () => {
  const p = generatePassword({ lowercase: false, uppercase: false, digits: false, symbols: false, length: 30 })
  assert.match(p, /^[A-Za-z0-9]+$/)
  assert.equal(p.length, 30)
})

test("ambiguous characters are excluded on request", () => {
  for (let i = 0; i < 200; i++) {
    const p = generatePassword({ length: 64, excludeAmbiguous: true })
    assert.equal(has(p, AMBIGUOUS_CHARS), false, p)
  }
})

test("randomInt stays in range and rejects bad bounds", () => {
  for (let i = 0; i < 1000; i++) {
    const n = randomInt(7)
    assert.ok(Number.isInteger(n) && n >= 0 && n < 7)
  }
  assert.equal(randomInt(1), 0)
  assert.throws(() => randomInt(0), RangeError)
  assert.throws(() => randomInt(1.5), RangeError)
})

test("no obvious bias (chi-square smoke test over a 3-value range)", () => {
  // A bound that does not divide 2^32 would show modulo bias with naive `% n` only at huge
  // sample sizes, so this is a smoke test of uniformity, not a proof.
  const counts = [0, 0, 0]
  const samples = 30_000
  for (let i = 0; i < samples; i++) counts[randomInt(3)]++
  const expected = samples / 3
  const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0)
  // df = 2; p = 0.001 critical value is 13.8.
  assert.ok(chi2 < 13.8, `chi2=${chi2} counts=${counts}`)

  // Character frequency across generated passwords is roughly uniform.
  const freq = new Map<string, number>()
  for (let i = 0; i < 2000; i++) {
    for (const c of generatePassword({ length: 20, symbols: false, uppercase: false, digits: false, excludeAmbiguous: false })) {
      freq.set(c, (freq.get(c) ?? 0) + 1)
    }
  }
  assert.equal(freq.size, 26)
  const avg = (2000 * 20) / 26
  for (const [c, n] of freq) assert.ok(Math.abs(n - avg) < avg * 0.2, `${c}: ${n}`)
})

test("strength estimate", () => {
  assert.equal(estimateStrength("").score, 0)
  assert.equal(estimateStrength("password").score, 0)
  assert.equal(estimateStrength("Password123!").score, 0)
  assert.equal(estimateStrength("aaaaaaaaaaaaaaaa").score, 0)
  assert.equal(estimateStrength("пароль").score, 0)
  assert.ok(estimateStrength("abcdefgh12345678").score <= 1)
  assert.ok(estimateStrength("kT9#mQ2!").score >= 1)
  assert.equal(estimateStrength(generatePassword({ length: 20 })).score, 4)
  const s = estimateStrength("correct horse battery staple")
  assert.ok(s.score >= 3, JSON.stringify(s))
  assert.match(estimateStrength("x").labelKey, /^password_strength\.(very_weak|weak|fair|strong|very_strong)$/)
})
