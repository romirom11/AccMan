import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Copy, RefreshCw, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { copyText } from "@/lib/clipboard"
import {
  DEFAULT_PASSWORD_OPTIONS,
  MIN_GENERATED_LENGTH,
  estimateStrength,
  generatePassword,
  type PasswordOptions,
} from "@/lib/password"

/** Slider range; longer values can still be requested programmatically (up to 128). */
const SLIDER_MAX_LENGTH = 64

// Options are remembered for the rest of the session (they are not secret).
let lastOptions: PasswordOptions = { ...DEFAULT_PASSWORD_OPTIONS }

const STRENGTH_COLORS = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-green-500", "bg-emerald-400"]
const STRENGTH_TEXT = ["text-red-400", "text-orange-400", "text-yellow-400", "text-green-400", "text-emerald-300"]

export interface PasswordStrengthHintProps {
  password: string
  className?: string
  /** Show the rough entropy in bits. Default false. */
  showBits?: boolean
}

/** Four-segment strength bar with a localised label. Renders nothing for an empty password. */
export function PasswordStrengthHint({ password, className, showBits = false }: PasswordStrengthHintProps) {
  const { t } = useTranslation()
  if (!password) return null
  const { score, labelKey, entropyBits } = estimateStrength(password)
  return (
    <div className={cn("space-y-1", className)} aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <div
            key={segment}
            className={cn("h-1 flex-1 rounded-full", score >= segment ? STRENGTH_COLORS[score] : "bg-gray-600")}
          />
        ))}
      </div>
      <p className={cn("text-xs", STRENGTH_TEXT[score])}>
        {t("password_strength.label", { strength: t(labelKey) })}
        {showBits && <span className="text-gray-400"> · {t("password_strength.bits", { bits: entropyBits })}</span>}
        {score <= 1 && <span className="text-gray-400"> {t("password_strength.weak_hint")}</span>}
      </p>
    </div>
  )
}

export interface PasswordGeneratorProps {
  /** Called with the generated password when the user clicks "Use password". */
  onGenerate: (value: string) => void
  /** Ask for a second click before replacing an existing value. */
  confirmReplace?: boolean
  /** Overrides the remembered options when the popover opens (e.g. a longer default length). */
  defaultOptions?: Partial<PasswordOptions>
  disabled?: boolean
  className?: string
  align?: "start" | "center" | "end"
}

/**
 * Icon button that opens a popover with a password generator: length slider, character-class
 * switches, regenerate, copy and "use". Nothing is generated until it is opened.
 */
export function PasswordGenerator({
  onGenerate,
  confirmReplace = false,
  defaultOptions,
  disabled,
  className,
  align = "end",
}: PasswordGeneratorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<PasswordOptions>(lastOptions)
  const [value, setValue] = useState("")
  const [confirming, setConfirming] = useState(false)

  const regenerate = useCallback((next: PasswordOptions) => {
    setValue(generatePassword(next))
    setConfirming(false)
  }, [])

  const updateOptions = (patch: Partial<PasswordOptions>) => {
    const next = { ...options, ...patch }
    // Keep at least one character class on.
    if (!next.lowercase && !next.uppercase && !next.digits && !next.symbols) return
    lastOptions = next
    setOptions(next)
    regenerate(next)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      const initial = { ...lastOptions, ...defaultOptions }
      setOptions(initial)
      regenerate(initial)
    } else {
      // Do not keep a generated password around after closing.
      setValue("")
      setConfirming(false)
    }
  }

  const handleUse = () => {
    if (!value) return
    if (confirmReplace && !confirming) {
      setConfirming(true)
      return
    }
    onGenerate(value)
    handleOpenChange(false)
  }

  const toggles: { key: keyof Omit<PasswordOptions, "length">; label: string }[] = [
    { key: "lowercase", label: t("password_generator.lowercase") },
    { key: "uppercase", label: t("password_generator.uppercase") },
    { key: "digits", label: t("password_generator.digits") },
    { key: "symbols", label: t("password_generator.symbols") },
    { key: "excludeAmbiguous", label: t("password_generator.exclude_ambiguous") },
  ]

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label={t("password_generator.open")}
          title={t("password_generator.open")}
          className={cn("shrink-0 border-gray-600 bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white", className)}
        >
          <WandSparkles className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 bg-gray-800 border-gray-700 text-white space-y-4">
        <div className="text-sm font-semibold">{t("password_generator.title")}</div>

        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <div
              className="flex-1 min-w-0 rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 font-mono text-sm break-all select-all"
              aria-label={t("password_generator.generated_password")}
            >
              {value}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-gray-400 hover:text-white hover:bg-gray-700"
              onClick={() => regenerate(options)}
              aria-label={t("password_generator.regenerate")}
              title={t("password_generator.regenerate")}
            >
              <RefreshCw />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-gray-400 hover:text-white hover:bg-gray-700"
              onClick={() => void copyText(value, { secret: true, label: t("password_generator.generated_password") })}
              aria-label={t("password_generator.copy")}
              title={t("password_generator.copy")}
            >
              <Copy />
            </Button>
          </div>
          <PasswordStrengthHint password={value} showBits />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <Label htmlFor="password-generator-length" className="text-gray-300">
              {t("password_generator.length")}
            </Label>
            <span className="tabular-nums text-gray-300">{options.length}</span>
          </div>
          <Slider
            id="password-generator-length"
            min={MIN_GENERATED_LENGTH}
            max={Math.max(SLIDER_MAX_LENGTH, options.length)}
            step={1}
            value={[options.length]}
            onValueChange={([length]) => updateOptions({ length })}
            aria-label={t("password_generator.length")}
          />
        </div>

        <div className="space-y-2">
          {toggles.map(({ key, label }) => {
            const id = `password-generator-${key}`
            return (
              <div key={key} className="flex items-center justify-between gap-2">
                <Label htmlFor={id} className="text-sm text-gray-300 font-normal">
                  {label}
                </Label>
                <Switch id={id} checked={options[key]} onCheckedChange={(checked) => updateOptions({ [key]: checked })} />
              </div>
            )
          })}
        </div>

        <Button
          type="button"
          onClick={handleUse}
          className="w-full bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800 text-white"
        >
          <Check className="w-4 h-4" />
          {confirming ? t("password_generator.replace_confirm") : t("password_generator.use")}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

export default PasswordGenerator
