import { useEffect, useMemo, useState } from "react"
import { generateTotp, isValidTotpSecret } from "@/lib/totp"

export type TotpState =
  /** Disabled or empty secret. */
  | { status: "idle" }
  /** The secret cannot produce a code. */
  | { status: "invalid" }
  | { status: "ok"; code: string; remainingSeconds: number; period: number; digits: number }

/**
 * Live TOTP code for `secret` (base32 or otpauth:// URI). Re-renders once per second, aligned to
 * the wall-clock second, only while mounted and `enabled`. Never throws.
 */
export function useTotp(secret: string | null | undefined, enabled = true): TotpState {
  const active = enabled && !!secret && isValidTotpSecret(secret)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    let interval: ReturnType<typeof setInterval> | undefined
    setNow(Date.now())
    // Start ticking on the next full second so the countdown flips together with the code.
    const timeout = setTimeout(() => {
      setNow(Date.now())
      interval = setInterval(() => setNow(Date.now()), 1000)
    }, 1000 - (Date.now() % 1000))
    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [active])

  return useMemo<TotpState>(() => {
    if (!enabled || !secret) return { status: "idle" }
    const result = active ? generateTotp(secret, now) : null
    if (!result) return { status: "invalid" }
    return { status: "ok", ...result }
  }, [enabled, secret, active, now])
}
