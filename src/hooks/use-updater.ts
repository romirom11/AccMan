import { useCallback } from "react"
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater"
import { ask } from "@tauri-apps/plugin-dialog"
import { relaunch } from "@tauri-apps/plugin-process"
import { toast } from "sonner"
import i18n from "@/i18n"

const TOAST_ID = "app-updater"

// Module-level guard: one check per app run (StrictMode mounts effects twice in dev).
let checkStarted = false
let checkRunning = false

function errorText(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

async function runUpdateCheck(manual: boolean) {
  if (checkRunning) return
  checkRunning = true
  const t = i18n.t.bind(i18n)
  try {
    let update
    try {
      update = await check()
    } catch (error) {
      // Offline or no release metadata: not worth bothering the user at startup.
      console.warn("Update check failed:", errorText(error))
      if (manual) toast.error(t("updater.check_failed", { message: errorText(error) }), { id: TOAST_ID })
      return
    }
    if (!update) {
      if (manual) toast.success(t("updater.up_to_date"), { id: TOAST_ID })
      return
    }

    const wantsUpdate = await ask(
      t("updater.available_message", { version: update.version, current: update.currentVersion }),
      {
        title: t("updater.available_title"),
        okLabel: t("updater.install"),
        cancelLabel: t("updater.later"),
      },
    )
    if (!wantsUpdate) {
      await update.close().catch(() => undefined)
      return
    }

    let total = 0
    let downloaded = 0
    let lastPercent = -1
    toast.loading(t("updater.downloading"), { id: TOAST_ID, duration: Infinity })

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0
            break
          case "Progress": {
            downloaded += event.data.chunkLength
            if (total > 0) {
              const percent = Math.min(100, Math.floor((downloaded / total) * 100))
              if (percent !== lastPercent) {
                lastPercent = percent
                toast.loading(t("updater.downloading_progress", { percent }), { id: TOAST_ID, duration: Infinity })
              }
            }
            break
          }
          case "Finished":
            toast.loading(t("updater.installing"), { id: TOAST_ID, duration: Infinity })
            break
        }
      })
    } catch (error) {
      toast.error(t("updater.failed", { message: errorText(error) }), { id: TOAST_ID, duration: 10_000 })
      return
    }

    toast.success(t("updater.installed"), { id: TOAST_ID, duration: 5_000 })
    const restartNow = await ask(t("updater.restart_message"), {
      title: t("updater.restart_title"),
      okLabel: t("updater.restart"),
      cancelLabel: t("updater.later"),
    })
    if (restartNow) {
      await relaunch()
    }
  } catch (error) {
    toast.error(t("updater.failed", { message: errorText(error) }), { id: TOAST_ID, duration: 10_000 })
  } finally {
    checkRunning = false
  }
}

/**
 * `checkForUpdates()` runs the startup update flow once per app run (later calls are no-ops):
 * native "update available" prompt, download progress toast, error toast, restart prompt.
 * `checkForUpdatesNow()` runs it on demand (ignores the once-per-run guard) and also reports
 * "up to date" / check failures with a toast.
 */
export function useUpdater() {
  const checkForUpdates = useCallback(async () => {
    if (checkStarted) return
    checkStarted = true
    await runUpdateCheck(false)
  }, [])

  const checkForUpdatesNow = useCallback(async () => {
    checkStarted = true
    await runUpdateCheck(true)
  }, [])

  return { checkForUpdates, checkForUpdatesNow }
}
