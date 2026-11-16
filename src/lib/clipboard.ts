import { toast } from "sonner"
import i18n from "@/i18n"
import { vaultApi } from "@/api/vault"
import { useVaultStore } from "@/stores/vault-store"
import { DEFAULT_SETTINGS } from "@/types"

export interface CopyOptions {
  /**
   * Passwords, keys, seeds, TOTP codes...: the clipboard is cleared after the vault's
   * `clipboardClearSeconds` (only if it still holds this text).
   */
  secret?: boolean
  /** What was copied, for the toast ("Password copied"). Never pass the value itself. */
  label?: string
  /** Do not show the success toast (errors are still shown). */
  quiet?: boolean
}

export interface CopyResult {
  /** The text is on the clipboard. */
  ok: boolean
  /** The backend will clear it after `autoClearSeconds` (and on lock). False for the browser fallback. */
  autoClear: boolean
  /** Seconds until the auto-clear; 0 when `autoClear` is false. */
  autoClearSeconds: number
}

const TOAST_ID = "accman-clipboard"
const NOT_COPIED: CopyResult = { ok: false, autoClear: false, autoClearSeconds: 0 }

// Text the navigator.clipboard fallback wrote last. The backend never saw it, so lock_vault
// cannot clear it; it is cleared here on lock instead (best effort).
let fallbackText: string | null = null
let fallbackClearTimer: ReturnType<typeof setTimeout> | null = null

function cancelFallbackTimer() {
  if (fallbackClearTimer) clearTimeout(fallbackClearTimer)
  fallbackClearTimer = null
}

function clearSecondsSetting(): number {
  const seconds = useVaultStore.getState().vault?.settings.clipboardClearSeconds
  return typeof seconds === "number" && seconds >= 0 ? seconds : DEFAULT_SETTINGS.clipboardClearSeconds
}

async function copyWithNavigator(text: string, clearAfterSeconds: number): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
  } catch {
    return false
  }
  fallbackText = text
  cancelFallbackTimer()
  if (clearAfterSeconds > 0) {
    // Best effort: clear only if we can read the clipboard back and it still holds our text.
    fallbackClearTimer = setTimeout(() => {
      fallbackClearTimer = null
      void (async () => {
        try {
          if ((await navigator.clipboard.readText()) === text) {
            await navigator.clipboard.writeText("")
            if (fallbackText === text) fallbackText = null
          }
        } catch {
          // Reading is not permitted here; the lock-time clear still applies.
        }
      })()
    }, clearAfterSeconds * 1000)
  }
  return true
}

/**
 * Clears what the navigator.clipboard fallback copied, if anything. Called on lock. When the
 * clipboard cannot be read back it is cleared anyway: this app wrote to it last (as far as we
 * know), and leaving a secret behind after lock is worse than wiping a later copy. Never throws;
 * without user activation (auto-lock) the write may be refused, so it stays best effort.
 */
export async function clearFallbackClipboard(): Promise<void> {
  const text = fallbackText
  fallbackText = null
  cancelFallbackTimer()
  if (text === null || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return
  try {
    let current: string | null = null
    try {
      current = await navigator.clipboard.readText()
    } catch {
      current = null
    }
    if (current === null || current === text) await navigator.clipboard.writeText("")
  } catch {
    // Not permitted here; nothing more we can do.
  }
}

// Whenever the decrypted vault goes away (lock, auto-lock, reload check), clear the fallback copy.
useVaultStore.subscribe((state, previous) => {
  if (previous.vault && !state.vault) void clearFallbackClipboard()
})

/**
 * Copies `text` via the backend (`clipboard_copy`), which also clears it after the configured delay
 * for secrets and on lock. Falls back to `navigator.clipboard` when the command fails (then only a
 * best-effort clear on lock applies). Shows a toast that mentions the auto-clear only when the
 * backend will really do it. Callers may ignore the result.
 */
export async function copyText(text: string, options: CopyOptions = {}): Promise<CopyResult> {
  if (!text) return NOT_COPIED
  const t = i18n.t.bind(i18n)
  const clearAfter = options.secret ? clearSecondsSetting() : 0

  let result: CopyResult
  try {
    await vaultApi.clipboardCopy(text, clearAfter > 0 ? clearAfter : undefined, { silent: true })
    // The backend now owns the clipboard; the fallback copy (if any) was overwritten.
    fallbackText = null
    cancelFallbackTimer()
    result = { ok: true, autoClear: clearAfter > 0, autoClearSeconds: clearAfter > 0 ? clearAfter : 0 }
  } catch {
    const ok = await copyWithNavigator(text, clearAfter)
    result = { ok, autoClear: false, autoClearSeconds: 0 }
  }

  if (!result.ok) {
    toast.error(t("clipboard.copy_failed"), { id: TOAST_ID })
    return result
  }
  if (!options.quiet) {
    const title = options.label ? t("clipboard.copied_named", { label: options.label }) : t("clipboard.copied")
    toast.success(title, {
      id: TOAST_ID,
      description: result.autoClear ? t("clipboard.clears_in", { seconds: result.autoClearSeconds }) : undefined,
    })
  }
  return result
}
