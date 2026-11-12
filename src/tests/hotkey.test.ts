import { test } from "node:test"
import assert from "node:assert/strict"
import { matchesHotkey, type HotkeyEvent, type HotkeySpec } from "../hooks/use-hotkey.ts"

const key = (k: string, mod = true): HotkeySpec => ({ key: k, mod, shift: false, alt: false })

function ev(partial: Partial<HotkeyEvent>): HotkeyEvent {
  return { key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...partial }
}

test("QWERTY Ctrl+L / Cmd+L", () => {
  assert.equal(matchesHotkey(ev({ key: "l", code: "KeyL", ctrlKey: true }), key("l"), false), true)
  assert.equal(matchesHotkey(ev({ key: "l", code: "KeyL", metaKey: true }), key("l"), true), true)
  // Shift+letter arrives upper-case.
  assert.equal(
    matchesHotkey(ev({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }), { ...key("k"), shift: true }, false),
    true,
  )
})

test("Dvorak/AZERTY: the logical letter wins over the physical key", () => {
  // Dvorak: the key labelled N sits where QWERTY has L.
  assert.equal(matchesHotkey(ev({ key: "n", code: "KeyL", ctrlKey: true }), key("l"), false), false)
  // Dvorak: T sits on physical K.
  assert.equal(matchesHotkey(ev({ key: "t", code: "KeyK", ctrlKey: true }), key("k"), false), false)
  // Dvorak: the key printing L is physical KeyP.
  assert.equal(matchesHotkey(ev({ key: "l", code: "KeyP", ctrlKey: true }), key("l"), false), true)
  // AZERTY: Q is physical KeyA.
  assert.equal(matchesHotkey(ev({ key: "q", code: "KeyA", ctrlKey: true }), key("a"), false), false)
})

test("non-Latin layouts fall back to the physical key", () => {
  // Ukrainian: physical L types "д", physical K types "л".
  assert.equal(matchesHotkey(ev({ key: "д", code: "KeyL", ctrlKey: true }), key("l"), false), true)
  assert.equal(matchesHotkey(ev({ key: "л", code: "KeyK", ctrlKey: true }), key("k"), false), true)
  assert.equal(matchesHotkey(ev({ key: "л", code: "KeyK", ctrlKey: true }), key("l"), false), false)
  // AZERTY digit row: "&" on Digit1.
  assert.equal(matchesHotkey(ev({ key: "&", code: "Digit1", ctrlKey: true }), key("1"), false), true)
})

test("macOS uses Cmd only; other platforms use Ctrl only", () => {
  // macOS Ctrl+K is the Cocoa "kill line" binding, not the palette.
  assert.equal(matchesHotkey(ev({ key: "k", code: "KeyK", ctrlKey: true }), key("k"), true), false)
  assert.equal(matchesHotkey(ev({ key: "k", code: "KeyK", metaKey: true }), key("k"), true), true)
  assert.equal(matchesHotkey(ev({ key: "k", code: "KeyK", metaKey: true, ctrlKey: true }), key("k"), true), false)
  // Windows/Linux: the Super/Win key is not the modifier.
  assert.equal(matchesHotkey(ev({ key: "k", code: "KeyK", metaKey: true }), key("k"), false), false)
  // AltGr (Ctrl+Alt) is not Ctrl.
  assert.equal(matchesHotkey(ev({ key: "l", code: "KeyL", ctrlKey: true, altKey: true }), key("l"), false), false)
})

test("non-mod hotkeys match by key name and reject modifiers", () => {
  assert.equal(matchesHotkey(ev({ key: "Escape", code: "Escape" }), key("Escape", false), false), true)
  assert.equal(matchesHotkey(ev({ key: "Escape", code: "Escape", ctrlKey: true }), key("Escape", false), false), false)
  assert.equal(matchesHotkey(ev({ key: "Escape", code: "Escape", metaKey: true }), key("Escape", false), true), false)
  // A mod hotkey never fires without the modifier.
  assert.equal(matchesHotkey(ev({ key: "l", code: "KeyL" }), key("l"), false), false)
})
