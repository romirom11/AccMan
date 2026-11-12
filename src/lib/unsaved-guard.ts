// Route-leave guard for pages with unsaved changes. The app uses a MemoryRouter (no useBlocker),
// so every programmatic navigation away from a page (sidebar, command palette) awaits
// `confirmLeave()` first. Locking never asks: it discards the draft by design.
// No "@/" imports, so it also runs under `node --test`.
import { useEffect } from "react"
import i18n from "i18next"
import { confirm } from "@tauri-apps/plugin-dialog"

/** Returns true while the registering page has unsaved changes. */
export type DirtyChecker = () => boolean

/** Asks the user; resolves true to leave (discarding the changes). */
export type LeaveConfirmer = (message: string, title: string) => Promise<boolean>

interface Registration {
  isDirty: DirtyChecker
  message?: string
}

const registrations = new Set<Registration>()
let pending: Promise<boolean> | null = null

/** Registers a dirty-checker; returns the function that unregisters it. */
export function registerDirtyChecker(isDirty: DirtyChecker, message?: string): () => void {
  const registration: Registration = { isDirty, message }
  registrations.add(registration)
  return () => {
    registrations.delete(registration)
  }
}

function firstDirty(): Registration | undefined {
  for (const registration of registrations) {
    try {
      if (registration.isDirty()) return registration
    } catch {
      // A broken checker must not block navigation.
    }
  }
  return undefined
}

/** True when any registered page reports unsaved changes. */
export function hasUnsavedChanges(): boolean {
  return firstDirty() !== undefined
}

/** Native confirm dialog; falls back to window.confirm if the dialog plugin is unavailable. */
const askNative: LeaveConfirmer = async (message, title) => {
  try {
    return await confirm(message, { title, kind: "warning" })
  } catch {
    return typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(message) : false
  }
}

/**
 * Resolves true when navigation may proceed: immediately if nothing is dirty, otherwise after
 * the user confirms discarding the changes. Concurrent calls share one dialog.
 */
export function confirmLeave(ask: LeaveConfirmer = askNative): Promise<boolean> {
  const dirty = firstDirty()
  if (!dirty) return Promise.resolve(true)
  if (!pending) {
    const message = dirty.message ?? i18n.t("unsaved_guard.message")
    pending = ask(message, i18n.t("unsaved_guard.title"))
      .catch(() => false)
      .finally(() => {
        pending = null
      })
  }
  return pending
}

/**
 * For pages: while `isDirty` is true, navigation through the sidebar or the command palette asks
 * before leaving. `message` overrides the default localised text (pass it already translated).
 */
export function useUnsavedGuard(isDirty: boolean, message?: string): void {
  useEffect(() => {
    if (!isDirty) return
    return registerDirtyChecker(() => true, message)
  }, [isDirty, message])
}
