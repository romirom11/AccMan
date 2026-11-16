import { useDeferredValue, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select"
import { useVaultStore } from "@/stores/vault-store"
import type { Service, ServiceField, ServiceType } from "@/types"
import { isSecretField } from "@/lib/service-helpers"
import {
  TAB_SEPARATOR_TOKEN,
  assignColumnMapping,
  buildImportPlan,
  buildMappingOptions,
  countSkippedByReason,
  getColumnMapping,
  mappingToOptionValue,
  optionValueToMapping,
  parseNonNegativeInteger,
  parseRows,
  reconcileMappings,
  resolveSeparator,
  type ColumnMappings,
  type ImportPlan,
  type LabelStrategy,
  type SkippedRow,
} from "@/lib/import-parser"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  Info,
  Loader2,
  Upload,
  X,
} from "lucide-react"

const EMPTY_TYPES: ServiceType[] = []
const EMPTY_SERVICES: Service[] = []

/** Rows shown in the preview. */
const PREVIEW_ROWS = 5
/** Columns offered for mapping; a wrong separator can produce hundreds of columns. */
const MAX_MAPPED_COLUMNS = 50
/** Skipped rows / warnings listed when expanded. */
const MAX_LISTED_ISSUES = 200
const MASK = "••••••••"

const SEPARATOR_PRESETS = [":", ";", ",", "|", TAB_SEPARATOR_TOKEN]

const OUTLINE_BUTTON = "border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white bg-transparent"
const PRIMARY_BUTTON = "bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800"

interface ImportResultSummary {
  imported: number
  skipped: number
  warnings: number
}

function skipReasonText(t: TFunction, entry: SkippedRow): string {
  switch (entry.reason) {
    case "missing_label":
      return t("services.import.skip_reasons.missing_label")
    case "duplicate_label":
      return t("services.import.skip_reasons.duplicate_label", { value: entry.value ?? "" })
    case "unresolved_link":
      return t("services.import.skip_reasons.unresolved_link", { field: entry.field ?? "", value: entry.value ?? "" })
    case "ambiguous_link":
      return t("services.import.skip_reasons.ambiguous_link", { field: entry.field ?? "", value: entry.value ?? "" })
  }
}

export default function ServicesImport() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const addServices = useVaultStore((s) => s.addServices)
  const serviceTypes = useVaultStore((s) => s.vault?.serviceTypes) ?? EMPTY_TYPES
  const services = useVaultStore((s) => s.vault?.services) ?? EMPTY_SERVICES

  const [importData, setImportData] = useState("")
  const [separatorInput, setSeparatorInput] = useState(":")
  const [lastColumnTakesRest, setLastColumnTakesRest] = useState(false)
  const [columnsInput, setColumnsInput] = useState("")
  const [typeId, setTypeId] = useState("")
  const [mappings, setMappings] = useState<ColumnMappings>({})
  const [labelKind, setLabelKind] = useState<"column" | "generate">("column")
  const [labelColumn, setLabelColumn] = useState<number | null>(0)
  const [labelPattern, setLabelPattern] = useState("ACC")
  const [startNumberInput, setStartNumberInput] = useState("1")
  const [isImporting, setIsImporting] = useState(false)
  const importingRef = useRef(false)
  const [result, setResult] = useState<ImportResultSummary | null>(null)
  const [showSkipped, setShowSkipped] = useState(false)
  const [showWarnings, setShowWarnings] = useState(false)

  // Parsing works on a deferred copy so typing in a 10k-line textarea stays responsive.
  const deferredData = useDeferredValue(importData)
  const isParsing = deferredData !== importData
  const separator = resolveSeparator(separatorInput)
  const columnLimit = parseNonNegativeInteger(columnsInput)

  const parsed = useMemo(
    () =>
      parseRows(deferredData, {
        separator,
        lastColumnTakesRest,
        columns: columnLimit !== null && columnLimit >= 1 ? columnLimit : undefined,
      }),
    [deferredData, separator, lastColumnTakesRest, columnLimit],
  )
  const { rows, columnCount } = parsed
  const visibleColumns = Math.min(columnCount, MAX_MAPPED_COLUMNS)

  const serviceType = useMemo(() => serviceTypes.find((st) => st.id === typeId), [serviceTypes, typeId])
  const mappingOptions = useMemo(() => buildMappingOptions(serviceType), [serviceType])

  // The stored mappings and label column are kept when columns disappear for a moment (while the
  // separator or the column limit is being edited); only the effective values ignore columns
  // that are out of range, so the user's mapping comes back with the columns.
  const effectiveMappings = useMemo(
    () => reconcileMappings(mappings, visibleColumns, serviceType),
    [mappings, visibleColumns, serviceType],
  )
  const effectiveLabelColumn = labelColumn !== null && labelColumn < visibleColumns ? labelColumn : null

  const startNumber = parseNonNegativeInteger(startNumberInput)

  const blocker = useMemo((): string | null => {
    if (!separator) return t("services.import.errors.separator_required")
    if (!serviceType) return t("services.import.errors.select_main_type")
    if (labelKind === "column" && effectiveLabelColumn === null) return t("services.import.errors.select_label_column")
    if (labelKind === "generate" && startNumber === null) return t("services.import.errors.invalid_start_number")
    return null
  }, [separator, serviceType, labelKind, effectiveLabelColumn, startNumber, t])

  const labelStrategy = useMemo(
    (): LabelStrategy =>
      labelKind === "column"
        ? { kind: "column", column: effectiveLabelColumn }
        : { kind: "generate", pattern: labelPattern, startNumber: startNumber ?? 0 },
    [labelKind, effectiveLabelColumn, labelPattern, startNumber],
  )

  const plan = useMemo((): ImportPlan | null => {
    if (blocker || rows.length === 0) return null
    return buildImportPlan(rows, effectiveMappings, serviceType, serviceTypes, services, labelStrategy)
  }, [blocker, rows, effectiveMappings, serviceType, serviceTypes, services, labelStrategy])

  const skippedCounts = useMemo(() => (plan ? countSkippedByReason(plan.skipped) : null), [plan])
  const serviceLabelById = useMemo(() => new Map(services.map((s) => [s.id, s.label] as const)), [services])

  const linkedFields = useMemo(
    () => (serviceType?.fields ?? []).filter((f) => f.type === "linked_service"),
    [serviceType],
  )

  // Fields that receive data, in column order, for the preview table.
  const previewFields = useMemo(() => {
    if (!serviceType) return []
    const keys = new Set<string>()
    for (const mapping of Object.values(effectiveMappings)) {
      if (mapping.kind === "field") keys.add(mapping.fieldKey)
    }
    return serviceType.fields.filter((f) => keys.has(f.key))
  }, [serviceType, effectiveMappings])
  const hasTagColumns = useMemo(
    () => Object.values(effectiveMappings).some((m) => m.kind === "tags"),
    [effectiveMappings],
  )

  const handleDataChange = (data: string) => {
    setImportData(data)
    if (data) setResult(null)
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return
    try {
      handleDataChange(await file.text())
    } catch {
      toast.error(t("services.import.errors.file_read_failed"))
    } finally {
      // Allows choosing the same file again.
      input.value = ""
    }
  }

  const handleTypeChange = (value: string) => {
    if (!value) return
    const nextType = serviceTypes.find((st) => st.id === value)
    setTypeId(value)
    // Field mappings the new type cannot use are dropped; column mappings are kept.
    setMappings((current) => reconcileMappings(current, Number.POSITIVE_INFINITY, nextType))
    setShowSkipped(false)
    setShowWarnings(false)
  }

  const handleColumnMappingChange = (column: number, value: string) => {
    setMappings((current) => assignColumnMapping(current, column, optionValueToMapping(mappingOptions, value)))
  }

  const handleImport = async () => {
    if (importingRef.current || !plan || plan.services.length === 0) return
    importingRef.current = true
    setIsImporting(true)
    try {
      await addServices(plan.services)
      const summary: ImportResultSummary = {
        imported: plan.services.length,
        skipped: plan.skipped.length,
        warnings: plan.warnings.length,
      }
      setResult(summary)
      // addServices shows no toast of its own; this summary is the only success notice.
      toast.success(t("services.import.result_toast", { count: summary.imported }), {
        description:
          summary.skipped > 0 ? t("services.import.result_toast_skipped", { count: summary.skipped }) : undefined,
      })
      setImportData("")
      setShowSkipped(false)
      setShowWarnings(false)
    } catch {
      // The API layer already showed the error; keep the data and mapping so the user can retry.
    } finally {
      importingRef.current = false
      setIsImporting(false)
    }
  }

  const columnName = (index: number) => t("services.import.column_n", { n: index + 1 })

  const fieldForColumn = (column: number): ServiceField | undefined => {
    const mapping = getColumnMapping(effectiveMappings, column)
    return mapping.kind === "field" ? serviceType?.fields.find((f) => f.key === mapping.fieldKey) : undefined
  }

  const sampleForColumn = (column: number): string => {
    const value = rows[0]?.cells[column] ?? ""
    if (!value) return ""
    return isSecretField(fieldForColumn(column)) ? MASK : value
  }

  const renderPreviewValue = (field: ServiceField, value: string | undefined) => {
    if (!value) return <span className="text-gray-500">—</span>
    if (field.type === "linked_service") {
      return <span className="text-blue-300">{serviceLabelById.get(value) ?? value}</span>
    }
    if (isSecretField(field)) return <span className="font-mono text-gray-400">{MASK}</span>
    return value
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => navigate(-1)} aria-label={t("services.import.back")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-white">{t("services.import.title")}</h1>
          <p className="text-gray-400">{t("services.import.description")}</p>
        </div>
      </div>

      {result && (
        <Card className="bg-gray-800 border-green-700/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              {t("services.import.result.title")}
            </CardTitle>
            <CardDescription className="space-y-1">
              <span className="block">{t("services.import.result.imported", { count: result.imported })}</span>
              {result.skipped > 0 && (
                <span className="block">{t("services.import.result.skipped", { count: result.skipped })}</span>
              )}
              {result.warnings > 0 && (
                <span className="block text-amber-300">
                  {t("services.import.result.warnings", { count: result.warnings })}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" className={OUTLINE_BUTTON} onClick={() => setResult(null)}>
              {t("services.import.result.import_more")}
            </Button>
            <Button className={PRIMARY_BUTTON} onClick={() => navigate("/services")}>
              {t("services.import.result.open_services")}
            </Button>
          </CardFooter>
        </Card>
      )}

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle>{t("services.import.step1_title")}</CardTitle>
          <CardDescription>{t("services.import.step1_desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="file-upload" className="text-gray-300 flex items-center gap-2">
                <Upload className="w-4 h-4" />
                {t("services.import.upload_file")}
              </Label>
              <Input
                id="file-upload"
                type="file"
                onChange={handleFileChange}
                className="bg-gray-700 border-gray-600 text-white"
                accept=".csv,.txt,text/plain,text/csv"
                disabled={isImporting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="separator" className="text-gray-300">
                {t("services.import.separator")}
              </Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="separator"
                  value={separatorInput}
                  onChange={(e) => setSeparatorInput(e.target.value)}
                  className="bg-gray-700 border-gray-600 text-white font-mono w-28"
                  disabled={isImporting}
                  aria-invalid={!separator}
                />
                {SEPARATOR_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant="outline"
                    className={`${OUTLINE_BUTTON} font-mono h-10 ${separatorInput === preset ? "border-blue-500 text-white" : ""}`}
                    onClick={() => setSeparatorInput(preset)}
                    disabled={isImporting}
                  >
                    {preset === TAB_SEPARATOR_TOKEN ? t("services.import.separator_tab") : preset}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-gray-400">{t("services.import.separator_hint")}</p>
              {!separator && <p className="text-xs text-red-400">{t("services.import.errors.separator_required")}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="last-column-rest"
                checked={lastColumnTakesRest}
                onCheckedChange={(checked) => setLastColumnTakesRest(checked === true)}
                disabled={isImporting}
              />
              <Label htmlFor="last-column-rest" className="text-gray-300">
                {t("services.import.last_column_rest")}
              </Label>
            </div>
            <p className="text-xs text-gray-400 pl-6">{t("services.import.last_column_rest_hint")}</p>
            {lastColumnTakesRest && (
              <div className="flex items-center gap-2 pl-6">
                <Label htmlFor="column-limit" className="text-gray-300 text-sm">
                  {t("services.import.column_limit")}
                </Label>
                <Input
                  id="column-limit"
                  inputMode="numeric"
                  value={columnsInput}
                  onChange={(e) => setColumnsInput(e.target.value)}
                  placeholder={t("services.import.column_limit_auto", { n: parsed.columnLimit ?? 0 })}
                  className="bg-gray-700 border-gray-600 text-white w-40"
                  disabled={isImporting}
                />
              </div>
            )}
          </div>

          <div className="relative">
            {!importData && (
              <div className="absolute top-3 left-3 text-gray-400 text-sm flex items-center pointer-events-none">
                <CornerDownLeft className="w-3 h-3 mr-1" />
                <span>{t("services.import.paste_data_label")}</span>
              </div>
            )}
            <Textarea
              value={importData}
              onChange={(e) => handleDataChange(e.target.value)}
              className="bg-gray-700 border-gray-600 text-white h-48 font-mono text-sm"
              disabled={isImporting}
              spellCheck={false}
              aria-label={t("services.import.paste_data_label")}
            />
          </div>
          {importData && (
            <p className="text-sm text-gray-400 flex items-center gap-2">
              {isParsing && <Loader2 className="w-3 h-3 animate-spin" />}
              {t("services.import.parsed_summary", { rows: rows.length, columns: columnCount })}
            </p>
          )}
          {columnCount > MAX_MAPPED_COLUMNS && (
            <p className="text-sm text-amber-300">
              {t("services.import.too_many_columns", { n: MAX_MAPPED_COLUMNS })}
            </p>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle>{t("services.import.step2_title")}</CardTitle>
            <CardDescription>{t("services.import.step2_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label className="text-gray-300">{t("services.import.main_service_type")}</Label>
              <Select value={typeId} onValueChange={handleTypeChange} disabled={isImporting}>
                <SelectTrigger className="w-full bg-gray-700 border-gray-600 text-white">
                  <SelectValue placeholder={t("services.import.select_main_type_placeholder")} />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600 text-white">
                  {serviceTypes.map((st) => (
                    <SelectItem key={st.id} value={st.id}>
                      {st.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {serviceType && (
              <>
                <div className="space-y-4 p-4 border border-gray-700 rounded-lg">
                  <Label className="text-lg font-semibold text-white">{t("services.import.label_generation_title")}</Label>
                  <RadioGroup
                    value={labelKind}
                    onValueChange={(v) => setLabelKind(v === "generate" ? "generate" : "column")}
                    disabled={isImporting}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="column" id="label-from-column" />
                      <Label htmlFor="label-from-column">{t("services.import.label_strat_map")}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="generate" id="label-generate" />
                      <Label htmlFor="label-generate">{t("services.import.label_strat_generate")}</Label>
                    </div>
                  </RadioGroup>

                  {labelKind === "column" && (
                    <div className="space-y-2 pl-6">
                      <Label>{t("services.import.label_map_column")}</Label>
                      <Select
                        value={effectiveLabelColumn !== null ? String(effectiveLabelColumn) : ""}
                        onValueChange={(v) => {
                          if (v !== "") setLabelColumn(Number(v))
                        }}
                        disabled={isImporting}
                      >
                        <SelectTrigger className="w-full bg-gray-700 border-gray-600 text-white">
                          <SelectValue placeholder={t("services.import.select_column_placeholder")} />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-700 border-gray-600 text-white">
                          {Array.from({ length: visibleColumns }, (_, index) => (
                            <SelectItem key={index} value={String(index)}>
                              {sampleForColumn(index)
                                ? t("services.import.column_with_sample", {
                                    column: columnName(index),
                                    sample: sampleForColumn(index),
                                  })
                                : columnName(index)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-gray-400">{t("services.import.label_column_hint")}</p>
                    </div>
                  )}
                  {labelKind === "generate" && (
                    <div className="space-y-2 pl-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="pattern">{t("services.import.pattern")}</Label>
                          <Input
                            id="pattern"
                            value={labelPattern}
                            onChange={(e) => setLabelPattern(e.target.value)}
                            className="bg-gray-700 border-gray-600 text-white"
                            disabled={isImporting}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="startNumber">{t("services.import.start_number")}</Label>
                          <Input
                            id="startNumber"
                            inputMode="numeric"
                            value={startNumberInput}
                            onChange={(e) => setStartNumberInput(e.target.value)}
                            className="bg-gray-700 border-gray-600 text-white"
                            disabled={isImporting}
                            aria-invalid={startNumber === null}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-gray-400">{t("services.import.generate_hint")}</p>
                      {startNumber === null && (
                        <p className="text-xs text-red-400">{t("services.import.errors.invalid_start_number")}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Array.from({ length: visibleColumns }, (_, index) => {
                    const sample = sampleForColumn(index)
                    const isLabelColumn = labelKind === "column" && effectiveLabelColumn === index
                    return (
                      <div key={index} className="space-y-2">
                        <Label className="text-gray-300 flex items-center gap-2">
                          {columnName(index)}
                          {isLabelColumn && (
                            <span className="text-xs rounded bg-blue-600/30 text-blue-200 px-1.5 py-0.5">
                              {t("services.import.label_badge")}
                            </span>
                          )}
                        </Label>
                        <Select
                          value={mappingToOptionValue(mappingOptions, getColumnMapping(effectiveMappings, index))}
                          onValueChange={(value) => handleColumnMappingChange(index, value)}
                          disabled={isImporting}
                        >
                          <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                            <SelectValue placeholder={t("services.import.select_field")} />
                          </SelectTrigger>
                          <SelectContent className="bg-gray-700 border-gray-600 text-white max-h-80">
                            <SelectItem value="ignore">{t("services.fields.ignore")}</SelectItem>
                            <SelectItem value="tags">{t("services.fields.tags")}</SelectItem>
                            <SelectGroup>
                              <SelectLabel>{serviceType.name}</SelectLabel>
                              {mappingOptions
                                .filter((option) => option.field)
                                .map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.field!.label}
                                    {option.field!.required ? " *" : ""}
                                  </SelectItem>
                                ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-gray-500 truncate" title={sample || undefined}>
                          {sample ? t("services.import.sample", { value: sample }) : t("services.import.sample_empty")}
                        </p>
                      </div>
                    )
                  })}
                </div>

                {linkedFields.length > 0 && (
                  <div className="flex gap-2 rounded-lg border border-blue-800/60 bg-blue-950/30 p-3 text-sm text-blue-200">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>
                      {t("services.import.linked_rule", {
                        fields: linkedFields.map((f) => f.label).join(", "),
                      })}
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && serviceType && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle>{t("services.import.step3_title")}</CardTitle>
            <CardDescription>{t("services.import.step3_desc_v2", { n: PREVIEW_ROWS })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {blocker ? (
              <p className="text-sm text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {blocker}
              </p>
            ) : plan ? (
              <>
                {plan.services.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-gray-700">
                        <tr className="text-left">
                          <th className="p-2 text-gray-400 font-medium">{t("services.import.preview.row")}</th>
                          <th className="p-2 text-gray-300 font-medium">{t("services.import.preview.label")}</th>
                          {previewFields.map((f) => (
                            <th key={f.id} className="p-2 text-gray-300 font-medium">
                              {f.label}
                            </th>
                          ))}
                          {hasTagColumns && (
                            <th className="p-2 text-gray-300 font-medium">{t("services.fields.tags")}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {plan.services.slice(0, PREVIEW_ROWS).map((planned, index) => (
                          <tr key={planned.id} className="border-b border-gray-700">
                            <td className="p-2 text-gray-500">{plan.sourceRows[index]}</td>
                            <td className="p-2 text-white truncate max-w-xs">{planned.label}</td>
                            {previewFields.map((f) => (
                              <td key={f.id} className="p-2 text-white truncate max-w-xs">
                                {renderPreviewValue(f, planned.data[f.key])}
                              </td>
                            ))}
                            {hasTagColumns && (
                              <td className="p-2 text-gray-300 truncate max-w-xs">{planned.tags.join(", ")}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">{t("services.import.preview.nothing")}</p>
                )}

                <div className="rounded-lg border border-gray-700 p-4 space-y-3">
                  <p className="text-white font-medium flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-400" />
                    {t("services.import.summary.to_import", { count: plan.services.length })}
                  </p>

                  {plan.skipped.length > 0 && skippedCounts && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-amber-300 hover:text-amber-200 text-sm"
                        onClick={() => setShowSkipped((v) => !v)}
                        aria-expanded={showSkipped}
                      >
                        {showSkipped ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        {t("services.import.summary.skipped", { count: plan.skipped.length })}
                      </button>
                      <ul className="pl-6 text-xs text-gray-400 space-y-0.5">
                        {skippedCounts.missing_label > 0 && (
                          <li>{t("services.import.summary.reason_missing_label", { count: skippedCounts.missing_label })}</li>
                        )}
                        {skippedCounts.duplicate_label > 0 && (
                          <li>
                            {t("services.import.summary.reason_duplicate_label", { count: skippedCounts.duplicate_label })}
                          </li>
                        )}
                        {skippedCounts.unresolved_link > 0 && (
                          <li>
                            {t("services.import.summary.reason_unresolved_link", { count: skippedCounts.unresolved_link })}
                          </li>
                        )}
                        {skippedCounts.ambiguous_link > 0 && (
                          <li>
                            {t("services.import.summary.reason_ambiguous_link", { count: skippedCounts.ambiguous_link })}
                          </li>
                        )}
                      </ul>
                      {showSkipped && (
                        <ul className="pl-6 max-h-64 overflow-y-auto text-sm text-gray-300 space-y-1">
                          {plan.skipped.slice(0, MAX_LISTED_ISSUES).map((entry) => (
                            <li key={entry.row}>
                              <span className="text-gray-500">{t("services.import.line_n", { n: entry.row })}</span>{" "}
                              {skipReasonText(t, entry)}
                            </li>
                          ))}
                          {plan.skipped.length > MAX_LISTED_ISSUES && (
                            <li className="text-gray-500">
                              {t("services.import.and_more", { count: plan.skipped.length - MAX_LISTED_ISSUES })}
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  )}

                  {plan.warnings.length > 0 && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-amber-300 hover:text-amber-200 text-sm"
                        onClick={() => setShowWarnings((v) => !v)}
                        aria-expanded={showWarnings}
                      >
                        {showWarnings ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        {t("services.import.summary.missing_required", { count: plan.warnings.length })}
                      </button>
                      <p className="pl-6 text-xs text-gray-400">{t("services.import.summary.missing_required_hint")}</p>
                      {showWarnings && (
                        <ul className="pl-6 max-h-64 overflow-y-auto text-sm text-gray-300 space-y-1">
                          {plan.warnings.slice(0, MAX_LISTED_ISSUES).map((warning) => (
                            <li key={warning.row}>
                              <span className="text-gray-500">{t("services.import.line_n", { n: warning.row })}</span>{" "}
                              {t("services.import.summary.missing_fields", {
                                label: warning.label,
                                fields: warning.missingFields.join(", "),
                              })}
                            </li>
                          ))}
                          {plan.warnings.length > MAX_LISTED_ISSUES && (
                            <li className="text-gray-500">
                              {t("services.import.and_more", { count: plan.warnings.length - MAX_LISTED_ISSUES })}
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" className={OUTLINE_BUTTON} onClick={() => navigate(-1)} disabled={isImporting}>
              <X className="w-4 h-4 mr-2" />
              {t("common.cancel")}
            </Button>
            <Button
              className={PRIMARY_BUTTON}
              onClick={handleImport}
              disabled={isImporting || isParsing || !plan || plan.services.length === 0}
            >
              {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              {isImporting
                ? t("services.import.importing")
                : t("services.import.confirm_import_count", { count: plan?.services.length ?? 0 })}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}
