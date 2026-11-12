import { useEffect, useRef } from "react"

/** Events that count as user activity. Listened to on `document` in the capture phase,
 *  so scrolling inside any scroll container is seen too. */
const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "scroll", "touchstart"] as const

const DEFAULT_CHECK_INTERVAL_MS = 5_000

/**
 * Calls `onIdle` once when there was no user activity for `timeoutMs` of wall-clock time.
 *
 * Idle time is measured with `Date.now()` against the last activity timestamp, checked on an
 * interval and whenever the window regains focus/visibility, so time spent asleep or suspended
 * counts as idle. An incoming event is checked BEFORE it refreshes the timestamp, so the first
 * input after waking up locks instead of postponing the lock.
 *
 * `timeoutMs <= 0` disables it completely: no listeners, no timers, no re-renders.
 * The hook never re-renders its component; `onIdle` may change between renders.
 */
export function useAutoLock(timeoutMs: number, onIdle: () => void, checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS) {
  const onIdleRef = useRef(onIdle)

  useEffect(() => {
    onIdleRef.current = onIdle
  }, [onIdle])

  useEffect(() => {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return

    let lastActivity = Date.now()
    let fired = false

    const check = () => {
      if (fired) return
      if (Date.now() - lastActivity >= timeoutMs) {
        fired = true
        onIdleRef.current()
      }
    }

    const onActivity = () => {
      check()
      if (!fired) lastActivity = Date.now()
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") check()
    }

    const listenerOptions: AddEventListenerOptions = { capture: true, passive: true }
    for (const event of ACTIVITY_EVENTS) document.addEventListener(event, onActivity, listenerOptions)
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", onVisibility)
    const intervalId = window.setInterval(check, Math.max(250, Math.min(checkIntervalMs, timeoutMs)))

    return () => {
      for (const event of ACTIVITY_EVENTS) document.removeEventListener(event, onActivity, listenerOptions)
      window.removeEventListener("focus", check)
      document.removeEventListener("visibilitychange", onVisibility)
      window.clearInterval(intervalId)
    }
  }, [timeoutMs, checkIntervalMs])
}
