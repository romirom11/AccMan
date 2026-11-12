import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { AlertCircle, Copy, Eye, EyeOff, KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"
import { isMultilineValue, isSecretField, isTotpField } from "@/lib/service-helpers"
import { useTotp } from "@/hooks/use-totp"
import { useVaultStore } from "@/stores/vault-store"
import type { Service, ServiceField } from "@/types"

/** Revealed secrets are hidden again after this long. */
export const REVEAL_TIMEOUT_MS = 15_000

const MASK = "••••••••"

export interface FieldValueRowProps {
  field: ServiceField
  /** The stored value (`service.data[field.key]`); undefined is treated as empty. */
  value: string | undefined
  /** Prefixes the copy toast ("Discord main · Password"). */
  serviceLabel?: string
  size?: "md" | "sm"
  /**
   * Renders the value of a `linked_service` field. Receives the stored service id and the service
   * (undefined when it no longer exists). Without it the linked service's label is shown.
   */
  renderLinkedService?: (linkedServiceId: string, linkedService: Service | undefined) => ReactNode
  className?: string
}

/** Reveal state that hides itself after REVEAL_TIMEOUT_MS; the timer is cleared on toggle and unmount. */
function useAutoHideReveal(): [boolean, () => void] {
  const [revealed, setRevealed] = useState(false)
  const revealedRef = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const toggle = useCallback(() => {
    clearTimer()
    const next = !revealedRef.current
    revealedRef.current = next
    setRevealed(next)
    if (next) {
      timer.current = setTimeout(() => {
        timer.current = null
        revealedRef.current = false
        setRevealed(false)
      }, REVEAL_TIMEOUT_MS)
    }
  }, [clearTimer])

  useEffect(() => clearTimer, [clearTimer])
  return [revealed, toggle]
}

function IconButton({
  label,
  onClick,
  children,
  size,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  size: "md" | "sm" | "xs"
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "shrink-0 text-gray-400 hover:text-white hover:bg-gray-600",
        size === "xs" ? "h-6 w-6 [&_svg]:size-3.5" : size === "sm" ? "h-7 w-7" : "h-8 w-8",
      )}
    >
      {children}
    </Button>
  )
}

function ValueText({ value, multiline, className }: { value: string; multiline: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "text-white font-mono [overflow-wrap:anywhere]",
        multiline ? "whitespace-pre-wrap" : "whitespace-normal",
        className,
      )}
    >
      {value}
    </div>
  )
}

/** Circular countdown for the current TOTP period. */
function CountdownRing({ remaining, period, size }: { remaining: number; period: number; size: "md" | "sm" }) {
  const px = size === "sm" ? 22 : 28
  const stroke = 3
  const r = (px - stroke) / 2
  const circumference = 2 * Math.PI * r
  const fraction = Math.max(0, Math.min(1, remaining / period))
  const urgent = remaining <= 5
  return (
    <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: px, height: px }} aria-hidden="true">
      <svg width={px} height={px} className="-rotate-90">
        <circle cx={px / 2} cy={px / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-gray-600" />
        <circle
          cx={px / 2}
          cy={px / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className={cn("transition-[stroke-dashoffset] duration-1000 ease-linear", urgent ? "text-red-400" : "text-green-400")}
        />
      </svg>
      <span className={cn("absolute text-[10px] font-medium tabular-nums", urgent ? "text-red-300" : "text-gray-300")}>
        {remaining}
      </span>
    </span>
  )
}

/** "123456" -> "123 456" for reading; the copied code has no space. */
function formatCode(code: string): string {
  if (code.length < 6) return code
  const half = Math.ceil(code.length / 2)
  return `${code.slice(0, half)} ${code.slice(half)}`
}

/**
 * One row for a service field value: masking with an auto-hiding reveal, copy (secret-aware,
 * through copyText), live TOTP with countdown and "copy code" for 2fa fields, multi-line values and
 * linked services. All state is local to the instance: render it with a key unique per
 * service + field (e.g. `${service.id}:${field.id}`).
 */
export function FieldValueRow({
  field,
  value: rawValue,
  serviceLabel,
  size = "md",
  renderLinkedService,
  className,
}: FieldValueRowProps) {
  const { t } = useTranslation()
  // service.data[key] is undefined at runtime for fields that were never filled in.
  const value = typeof rawValue === "string" ? rawValue : ""
  const [revealed, toggleReveal] = useAutoHideReveal()
  const isTotp = isTotpField(field)
  const isSecret = isSecretField(field)
  const hasValue = value.length > 0
  const totp = useTotp(isTotp ? value : null, isTotp && hasValue)
  const isLinked = field.type === "linked_service"
  const linkedService = useVaultStore((s) =>
    isLinked && hasValue ? s.vault?.services.find((srv) => srv.id === value) : undefined,
  )

  const sm = size === "sm"
  const fieldName = field.label || field.key
  const copyLabel = serviceLabel ? `${serviceLabel} · ${fieldName}` : fieldName
  const multiline = isMultilineValue(field, value)
  const iconClass = "w-4 h-4"

  const copyValue = () => void copyText(value, { secret: isSecret, label: copyLabel })

  const labelEl = (
    <div className={cn("font-medium text-gray-300 block", sm ? "text-xs text-gray-400 mb-0.5" : "text-sm mb-1")}>
      {fieldName}
    </div>
  )

  const container = cn(
    "flex items-start justify-between gap-3",
    sm ? "p-2 bg-gray-600/50 rounded-md" : "p-3 bg-gray-700 rounded-lg",
    className,
  )

  if (!hasValue) {
    return (
      <div className={container}>
        <div className="min-w-0 flex-1">
          {labelEl}
          <div className={cn("italic", field.required ? "text-red-400" : "text-gray-500", sm ? "text-xs" : "text-sm")}>
            {field.required ? t("field_row.required_missing") : t("field_row.empty")}
          </div>
        </div>
      </div>
    )
  }

  if (isLinked) {
    return (
      <div className={cn(container, "block")}>
        {labelEl}
        {renderLinkedService ? (
          renderLinkedService(value, linkedService)
        ) : linkedService ? (
          <div className={cn("text-white", sm ? "text-sm" : "")}>{linkedService.label}</div>
        ) : (
          <div className={cn("italic text-gray-500", sm ? "text-xs" : "text-sm")}>{t("field_row.linked_missing")}</div>
        )}
      </div>
    )
  }

  if (isTotp) {
    const codeLabel = t("field_row.code_label", { field: fieldName })
    const keyLabel = t("field_row.secret_key")
    const copyCode = (code: string) =>
      void copyText(code, { secret: true, label: serviceLabel ? `${serviceLabel} · ${codeLabel}` : codeLabel })
    return (
      <div className={container}>
        <div className="min-w-0 flex-1 space-y-1">
          {labelEl}
          {totp.status === "ok" ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => copyCode(totp.code)}
                className={cn(
                  "font-mono tracking-widest text-green-400 tabular-nums rounded px-1 -mx-1 hover:bg-gray-600/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  sm ? "text-lg" : "text-2xl",
                )}
                aria-label={`${t("field_row.copy_code")}: ${totp.code}`}
                title={t("field_row.copy_code")}
              >
                {formatCode(totp.code)}
              </button>
              <CountdownRing remaining={totp.remainingSeconds} period={totp.period} size={size} />
              <span className="sr-only">{t("field_row.seconds_left", { seconds: totp.remainingSeconds })}</span>
            </div>
          ) : (
            <div role="alert" className={cn("flex items-start gap-1.5 text-red-400", sm ? "text-xs" : "text-sm")}>
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{t("field_row.invalid_totp")}</span>
            </div>
          )}
          <div className={cn("flex items-center gap-1.5 text-gray-400", sm ? "text-xs" : "text-sm")}>
            <KeyRound className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="shrink-0">{keyLabel}:</span>
            <span className="font-mono text-gray-300 min-w-0 [overflow-wrap:anywhere]">{revealed ? value : MASK}</span>
            <IconButton
              size="xs"
              label={revealed ? t("field_row.hide_secret_key") : t("field_row.show_secret_key")}
              onClick={toggleReveal}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </IconButton>
            <IconButton
              size="xs"
              label={t("field_row.copy_secret_key")}
              onClick={() =>
                void copyText(value, { secret: true, label: serviceLabel ? `${serviceLabel} · ${keyLabel}` : keyLabel })
              }
            >
              <Copy />
            </IconButton>
          </div>
        </div>
        {totp.status === "ok" && (
          <div className="flex gap-1 shrink-0">
            <IconButton size={size} label={t("field_row.copy_code")} onClick={() => copyCode(totp.code)}>
              <Copy className={iconClass} />
            </IconButton>
          </div>
        )}
      </div>
    )
  }

  const shown = isSecret && !revealed ? MASK : value
  return (
    <div className={container}>
      <div className="min-w-0 flex-1">
        {labelEl}
        <ValueText
          value={shown}
          multiline={multiline && shown !== MASK}
          className={cn(sm ? "text-sm" : "text-base", field.type === "url" && shown !== MASK && "text-blue-300")}
        />
      </div>
      <div className="flex gap-1 shrink-0">
        {isSecret && (
          <IconButton
            size={size}
            label={revealed ? t("field_row.hide", { field: fieldName }) : t("field_row.show", { field: fieldName })}
            onClick={toggleReveal}
          >
            {revealed ? <EyeOff className={iconClass} /> : <Eye className={iconClass} />}
          </IconButton>
        )}
        <IconButton size={size} label={t("field_row.copy", { field: fieldName })} onClick={copyValue}>
          <Copy className={iconClass} />
        </IconButton>
      </div>
    </div>
  )
}

export default FieldValueRow
