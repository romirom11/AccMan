import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertTriangle, ArchiveRestore, Check, Eye, EyeOff, Loader2 } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"
import { getErrorMessage, toApiError } from "@/lib/errors"
import type { BackupInfo } from "@/types"
import { cn } from "@/lib/utils"

const BACKUP_HINT_CODES = new Set(["VAULT_CORRUPTED", "UNSUPPORTED_VAULT_VERSION"])

interface InlineError {
  code: string
  message: string
}

function focusAndSelect(input: HTMLInputElement | null) {
  // After React has re-enabled/re-rendered the field.
  requestAnimationFrame(() => {
    input?.focus()
    input?.select()
  })
}

function formatBytes(bytes: number, language: string): string {
  const units = [
    { unit: "megabyte", size: 1024 * 1024 },
    { unit: "kilobyte", size: 1024 },
  ]
  for (const { unit, size } of units) {
    if (bytes >= size) {
      try {
        return new Intl.NumberFormat(language, { style: "unit", unit, maximumFractionDigits: 1 }).format(bytes / size)
      } catch {
        return `${(bytes / size).toFixed(1)} ${unit === "megabyte" ? "MB" : "KB"}`
      }
    }
  }
  try {
    return new Intl.NumberFormat(language, { style: "unit", unit: "byte" }).format(bytes)
  } catch {
    return `${bytes} B`
  }
}

function formatDate(ms: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms))
  } catch {
    return new Date(ms).toLocaleString()
  }
}

interface RestoreBackupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful restore (the vault is then unlocked with the restored data). */
  onRestored?: () => void
}

/**
 * Lists the automatic backups (works while locked) and restores the selected one with the
 * password that was valid when it was made. That password becomes the master password.
 * Errors are shown inline; the success toast comes from the store.
 */
export function RestoreBackupDialog({ open, onOpenChange, onRestored }: RestoreBackupDialogProps) {
  const { t, i18n } = useTranslation()
  const listBackups = useVaultStore((s) => s.listBackups)
  const restoreBackup = useVaultStore((s) => s.restoreBackup)

  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const restoringRef = useRef(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setBackups(null)
    setLoadError(null)
    try {
      const list = await listBackups({ silent: true })
      const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt)
      setBackups(sorted)
      setSelected((current) =>
        current && sorted.some((b) => b.fileName === current) ? current : (sorted[0]?.fileName ?? null),
      )
    } catch (e) {
      setLoadError(getErrorMessage(e))
      setBackups([])
    }
  }, [listBackups])

  const resetForm = useCallback(() => {
    setPassword("")
    setShowPassword(false)
    setError(null)
    setSelected(null)
  }, [])

  useEffect(() => {
    if (open) {
      resetForm()
      void load()
    }
  }, [open, load, resetForm])

  /** Closing (Cancel, Escape, overlay) also forgets the typed password: the dialog may stay mounted. */
  const handleOpenChange = (next: boolean) => {
    if (restoringRef.current) return
    if (!next) resetForm()
    onOpenChange(next)
  }

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (restoringRef.current || !selected || !password) return
    restoringRef.current = true
    setRestoring(true)
    setError(null)
    try {
      await restoreBackup(selected, password, { silent: true })
      resetForm()
      onOpenChange(false)
      onRestored?.()
    } catch (err) {
      const apiError = toApiError(err)
      setError(
        apiError.code === "INVALID_PASSWORD" ? t("restore_backup.wrong_password") : getErrorMessage(apiError),
      )
      focusAndSelect(passwordRef.current)
    } finally {
      restoringRef.current = false
      setRestoring(false)
    }
  }

  const language = i18n.resolvedLanguage ?? i18n.language

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArchiveRestore className="w-5 h-5 text-purple-400" />
            {t("restore_backup.title")}
          </DialogTitle>
          <DialogDescription className="text-gray-400">{t("restore_backup.description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleRestore} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-gray-300">{t("restore_backup.list_label")}</Label>
            {backups === null ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 p-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("restore_backup.loading")}
              </div>
            ) : loadError ? (
              <div className="space-y-2">
                <div className="text-red-400 text-sm p-2 bg-red-900/20 rounded-md">{loadError}</div>
                <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                  {t("app.retry")}
                </Button>
              </div>
            ) : backups.length === 0 ? (
              <div className="text-sm text-gray-400 p-2 bg-gray-700/50 rounded-md">{t("restore_backup.no_backups")}</div>
            ) : (
              <div role="radiogroup" className="max-h-60 overflow-y-auto space-y-1 pr-1">
                {backups.map((backup) => {
                  const isSelected = backup.fileName === selected
                  return (
                    <button
                      key={backup.fileName}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelected(backup.fileName)}
                      disabled={restoring}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                        isSelected
                          ? "border-blue-500 bg-blue-900/30 text-white"
                          : "border-gray-600 bg-gray-700 text-gray-300 hover:bg-gray-600",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {isSelected ? <Check className="w-4 h-4 text-blue-400" /> : <span className="w-4 h-4" />}
                        {formatDate(backup.createdAt, language)}
                      </span>
                      <span className="text-xs text-gray-400">{formatBytes(backup.sizeBytes, language)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {backups && backups.length > 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="restore-password" className="text-gray-300">
                  {t("restore_backup.password_label")}
                </Label>
                <div className="relative">
                  <Input
                    id="restore-password"
                    ref={passwordRef}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      if (error) setError(null)
                    }}
                    readOnly={restoring}
                    autoComplete="off"
                    aria-invalid={error ? true : undefined}
                    className="bg-gray-700 border-gray-600 text-white pr-10"
                    placeholder={t("restore_backup.password_placeholder")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 text-gray-400 hover:text-white"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("lock_screen.hide_password") : t("lock_screen.show_password")}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex gap-2 text-sm text-yellow-300 p-3 bg-yellow-900/20 rounded-md">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{t("restore_backup.password_becomes_master")}</p>
              </div>
            </>
          )}

          {error && (
            <div role="alert" className="text-red-400 text-sm p-2 bg-red-900/20 rounded-md">
              {error}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={restoring}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              className="bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 flex items-center gap-2"
              disabled={restoring || !selected || !password}
            >
              {restoring && <Loader2 className="w-4 h-4 animate-spin" />}
              {restoring ? t("restore_backup.restoring") : t("restore_backup.restore_button")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function LockScreen() {
  const { t } = useTranslation()
  const unlock = useVaultStore((s) => s.unlock)

  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<InlineError | null>(null)
  const [capsLock, setCapsLock] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const submittingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // One unlock attempt per submit; ignore repeated Enter presses while one is running.
    if (submittingRef.current || !password) return
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    try {
      await unlock(password)
      // On success the route guard leaves this page.
    } catch (err) {
      const apiError = toApiError(err)
      setError({ code: apiError.code, message: getErrorMessage(apiError) })
      focusAndSelect(inputRef.current)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const updateCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock"))
  }

  const showBackupHint = error !== null && BACKUP_HINT_CODES.has(error.code)

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-900">
      <Card className="w-full max-w-md bg-gray-800 border-gray-700">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-white rounded-full flex items-center justify-center">
            <img src="/accman.png" alt="AccMan" className="w-10 h-10" />
          </div>
          <CardTitle className="text-2xl font-bold text-white">AccMan</CardTitle>
          <CardDescription className="text-gray-400">{t("lock_screen.title")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300">
                {t("lock_screen.password_label")}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  ref={inputRef}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error) setError(null)
                  }}
                  onKeyDown={updateCapsLock}
                  onKeyUp={updateCapsLock}
                  onBlur={() => setCapsLock(false)}
                  // readOnly (not disabled) keeps focus in the field while unlocking.
                  readOnly={submitting}
                  autoComplete="current-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "unlock-error" : undefined}
                  className={cn(
                    "bg-gray-700 border-gray-600 text-white pr-10",
                    error && error.code === "INVALID_PASSWORD" && "border-red-500",
                  )}
                  placeholder={t("lock_screen.password_placeholder")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  tabIndex={-1}
                  className="absolute right-0 top-0 h-full px-3 text-gray-400 hover:text-white"
                  onClick={() => {
                    setShowPassword((v) => !v)
                    inputRef.current?.focus()
                  }}
                  aria-label={showPassword ? t("lock_screen.hide_password") : t("lock_screen.show_password")}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              {capsLock && <p className="text-xs text-yellow-300">{t("lock_screen.caps_lock_on")}</p>}
            </div>

            {error && (
              <div
                id="unlock-error"
                role="alert"
                className="text-red-400 text-sm text-center p-2 bg-red-900/20 rounded-md space-y-2"
              >
                <p>{error.message}</p>
                {showBackupHint && <p className="text-gray-300">{t("lock_screen.backup_hint")}</p>}
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 flex items-center justify-center gap-2"
              disabled={submitting || !password}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? t("lock_screen.unlocking") : t("lock_screen.unlock_button")}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "w-full text-gray-400 hover:text-white flex items-center justify-center gap-2",
                showBackupHint && "text-blue-400",
              )}
              onClick={() => setRestoreOpen(true)}
              disabled={submitting}
            >
              <ArchiveRestore className="w-4 h-4" />
              {t("lock_screen.restore_from_backup")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <RestoreBackupDialog open={restoreOpen} onOpenChange={setRestoreOpen} />
    </div>
  )
}
