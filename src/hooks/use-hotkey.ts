import { useEffect, useRef } from "react"

export interface HotkeyOptions {
  /** Require Cmd (macOS) or Ctrl (Windows/Linux). Default true. */
  mod?: boolean
  shift?: boolean
  alt?: boolean
  /** Fire even when focus is in an input/textarea/contenteditable. Default true for mod combos, false otherwise. */
  allowInInputs?: boolean
  enabled?: boolean
}

/** True on macOS/iOS, where the shortcut modifier is Cmd (shown as ⌘). */
export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "")

export interface HotkeySpec {
  /** A single letter or digit, or a `KeyboardEvent.key` name such as "Escape" or "/". */
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
}

export type HotkeyEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">

const LATIN_OR_DIGIT = /^[a-z0-9]$/

/**
 * Pure matcher behind `useHotkey`.
 * - Modifier: Cmd without Ctrl on macOS (so Cocoa's Ctrl+K/Ctrl+L text bindings keep working),
 *   Ctrl without Cmd elsewhere. Non-mod hotkeys require neither.
 * - Letters/digits are matched by the logical key (`event.key`), so remapped Latin layouts
 *   (Dvorak, Colemak, AZERTY) get the letter printed on the key. Only when the layout produces
 *   something else (Cyrillic "л", AZERTY "&"...) is the physical key (`event.code`) used.
 */
export function matchesHotkey(event: HotkeyEvent, spec: HotkeySpec, isMac: boolean): boolean {
  const modPressed = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  const anyMod = event.ctrlKey || event.metaKey
  if (spec.mod ? !modPressed : anyMod) return false
  if (event.shiftKey !== spec.shift || event.altKey !== spec.alt) return false

  const wanted = spec.key.length === 1 ? spec.key.toLowerCase() : spec.key
  if (!LATIN_OR_DIGIT.test(wanted)) return event.key === wanted

  const pressed = event.key.toLowerCase()
  if (LATIN_OR_DIGIT.test(pressed)) return pressed === wanted
  const wantedCode = /^[a-z]$/.test(wanted) ? `Key${wanted.toUpperCase()}` : `Digit${wanted}`
  return event.code === wantedCode
}

// Open popups/menus/selects/dialogs handle Escape themselves; a page-level Escape must not also fire.
const LAYER_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'

function isLayerOpen(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(LAYER_SELECTOR)) return true
  return typeof document !== "undefined" && document.querySelector(LAYER_SELECTOR) !== null
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

/**
 * Global keyboard shortcut (see `matchesHotkey` for the matching rules).
 * Non-mod hotkeys (e.g. Escape) are skipped when the event was already handled
 * (`defaultPrevented`) or while a popup, menu, select or dialog is open.
 *
 * Example: `useHotkey("l", lock)` → Ctrl+L / ⌘L.
 */
export function useHotkey(key: string, handler: (event: KeyboardEvent) => void, options: HotkeyOptions = {}) {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  const { mod = true, shift = false, alt = false, enabled = true } = options
  const allowInInputs = options.allowInInputs ?? mod

  useEffect(() => {
    if (!enabled) return
    const spec: HotkeySpec = { key, mod, shift, alt }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return
      if (!matchesHotkey(event, spec, IS_MAC)) return
      if (!allowInInputs && isEditableTarget(event.target)) return
      if (!mod && (event.defaultPrevented || isLayerOpen(event.target))) return
      event.preventDefault()
      handlerRef.current(event)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [key, mod, shift, alt, allowInInputs, enabled])
}
