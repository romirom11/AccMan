import { test } from "node:test"
import assert from "node:assert/strict"
import { confirmLeave, hasUnsavedChanges, registerDirtyChecker } from "../lib/unsaved-guard.ts"

const never = async () => {
  throw new Error("must not ask")
}

test("nothing registered or nothing dirty: leaves without asking", async () => {
  assert.equal(hasUnsavedChanges(), false)
  assert.equal(await confirmLeave(never), true)
  const unregister = registerDirtyChecker(() => false)
  assert.equal(await confirmLeave(never), true)
  unregister()
})

test("dirty page: asks and follows the answer, with the page's message", async () => {
  const asked: string[] = []
  const unregister = registerDirtyChecker(() => true, "Discard the draft type?")
  assert.equal(hasUnsavedChanges(), true)
  assert.equal(
    await confirmLeave(async (message) => {
      asked.push(message)
      return false
    }),
    false,
  )
  assert.equal(await confirmLeave(async () => true), true)
  assert.deepEqual(asked, ["Discard the draft type?"])
  unregister()
  assert.equal(hasUnsavedChanges(), false)
  assert.equal(await confirmLeave(never), true)
})

test("concurrent calls share one dialog; a failing dialog keeps the page", async () => {
  let calls = 0
  let answer: (value: boolean) => void = () => {}
  const unregister = registerDirtyChecker(() => true)
  const ask = () => {
    calls++
    return new Promise<boolean>((resolve) => {
      answer = resolve
    })
  }
  const first = confirmLeave(ask)
  const second = confirmLeave(ask)
  answer(true)
  assert.deepEqual(await Promise.all([first, second]), [true, true])
  assert.equal(calls, 1)

  assert.equal(await confirmLeave(async () => Promise.reject(new Error("no dialog"))), false)
  unregister()
})

test("a throwing checker does not block navigation", async () => {
  const unregister = registerDirtyChecker(() => {
    throw new Error("boom")
  })
  assert.equal(await confirmLeave(never), true)
  unregister()
})
