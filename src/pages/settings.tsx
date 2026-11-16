import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog"
import { getVersion } from "@tauri-apps/api/app"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  History,
  Info,
  Languages,
  Loader2,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
} from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"
import { RestoreBackupDialog } from "@/pages/lock-screen"
import { PasswordGenerator, PasswordStrengthHint } from "@/components/password-generator"
import { useUpdater } from "@/hooks/use-updater"
import { copyText } from "@/lib/clipboard"
import { getErrorMessage, isApiError } from "@/lib/errors"
import { defaultExportFileName, exportTargetProblem, formatBytes, formatDateTime } from "@/lib/backup-format"
import { currentLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/i18n"
import { cn } from "@/lib/utils"
import { DEFAULT_SETTINGS, type BackupInfo, type ImportSummary, type MergeStrategy, type Settings } from "@/types"

const MIN_PASSWORD_LENGTH = 8
const AUTO_LOCK_OPTIONS = [0, 1, 5, 15, 30, 60]
const CLIPBOARD_CLEAR_OPTIONS = [0, 15, 30, 60, 120]
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = { en: "English", uk: "Українська" }

const DEVELOPER_URL = "https://github.com/romirom11"
const REPOSITORY_URL = "https://github.com/romirom11/AccMan"

const inputClass = "bg-gray-700 border-gray-600 text-white"
const outlineButtonClass = "border-gray-600 text-gray-300 bg-transparent hover:bg-gray-700"
const primaryButtonClass =
  "bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 flex items-center gap-2"

/** Keeps the current value selectable even if it is not one of the presets (older vaults). */
function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b)
}

function FieldError({ id, message }: { id?: string; message?: string | null }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-sm text-red-400">
      {message}
    </p>
  )
}

function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="flex gap-2 text-sm text-red-400 p-2 bg-red-900/20 rounded-md">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <p>{message}</p>
    </div>
  )
}

interface PasswordInputProps {
  id: string
  value: string
  onChange: (value: string) => void
  visible: boolean
  onToggleVisible?: () => void
  error?: string | null
  autoComplete: string
  placeholder?: string
  readOnly?: boolean
  inputRef?: React.Ref<HTMLInputElement>
}

/** Password input with an optional show/hide toggle and inline error styling. */
function PasswordInput({
  id,
  value,
  onChange,
  visible,
  onToggleVisible,
  error,
  autoComplete,
  placeholder,
  readOnly,
  inputRef,
}: PasswordInputProps) {
  const { t } = useTranslation()
  return (
    <div className="relative flex-1">
      <Input
        id={id}
        ref={inputRef}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        spellCheck={false}
        placeholder={placeholder}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(inputClass, onToggleVisible && "pr-10", error && "border-red-500")}
      />
      {onToggleVisible && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tabIndex={-1}
          className="absolute right-0 top-0 h-full px-3 text-gray-400 hover:text-white hover:bg-transparent"
          onClick={onToggleVisible}
          aria-label={visible ? t("settings.password.hide") : t("settings.password.show")}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Security: auto-lock and clipboard (saved immediately)

function SecuritySettings() {
  const { t } = useTranslation()
  const settings = useVaultStore((s) => s.vault?.settings) ?? DEFAULT_SETTINGS
  const updateSettings = useVaultStore((s) => s.updateSettings)
  const [saving, setSaving] = useState<keyof Settings | null>(null)
  const [pending, setPending] = useState<Settings | null>(null)
  const savingRef = useRef(false)

  const saveSetting = async (key: keyof Settings, value: number) => {
    if (savingRef.current) return
    // Read the latest copy so a concurrent change of another setting is not overwritten.
    const current = useVaultStore.getState().vault?.settings
    if (!current || current[key] === value) return
    const next: Settings = { ...current, [key]: value }
    savingRef.current = true
    setSaving(key)
    setPending(next)
    try {
      // The store shows the "saved" toast, the API layer the error toast.
      await updateSettings(next)
    } catch {
      // The select falls back to the stored value.
    } finally {
      savingRef.current = false
      setSaving(null)
      setPending(null)
    }
  }

  const shown = pending ?? settings

  const autoLockLabel = (minutes: number) => {
    if (minutes <= 0) return t("settings.autolock.disabled")
    if (minutes % 60 === 0) return t("settings.autolock.hour", { count: minutes / 60 })
    return t("settings.autolock.minutes", { count: minutes })
  }

  const clipboardLabel = (seconds: number) => {
    if (seconds <= 0) return t("settings.clipboard.never")
    if (seconds % 60 === 0) return t("settings.autolock.minutes", { count: seconds / 60 })
    return t("settings.clipboard.seconds", { count: seconds })
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="space-y-2">
        <Label htmlFor="autoLockTime" className="text-gray-300 flex items-center gap-2">
          {t("settings.autolock.label")}
          {saving === "autoLockMinutes" && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
        </Label>
        <p className="text-sm text-gray-400">{t("settings.autolock.description")}</p>
        <Select
          value={String(shown.autoLockMinutes)}
          onValueChange={(value) => void saveSetting("autoLockMinutes", Number(value))}
          disabled={saving !== null}
        >
          <SelectTrigger id="autoLockTime" className={cn("w-48", inputClass)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-700 border-gray-600">
            {withCurrent(AUTO_LOCK_OPTIONS, settings.autoLockMinutes).map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {autoLockLabel(minutes)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="clipboardClear" className="text-gray-300 flex items-center gap-2">
          {t("settings.clipboard.label")}
          {saving === "clipboardClearSeconds" && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
        </Label>
        <p className="text-sm text-gray-400">{t("settings.clipboard.description")}</p>
        <Select
          value={String(shown.clipboardClearSeconds)}
          onValueChange={(value) => void saveSetting("clipboardClearSeconds", Number(value))}
          disabled={saving !== null}
        >
          <SelectTrigger id="clipboardClear" className={cn("w-48", inputClass)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-700 border-gray-600">
            {withCurrent(CLIPBOARD_CLEAR_OPTIONS, settings.clipboardClearSeconds).map((seconds) => (
              <SelectItem key={seconds} value={String(seconds)}>
                {clipboardLabel(seconds)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500">{t("settings.clipboard.history_note")}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Change master password

interface PasswordFormErrors {
  current?: string
  next?: string
  confirm?: string
  general?: string
}

function ChangePasswordForm({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation()
  const changePassword = useVaultStore((s) => s.changePassword)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [errors, setErrors] = useState<PasswordFormErrors>({})
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const currentRef = useRef<HTMLInputElement>(null)

  const clearError = (field: keyof PasswordFormErrors) =>
    setErrors((prev) => (prev[field] || prev.general ? { ...prev, [field]: undefined, general: undefined } : prev))

  const validate = (): PasswordFormErrors => {
    const result: PasswordFormErrors = {}
    if (!current) result.current = t("settings.password.errors.current_required")
    if (next.length < MIN_PASSWORD_LENGTH) result.next = t("errors.password_too_short")
    else if (current && next === current) result.next = t("settings.password.errors.same_as_current")
    if (confirm !== next) result.confirm = t("errors.passwords_do_not_match")
    return result
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busyRef.current) return
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    busyRef.current = true
    setBusy(true)
    try {
      // Silent: errors are shown inline; the store shows the success toast.
      await changePassword(current, next, { silent: true })
      setCurrent("")
      setNext("")
      setConfirm("")
      setShowCurrent(false)
      setShowNew(false)
      setErrors({})
      // The backend took a backup before re-encrypting.
      onChanged?.()
    } catch (err) {
      if (isApiError(err, "INVALID_PASSWORD")) {
        setCurrent("")
        setErrors({ current: t("settings.password.errors.wrong_current") })
        requestAnimationFrame(() => currentRef.current?.focus())
      } else if (isApiError(err, "PASSWORD_TOO_SHORT")) {
        setErrors({ next: t("errors.password_too_short") })
      } else {
        setErrors({ general: getErrorMessage(err) })
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <h3 className="text-lg font-medium text-white">{t("settings.password.title")}</h3>
        <p className="text-sm text-gray-400 mt-1">{t("settings.password.description")}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="currentPassword" className="text-gray-300">
            {t("settings.password.current")}
          </Label>
          <PasswordInput
            id="currentPassword"
            inputRef={currentRef}
            value={current}
            onChange={(v) => {
              setCurrent(v)
              clearError("current")
            }}
            visible={showCurrent}
            onToggleVisible={() => setShowCurrent((v) => !v)}
            error={errors.current}
            autoComplete="current-password"
            readOnly={busy}
          />
          <FieldError id="currentPassword-error" message={errors.current} />
        </div>
        <div className="hidden md:block" />
        <div className="space-y-2">
          <Label htmlFor="newPassword" className="text-gray-300">
            {t("settings.password.new")}
          </Label>
          <div className="flex gap-2">
            <PasswordInput
              id="newPassword"
              value={next}
              onChange={(v) => {
                setNext(v)
                clearError("next")
              }}
              visible={showNew}
              onToggleVisible={() => setShowNew((v) => !v)}
              error={errors.next}
              autoComplete="new-password"
              readOnly={busy}
            />
            <PasswordGenerator
              disabled={busy}
              confirmReplace={next.length > 0}
              onGenerate={(value) => {
                setNext(value)
                setConfirm(value)
                setErrors((prev) => ({ ...prev, next: undefined, confirm: undefined, general: undefined }))
              }}
            />
          </div>
          <FieldError id="newPassword-error" message={errors.next} />
          <PasswordStrengthHint password={next} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword" className="text-gray-300">
            {t("settings.password.confirm")}
          </Label>
          <PasswordInput
            id="confirmPassword"
            value={confirm}
            onChange={(v) => {
              setConfirm(v)
              clearError("confirm")
            }}
            visible={showNew}
            error={errors.confirm}
            autoComplete="new-password"
            readOnly={busy}
          />
          <FieldError id="confirmPassword-error" message={errors.confirm} />
        </div>
      </div>
      <FormError message={errors.general} />
      <Button type="submit" className={primaryButtonClass} disabled={busy}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {busy ? t("settings.password.changing") : t("settings.password.change_button")}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------------------------
// Export dialog

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ExportErrors {
  password?: string
  confirm?: string
  general?: string
}

function ExportDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation()
  const exportVault = useVaultStore((s) => s.exportVault)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [visible, setVisible] = useState(false)
  const [errors, setErrors] = useState<ExportErrors>({})
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const reset = () => {
    setPassword("")
    setConfirm("")
    setVisible(false)
    setErrors({})
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (busyRef.current) return
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busyRef.current) return
    const found: ExportErrors = {}
    if (password.length < MIN_PASSWORD_LENGTH) found.password = t("errors.password_too_short")
    if (confirm !== password) found.confirm = t("errors.passwords_do_not_match")
    setErrors(found)
    if (Object.keys(found).length > 0) return

    busyRef.current = true
    setBusy(true)
    try {
      let filePath: string | null
      try {
        filePath = await saveFileDialog({
          title: t("settings.backup.export_dialog.title"),
          filters: [{ name: t("settings.backup.file_filter_name"), extensions: ["json"] }],
          defaultPath: defaultExportFileName(),
        })
      } catch (err) {
        setErrors({ general: getErrorMessage(err) })
        return
      }
      if (!filePath) return // The user cancelled the save dialog.

      // Silent: errors are shown inline; the store shows the success toast.
      await exportVault(filePath, password, { silent: true })
      reset()
      onOpenChange(false)
    } catch (err) {
      const targetProblem = isApiError(err, "VALIDATION") ? exportTargetProblem(err.message) : null
      if (isApiError(err, "PASSWORD_TOO_SHORT")) {
        setErrors({ password: t("errors.password_too_short") })
      } else if (targetProblem) {
        setErrors({ general: t(`settings.backup.errors.export_target.${targetProblem}`) })
      } else {
        setErrors({ general: getErrorMessage(err) })
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">{t("settings.backup.export_dialog.title")}</DialogTitle>
          <DialogDescription className="text-gray-400">
            {t("settings.backup.export_dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleExport} className="space-y-4" noValidate>
          <div className="flex gap-2 text-sm text-blue-300 p-3 bg-blue-900/20 border border-blue-700 rounded-md">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <p>{t("settings.backup.export_dialog.password_hint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="exportPassword" className="text-gray-300">
              {t("settings.backup.export_dialog.password_label")}
            </Label>
            <div className="flex gap-2">
              <PasswordInput
                id="exportPassword"
                value={password}
                onChange={(v) => {
                  setPassword(v)
                  setErrors((prev) => ({ ...prev, password: undefined, general: undefined }))
                }}
                visible={visible}
                onToggleVisible={() => setVisible((v) => !v)}
                error={errors.password}
                autoComplete="new-password"
                placeholder={t("settings.backup.export_dialog.password_placeholder")}
                readOnly={busy}
              />
              <PasswordGenerator
                disabled={busy}
                confirmReplace={password.length > 0}
                onGenerate={(value) => {
                  setPassword(value)
                  setConfirm(value)
                  setErrors({})
                }}
              />
            </div>
            <FieldError id="exportPassword-error" message={errors.password} />
            <PasswordStrengthHint password={password} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exportConfirmPassword" className="text-gray-300">
              {t("settings.backup.export_dialog.confirm_password_label")}
            </Label>
            <PasswordInput
              id="exportConfirmPassword"
              value={confirm}
              onChange={(v) => {
                setConfirm(v)
                setErrors((prev) => ({ ...prev, confirm: undefined, general: undefined }))
              }}
              visible={visible}
              error={errors.confirm}
              autoComplete="new-password"
              placeholder={t("settings.backup.export_dialog.confirm_password_placeholder")}
              readOnly={busy}
            />
            <FieldError id="exportConfirmPassword-error" message={errors.confirm} />
          </div>

          <FormError message={errors.general} />

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className={outlineButtonClass}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" className={primaryButtonClass} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {busy ? t("settings.backup.export_dialog.exporting") : t("settings.backup.export_dialog.export_button")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// Import dialog

interface ImportErrors {
  file?: string
  password?: string
  general?: string
}

function ImportSummaryView({ summary }: { summary: ImportSummary }) {
  const { t } = useTranslation()
  const rows: { key: keyof ImportSummary; label: string }[] = [
    { key: "serviceTypesAdded", label: t("settings.backup.import_dialog.summary.service_types_added") },
    { key: "serviceTypesMerged", label: t("settings.backup.import_dialog.summary.service_types_merged") },
    { key: "servicesAdded", label: t("settings.backup.import_dialog.summary.services_added") },
    { key: "servicesSkipped", label: t("settings.backup.import_dialog.summary.services_skipped") },
    { key: "accountsAdded", label: t("settings.backup.import_dialog.summary.accounts_added") },
    { key: "accountsSkipped", label: t("settings.backup.import_dialog.summary.accounts_skipped") },
  ]
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-green-400">
        <CheckCircle2 className="w-5 h-5" />
        <p className="font-medium">{t("settings.backup.import_dialog.summary.title")}</p>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm p-3 bg-gray-700/50 rounded-md">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-gray-300">{row.label}</dt>
            <dd className="text-right font-mono text-white">{summary[row.key]}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-gray-400">{t("settings.backup.import_dialog.summary.skipped_note")}</p>
    </div>
  )
}

function ImportDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation()
  const importVault = useVaultStore((s) => s.importVault)
  const [file, setFile] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [visible, setVisible] = useState(false)
  const [strategy, setStrategy] = useState<MergeStrategy>("merge")
  const [errors, setErrors] = useState<ImportErrors>({})
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    setPassword("")
    setVisible(false)
    setStrategy("merge")
    setErrors({})
    setSummary(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (busyRef.current) return
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const handleSelectFile = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: t("settings.backup.file_filter_name"), extensions: ["json"] }],
      })
      if (typeof selected === "string") {
        setFile(selected)
        setErrors((prev) => ({ ...prev, file: undefined, general: undefined }))
      }
    } catch (err) {
      setErrors({ general: getErrorMessage(err) })
    }
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busyRef.current) return
    const found: ImportErrors = {}
    if (!file) found.file = t("settings.backup.errors.file_required")
    if (!password) found.password = t("settings.backup.errors.password_required")
    setErrors(found)
    if (!file || Object.keys(found).length > 0) return

    busyRef.current = true
    setBusy(true)
    try {
      // Silent: errors are shown inline; the store shows the success toast.
      const result = await importVault(file, password, strategy, { silent: true })
      setPassword("")
      setVisible(false)
      setSummary(result)
    } catch (err) {
      if (isApiError(err, "INVALID_PASSWORD")) {
        setErrors({ password: t("settings.backup.errors.wrong_password") })
        requestAnimationFrame(() => {
          passwordRef.current?.focus()
          passwordRef.current?.select()
        })
      } else if (isApiError(err, "VAULT_CORRUPTED")) {
        setErrors({ file: t("settings.backup.errors.invalid_file") })
      } else {
        setErrors({ general: getErrorMessage(err) })
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">{t("settings.backup.import_dialog.title")}</DialogTitle>
          <DialogDescription className="text-gray-400">
            {t("settings.backup.import_dialog.description")}
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <>
            <ImportSummaryView summary={summary} />
            <DialogFooter>
              <Button type="button" className={primaryButtonClass} onClick={() => handleOpenChange(false)}>
                {t("settings.backup.import_dialog.done_button")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleImport} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="importFile" className="text-gray-300">
                {t("settings.backup.import_dialog.file_label")}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="importFile"
                  value={file ?? ""}
                  readOnly
                  title={file ?? undefined}
                  placeholder={t("settings.backup.import_dialog.no_file")}
                  aria-invalid={errors.file ? true : undefined}
                  className={cn(inputClass, "flex-1", errors.file && "border-red-500")}
                />
                <Button
                  type="button"
                  onClick={() => void handleSelectFile()}
                  variant="outline"
                  className={outlineButtonClass}
                  disabled={busy}
                >
                  {t("settings.backup.import_dialog.select_file_button")}
                </Button>
              </div>
              <FieldError message={errors.file} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="importPassword" className="text-gray-300">
                {t("settings.backup.import_dialog.password_label")}
              </Label>
              <PasswordInput
                id="importPassword"
                inputRef={passwordRef}
                value={password}
                onChange={(v) => {
                  setPassword(v)
                  setErrors((prev) => ({ ...prev, password: undefined, general: undefined }))
                }}
                visible={visible}
                onToggleVisible={() => setVisible((v) => !v)}
                error={errors.password}
                autoComplete="off"
                placeholder={t("settings.backup.import_dialog.password_placeholder")}
                readOnly={busy}
              />
              <FieldError id="importPassword-error" message={errors.password} />
              <p className="text-xs text-gray-400">{t("settings.backup.import_dialog.password_hint")}</p>
            </div>

            <div className="space-y-3">
              <Label className="text-gray-300">{t("settings.backup.import_dialog.strategy_label")}</Label>
              <RadioGroup
                value={strategy}
                onValueChange={(value) => setStrategy(value as MergeStrategy)}
                className="space-y-2"
                disabled={busy}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="merge" id="import-merge" className="border-gray-500" />
                  <Label htmlFor="import-merge" className="text-gray-300 cursor-pointer">
                    {t("settings.backup.import_dialog.strategy_merge")}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="replace" id="import-replace" className="border-gray-500" />
                  <Label htmlFor="import-replace" className="text-gray-300 cursor-pointer">
                    {t("settings.backup.import_dialog.strategy_replace")}
                  </Label>
                </div>
              </RadioGroup>

              {strategy === "replace" ? (
                <Alert className="bg-red-900/20 border-red-700">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <AlertDescription className="text-red-300">
                    {t("settings.backup.import_dialog.warnings.replace")}
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="bg-blue-900/20 border-blue-700">
                  <Info className="h-4 w-4 text-blue-400" />
                  <AlertDescription className="text-blue-300">
                    {t("settings.backup.import_dialog.warnings.merge")}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <FormError message={errors.general} />

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className={outlineButtonClass}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" className={primaryButtonClass} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {busy ? t("settings.backup.import_dialog.importing") : t("settings.backup.import_dialog.import_button")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// Automatic backups

/** `refreshKey` changes when a backup was taken without changing the vault (password change). */
function BackupsCard({ refreshKey }: { refreshKey: number }) {
  const { t } = useTranslation()
  const listBackups = useVaultStore((s) => s.listBackups)
  // Snapshots are taken by vault writes, so refresh the list whenever the vault changes.
  const vault = useVaultStore((s) => s.vault)
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    try {
      const list = await listBackups({ silent: true })
      if (request !== requestRef.current) return
      setBackups([...list].sort((a, b) => b.createdAt - a.createdAt))
      setLoadError(null)
    } catch (err) {
      if (request !== requestRef.current) return
      setLoadError(getErrorMessage(err))
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [listBackups])

  useEffect(() => {
    void load()
  }, [load, vault, refreshKey])

  const language = currentLanguage()

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-blue-400" />
          <CardTitle className="text-white">{t("settings.backups.title")}</CardTitle>
        </div>
        <CardDescription className="text-gray-400">{t("settings.backups.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="text-sm text-gray-400 list-disc pl-5 space-y-1">
          <li>{t("settings.backups.when_session")}</li>
          <li>{t("settings.backups.when_password")}</li>
          <li>{t("settings.backups.when_import")}</li>
          <li>{t("settings.backups.when_upgrade")}</li>
        </ul>
        <p className="text-sm text-gray-400">{t("settings.backups.retention", { count: 15 })}</p>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-gray-300">
              {backups ? t("settings.backups.count", { count: backups.length }) : t("settings.backups.list_label")}
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-white hover:bg-gray-700"
              onClick={() => void load()}
              disabled={loading}
              aria-label={t("settings.backups.refresh")}
              title={t("settings.backups.refresh")}
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </Button>
          </div>

          {loadError ? (
            <FormError message={loadError} />
          ) : backups === null ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 p-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("restore_backup.loading")}
            </div>
          ) : backups.length === 0 ? (
            <div className="text-sm text-gray-400 p-3 bg-gray-700/50 rounded-md">{t("settings.backups.empty")}</div>
          ) : (
            <ul className="max-h-56 overflow-y-auto divide-y divide-gray-700 rounded-md border border-gray-700">
              {backups.map((backup) => (
                <li
                  key={backup.fileName}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  title={backup.fileName}
                >
                  <span className="text-gray-200">{formatDateTime(backup.createdAt, language)}</span>
                  <span className="text-xs text-gray-400">{formatBytes(backup.sizeBytes, language)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2 text-sm text-yellow-300 p-3 bg-yellow-900/20 rounded-md">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>{t("settings.backups.restore_warning")}</p>
        </div>

        <Button
          type="button"
          variant="outline"
          className={outlineButtonClass}
          onClick={() => setRestoreOpen(true)}
          disabled={!backups || backups.length === 0}
        >
          <ArchiveRestore className="w-4 h-4 mr-2" />
          {t("settings.backups.restore_button")}
        </Button>

        <p className="text-xs text-gray-500">{t("settings.backups.export_note")}</p>
      </CardContent>

      <RestoreBackupDialog open={restoreOpen} onOpenChange={setRestoreOpen} onRestored={() => void load()} />
    </Card>
  )
}

// ---------------------------------------------------------------------------------------------
// About

function AboutLinkRow({ label, display, url }: { label: string; display: string; url: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <span>{label}:</span>
      <span className="text-gray-200 font-mono select-all break-all">{display}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-gray-400 hover:text-white hover:bg-gray-700"
        onClick={() => void copyText(url, { label })}
        aria-label={t("settings.about.copy_link", { label })}
        title={t("settings.about.copy_link", { label })}
      >
        <Copy className="w-3.5 h-3.5" />
      </Button>
    </div>
  )
}

function AboutCard() {
  const { t } = useTranslation()
  const { checkForUpdatesNow } = useUpdater()
  const [version, setVersion] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const handleCheckUpdates = async () => {
    if (checking) return
    setChecking(true)
    try {
      // Reports "up to date", progress and failures with its own toasts.
      await checkForUpdatesNow()
    } catch (err) {
      console.error("Update check failed", err)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    let active = true
    getVersion()
      .then((v) => {
        if (active) setVersion(v)
      })
      .catch(() => {
        // Not available outside Tauri (e.g. plain browser preview).
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-purple-500"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <CardTitle className="text-white">{t("settings.about.title")}</CardTitle>
        </div>
        <CardDescription className="text-gray-400">{t("settings.about.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {version && (
          <p className="text-sm text-gray-400">
            {t("settings.about.version")}: <span className="text-gray-200 font-mono">{version}</span>
          </p>
        )}
        <AboutLinkRow label={t("settings.about.developer")} display="@romirom11" url={DEVELOPER_URL} />
        <AboutLinkRow label={t("settings.about.repository")} display="github.com/romirom11/AccMan" url={REPOSITORY_URL} />
        <p className="text-xs text-gray-500">{t("settings.about.links_hint")}</p>
        <Button
          type="button"
          variant="outline"
          className={cn(outlineButtonClass, "mt-2")}
          onClick={() => void handleCheckUpdates()}
          disabled={checking}
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", checking && "animate-spin")} />
          {checking ? t("settings.about.checking_updates") : t("settings.about.check_updates")}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------------------------

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [backupsRefreshKey, setBackupsRefreshKey] = useState(0)

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng).catch((err: unknown) => console.error("Failed to change language", err))
  }

  return (
    <>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">{t("settings.title")}</h1>
          <p className="text-gray-400">{t("settings.description")}</p>
        </div>

        {/* Language */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Languages className="w-5 h-5 text-purple-500" />
              <CardTitle className="text-white">{t("settings.language.title")}</CardTitle>
            </div>
            <CardDescription className="text-gray-400">{t("settings.language.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={currentLanguage()} onValueChange={changeLanguage}>
              <SelectTrigger className={cn("w-48", inputClass)} aria-label={t("settings.language.title")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-700 border-gray-600">
                {SUPPORTED_LANGUAGES.map((lng) => (
                  <SelectItem key={lng} value={lng}>
                    {LANGUAGE_NAMES[lng]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-500" />
              <CardTitle className="text-white">{t("settings.security.title")}</CardTitle>
            </div>
            <CardDescription className="text-gray-400">{t("settings.security.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <SecuritySettings />
            <Separator className="bg-gray-700" />
            <ChangePasswordForm onChanged={() => setBackupsRefreshKey((n) => n + 1)} />
          </CardContent>
        </Card>

        {/* Export / import */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5 text-green-500" />
              <CardTitle className="text-white">{t("settings.backup.title")}</CardTitle>
            </div>
            <CardDescription className="text-gray-400">{t("settings.backup.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <Button onClick={() => setExportOpen(true)} variant="outline" className={outlineButtonClass}>
                <Download className="w-4 h-4 mr-2" />
                {t("settings.backup.export_button")}
              </Button>
              <Button onClick={() => setImportOpen(true)} variant="outline" className={outlineButtonClass}>
                <Upload className="w-4 h-4 mr-2" />
                {t("settings.backup.import_button")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Automatic backups */}
        <BackupsCard refreshKey={backupsRefreshKey} />

        {/* Danger zone */}
        <Card className="bg-gray-800 border-red-700">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" />
              <CardTitle className="text-white">{t("settings.danger.title")}</CardTitle>
            </div>
            <CardDescription className="text-gray-400">{t("settings.danger.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg">
              <h3 className="text-lg font-medium text-red-400 mb-2">{t("settings.danger.delete_title")}</h3>
              <p className="text-sm text-gray-400 mb-4">{t("settings.danger.delete_description")}</p>
              <Button variant="destructive" className="bg-red-600 hover:bg-red-700" disabled>
                <Trash2 className="w-4 h-4 mr-2" />
                {t("settings.danger.delete_button")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <AboutCard />
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  )
}
