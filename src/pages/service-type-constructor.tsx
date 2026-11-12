import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { confirm } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react"
import { useVaultStore } from "@/stores/vault-store"
import { fieldValueLosses, generateFieldKey, isValidFieldKey, slugifyFieldKey } from "@/lib/field-keys"
import { useUnsavedGuard } from "@/lib/unsaved-guard"
import type { FieldType, Service, ServiceField, ServiceType } from "@/types"

const EMPTY_TYPES: ServiceType[] = []
const EMPTY_SERVICES: Service[] = []

/** Ids of new types: lowercase letters, digits, '_' and '-' (the built-in types use '-'). */
const TYPE_ID_PATTERN = /^[a-z0-9_-]+$/
const DEFAULT_ICON = "Server"
const FIELD_TYPES: FieldType[] = ["text", "secret", "textarea", "url", "2fa", "linked_service"]
const PRIMARY_BUTTON = "bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 hover:to-purple-800"

interface Draft {
  type: ServiceType
  isNew: boolean
  /** JSON of `type` when editing started, for the unsaved-changes check. */
  snapshot: string
}

interface FieldErrors {
  label?: string
  key?: string
  linked?: string
}

interface DraftErrors {
  name?: string
  id?: string
  fields: Record<string, FieldErrors>
  count: number
}

/** A unique id for a new type, derived from its name (Cyrillic is transliterated). */
function generateTypeId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds)
  const base = slugifyFieldKey(name) || "custom_type"
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

function fieldTypeLabel(t: TFunction, type: FieldType): string {
  switch (type) {
    case "text":
      return t("service_type_constructor.field_types.text")
    case "secret":
      return t("service_type_constructor.field_types.secret")
    case "textarea":
      return t("service_type_constructor.field_types.textarea")
    case "url":
      return t("service_type_constructor.field_types.url")
    case "2fa":
      return t("service_type_constructor.field_types.2fa")
    case "linked_service":
      return t("service_type_constructor.field_types.linked_service")
  }
}

function validateDraft(draft: Draft, serviceTypes: readonly ServiceType[], t: TFunction): DraftErrors {
  const errors: DraftErrors = { fields: {}, count: 0 }
  const { type } = draft
  if (!type.name.trim()) {
    errors.name = t("service_type_constructor.errors.name_required")
    errors.count++
  }
  if (draft.isNew) {
    const id = type.id.trim()
    if (!id) errors.id = t("service_type_constructor.errors.id_required")
    else if (!TYPE_ID_PATTERN.test(id)) errors.id = t("service_type_constructor.errors.id_invalid")
    else if (serviceTypes.some((st) => st.id === id)) errors.id = t("service_type_constructor.errors.id_taken")
    if (errors.id) errors.count++
  }

  const keyCounts = new Map<string, number>()
  for (const field of type.fields) keyCounts.set(field.key, (keyCounts.get(field.key) ?? 0) + 1)

  for (const field of type.fields) {
    const fieldErrors: FieldErrors = {}
    if (!field.label.trim()) fieldErrors.label = t("service_type_constructor.errors.field_label_required")
    if (!field.key) fieldErrors.key = t("service_type_constructor.errors.key_required")
    else if (!isValidFieldKey(field.key)) fieldErrors.key = t("service_type_constructor.errors.key_invalid")
    else if ((keyCounts.get(field.key) ?? 0) > 1) fieldErrors.key = t("service_type_constructor.errors.key_duplicate")
    if (field.type === "linked_service") {
      const target = field.linkedServiceTypeId
      if (!target) fieldErrors.linked = t("service_type_constructor.errors.linked_required")
      else if (target !== type.id && !serviceTypes.some((st) => st.id === target)) {
        fieldErrors.linked = t("service_type_constructor.errors.linked_missing")
      }
    }
    const n = Object.keys(fieldErrors).length
    if (n > 0) {
      errors.fields[field.id] = fieldErrors
      errors.count += n
    }
  }
  return errors
}

/** The type as it is sent to the backend: trimmed, 2FA always masked, link target only on linked fields. */
function toPayload(type: ServiceType): ServiceType {
  return {
    ...type,
    id: type.id.trim(),
    name: type.name.trim(),
    icon: type.icon || DEFAULT_ICON,
    fields: type.fields.map((field) => {
      const { linkedServiceTypeId, ...rest } = field
      const next: ServiceField = {
        ...rest,
        label: field.label.trim(),
        masked: field.type === "2fa" ? true : field.masked,
      }
      if (field.type === "linked_service" && linkedServiceTypeId) next.linkedServiceTypeId = linkedServiceTypeId
      return next
    }),
  }
}

/** Native confirm dialog; falls back to window.confirm if the dialog plugin is unavailable. */
async function askConfirm(message: string, title: string): Promise<boolean> {
  try {
    return await confirm(message, { title, kind: "warning" })
  } catch {
    return window.confirm(message)
  }
}

export default function ServiceTypeConstructor() {
  const { t } = useTranslation()
  const addServiceType = useVaultStore((s) => s.addServiceType)
  const updateServiceType = useVaultStore((s) => s.updateServiceType)
  const deleteServiceType = useVaultStore((s) => s.deleteServiceType)
  const serviceTypes = useVaultStore((s) => s.vault?.serviceTypes) ?? EMPTY_TYPES
  const services = useVaultStore((s) => s.vault?.services) ?? EMPTY_SERVICES

  const [selectedTypeId, setSelectedTypeId] = useState("")
  const [draft, setDraft] = useState<Draft | null>(null)
  /** New fields whose key the user typed by hand (their key no longer follows the label). */
  const [touchedKeys, setTouchedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [idTouched, setIdTouched] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const busyRef = useRef(false)

  const selectedType = serviceTypes.find((type) => type.id === selectedTypeId)

  const serviceCountByType = useMemo(() => {
    const counts = new Map<string, number>()
    for (const service of services) counts.set(service.serviceTypeId, (counts.get(service.serviceTypeId) ?? 0) + 1)
    return counts
  }, [services])

  // Keys of the saved version of the type being edited, by field id. Fields not in here are new.
  const persistedKeyById = useMemo(() => {
    const map = new Map<string, string>()
    if (!draft || draft.isNew) return map
    const stored = serviceTypes.find((st) => st.id === draft.type.id)
    for (const field of stored?.fields ?? []) map.set(field.id, field.key)
    return map
  }, [draft, serviceTypes])

  const isDirty = !!draft && JSON.stringify(draft.type) !== draft.snapshot
  // Leaving the page through the sidebar or the command palette asks first.
  useUnsavedGuard(isDirty, t("service_type_constructor.discard_confirm.message"))
  const errors = useMemo(() => (draft ? validateDraft(draft, serviceTypes, t) : null), [draft, serviceTypes, t])
  const visibleErrors = showErrors ? errors : null
  const busy = isSaving || isDeleting

  const confirmDiscard = async (): Promise<boolean> => {
    if (!isDirty) return true
    return askConfirm(
      t("service_type_constructor.discard_confirm.message"),
      t("service_type_constructor.discard_confirm.title"),
    )
  }

  const openDraft = (type: ServiceType, isNew: boolean) => {
    const copy: ServiceType = { ...type, fields: type.fields.map((f) => ({ ...f })) }
    setDraft({ type: copy, isNew, snapshot: JSON.stringify(copy) })
    setTouchedKeys(new Set())
    setIdTouched(false)
    setShowErrors(false)
  }

  const selectType = async (typeId: string) => {
    if (draft && !(await confirmDiscard())) return
    setDraft(null)
    setSelectedTypeId(typeId)
  }

  const startCreating = async () => {
    if (draft && !(await confirmDiscard())) return
    openDraft({ id: "", name: "", icon: DEFAULT_ICON, fields: [] }, true)
    setSelectedTypeId("")
  }

  const startEditing = async (type: ServiceType) => {
    if (draft && !draft.isNew && draft.type.id === type.id) return
    if (draft && !(await confirmDiscard())) return
    openDraft(type, false)
    setSelectedTypeId(type.id)
  }

  const cancelEditing = async () => {
    if (!(await confirmDiscard())) return
    setDraft(null)
  }

  const updateDraftType = (updater: (type: ServiceType) => ServiceType) => {
    setDraft((current) => (current ? { ...current, type: updater(current.type) } : current))
  }

  const updateField = (fieldId: string, updater: (field: ServiceField, others: ServiceField[]) => ServiceField) => {
    updateDraftType((type) => ({
      ...type,
      fields: type.fields.map((field) =>
        field.id === fieldId ? updater(field, type.fields.filter((f) => f.id !== fieldId)) : field,
      ),
    }))
  }

  const handleNameChange = (name: string) => {
    updateDraftType((type) => ({
      ...type,
      name,
      id: draft?.isNew && !idTouched ? generateTypeId(name, serviceTypes.map((st) => st.id)) : type.id,
    }))
  }

  const handleIdChange = (id: string) => {
    setIdTouched(true)
    updateDraftType((type) => ({ ...type, id: id.toLowerCase() }))
  }

  const addField = () => {
    updateDraftType((type) => {
      const key = generateFieldKey("", type.fields.map((f) => f.key))
      const field: ServiceField = { id: crypto.randomUUID(), key, label: "", type: "text", masked: false, required: false }
      return { ...type, fields: [...type.fields, field] }
    })
  }

  const handleLabelChange = (fieldId: string, label: string) => {
    // Only new fields follow their label; the key of a saved field is its stored-data identity.
    const followLabel = !persistedKeyById.has(fieldId) && !touchedKeys.has(fieldId)
    updateField(fieldId, (field, others) => ({
      ...field,
      label,
      key: followLabel ? generateFieldKey(label, others.map((f) => f.key)) : field.key,
    }))
  }

  const handleKeyChange = (fieldId: string, key: string) => {
    setTouchedKeys((current) => new Set(current).add(fieldId))
    updateField(fieldId, (field) => ({ ...field, key: key.toLowerCase() }))
  }

  const handleTypeChange = (fieldId: string, type: FieldType) => {
    updateField(fieldId, (field) => ({
      ...field,
      type,
      masked: type === "2fa" ? true : field.masked,
      linkedServiceTypeId: type === "linked_service" ? field.linkedServiceTypeId : undefined,
    }))
  }

  const moveField = (index: number, delta: -1 | 1) => {
    updateDraftType((type) => {
      const target = index + delta
      if (target < 0 || target >= type.fields.length) return type
      const fields = [...type.fields]
      ;[fields[index], fields[target]] = [fields[target], fields[index]]
      return { ...type, fields }
    })
  }

  const removeField = async (field: ServiceField) => {
    if (!draft) return
    const storedKey = persistedKeyById.get(field.id)
    if (storedKey !== undefined) {
      const withValues = services.filter(
        (s) => s.serviceTypeId === draft.type.id && (s.data[storedKey] ?? "") !== "",
      ).length
      if (withValues > 0) {
        const ok = await askConfirm(
          t("service_type_constructor.remove_field_confirm.message", {
            count: withValues,
            field: field.label || storedKey,
          }),
          t("service_type_constructor.remove_field_confirm.title"),
        )
        if (!ok) return
      }
    }
    updateDraftType((type) => ({ ...type, fields: type.fields.filter((f) => f.id !== field.id) }))
  }

  const handleSave = async () => {
    if (!draft || busyRef.current) return
    setShowErrors(true)
    const current = validateDraft(draft, serviceTypes, t)
    if (current.count > 0) {
      if (Object.values(current.fields).some((e) => e.key)) setShowKeys(true)
      toast.error(t("service_type_constructor.errors.fix_highlighted"))
      return
    }
    const payload = toPayload(draft.type)
    if (!draft.isNew) {
      const stored = serviceTypes.find((st) => st.id === payload.id)
      const losses = fieldValueLosses(stored, payload, services)
      if (losses.length > 0) {
        const lines = losses.map((loss) =>
          loss.reason === "link"
            ? t("service_type_constructor.save_loss_confirm.link", {
                count: loss.count,
                field: loss.field.label,
                target: typeName(loss.field.linkedServiceTypeId),
              })
            : t("service_type_constructor.save_loss_confirm.reused_key", {
                count: loss.count,
                field: loss.field.label,
                key: loss.storedKey,
              }),
        )
        const message = [
          t("service_type_constructor.save_loss_confirm.intro"),
          ...lines.map((line) => `• ${line}`),
          t("service_type_constructor.save_loss_confirm.question"),
        ].join("\n\n")
        if (!(await askConfirm(message, t("service_type_constructor.save_loss_confirm.title")))) return
      }
    }
    busyRef.current = true
    setIsSaving(true)
    try {
      if (draft.isNew) await addServiceType(payload)
      else await updateServiceType(payload)
      setDraft(null)
      setShowErrors(false)
      setSelectedTypeId(payload.id)
    } catch {
      // The API layer already showed the error; keep the draft so nothing is lost.
    } finally {
      busyRef.current = false
      setIsSaving(false)
    }
  }

  const handleDelete = async (type: ServiceType) => {
    if (busyRef.current) return
    const count = serviceCountByType.get(type.id) ?? 0
    const linkedRefs = serviceTypes
      .filter((st) => st.id !== type.id)
      .flatMap((st) =>
        st.fields
          .filter((f) => f.type === "linked_service" && f.linkedServiceTypeId === type.id)
          .map((f) => `${st.name} › ${f.label}`),
      )
    const parts = [t("service_type_constructor.delete_confirm.message_named", { name: type.name })]
    if (count > 0) parts.push(t("service_type_constructor.delete_confirm.services", { count }))
    if (linkedRefs.length > 0) {
      parts.push(
        t("service_type_constructor.delete_confirm.linked_fields", {
          count: linkedRefs.length,
          fields: linkedRefs.join(", "),
        }),
      )
    }
    parts.push(t("service_type_constructor.delete_confirm.irreversible"))
    if (!(await askConfirm(parts.join("\n\n"), t("service_type_constructor.delete_confirm.title")))) return

    busyRef.current = true
    setIsDeleting(true)
    try {
      // Services of the type are deleted with it (the user confirmed the count above).
      await deleteServiceType(type.id, count > 0)
      setSelectedTypeId((current) => (current === type.id ? "" : current))
    } catch {
      // Error toast comes from the API layer.
    } finally {
      busyRef.current = false
      setIsDeleting(false)
    }
  }

  const typeName = (id: string | undefined) =>
    serviceTypes.find((st) => st.id === id)?.name ??
    (draft && id === draft.type.id ? draft.type.name : t("service_type_constructor.unknown_type"))

  const errorText = (message: string | undefined) =>
    message ? <p className="text-xs text-red-400">{message}</p> : null

  return (
    <div className="p-6">
      <div className="flex gap-6 h-[calc(100vh-8rem)]">
        {/* Left Panel */}
        <Card className="w-80 bg-gray-800 border-gray-700 flex flex-col overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">{t("service_type_constructor.list_title")}</CardTitle>
              <Button
                size="sm"
                onClick={() => void startCreating()}
                className={PRIMARY_BUTTON}
                aria-label={t("service_type_constructor.create_button")}
                disabled={busy}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 overflow-y-auto">
            {serviceTypes.map((type) => {
              const active = draft ? !draft.isNew && draft.type.id === type.id : selectedTypeId === type.id
              const usedBy = serviceCountByType.get(type.id) ?? 0
              return (
                <div
                  key={type.id}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    active ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                  onClick={() => void selectType(type.id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">{type.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation()
                        void startEditing(type)
                      }}
                      className="text-gray-400 hover:text-white"
                      aria-label={t("common.edit")}
                      disabled={busy}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="text-sm opacity-75 mt-1">
                    {t("service_type_constructor.fields_count", { count: type.fields.length })}
                    {" · "}
                    {t("service_type_constructor.services_count", { count: usedBy })}
                  </div>
                </div>
              )
            })}
            {serviceTypes.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">{t("service_type_constructor.no_types")}</p>
                <Button size="sm" onClick={() => void startCreating()} className={`mt-2 ${PRIMARY_BUTTON}`}>
                  {t("service_type_constructor.create_first")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Panel */}
        <Card className="flex-1 bg-gray-800 border-gray-700 flex flex-col overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">
                {draft
                  ? draft.isNew
                    ? t("service_type_constructor.creating_title")
                    : t("service_type_constructor.editing_title")
                  : t("service_type_constructor.main_title")}
                {isDirty && (
                  <span className="ml-3 text-xs font-normal text-amber-300">
                    {t("service_type_constructor.unsaved_changes")}
                  </span>
                )}
              </CardTitle>
              {draft && (
                <div className="flex gap-2">
                  <Button
                    className="bg-gray-700 border-gray-600 text-gray-300"
                    onClick={() => void cancelEditing()}
                    disabled={isSaving}
                    aria-label={t("common.cancel")}
                    title={t("common.cancel")}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={() => void handleSave()}
                    className={PRIMARY_BUTTON}
                    disabled={isSaving}
                    aria-label={t("common.save")}
                    title={t("common.save")}
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6 overflow-y-auto">
            {draft ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="typeName" className="text-gray-300">
                      {t("service_type_constructor.form.type_name")}
                    </Label>
                    <Input
                      id="typeName"
                      value={draft.type.name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder={t("service_type_constructor.form.type_name_placeholder")}
                      className="bg-gray-700 border-gray-600 text-white"
                      aria-invalid={!!visibleErrors?.name}
                    />
                    {errorText(visibleErrors?.name)}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="typeId" className="text-gray-300">
                      {t("service_type_constructor.form.system_name")}
                    </Label>
                    <Input
                      id="typeId"
                      value={draft.type.id}
                      onChange={(e) => handleIdChange(e.target.value)}
                      placeholder={t("service_type_constructor.form.system_name_placeholder")}
                      className="bg-gray-700 border-gray-600 text-white font-mono"
                      readOnly={!draft.isNew}
                      aria-invalid={!!visibleErrors?.id}
                    />
                    <p className="text-xs text-gray-400">
                      {draft.isNew
                        ? t("service_type_constructor.form.system_name_hint_new")
                        : t("service_type_constructor.form.system_name_hint_existing")}
                    </p>
                    {errorText(visibleErrors?.id)}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label className="text-gray-300 text-lg">{t("service_type_constructor.form.fields_title")}</Label>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Switch id="show-keys" checked={showKeys} onCheckedChange={setShowKeys} />
                        <Label htmlFor="show-keys" className="text-gray-300 text-sm">
                          {t("service_type_constructor.form.show_keys")}
                        </Label>
                      </div>
                      <Button
                        onClick={addField}
                        size="sm"
                        className={PRIMARY_BUTTON}
                        aria-label={t("service_type_constructor.form.add_field")}
                        title={t("service_type_constructor.form.add_field")}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  {showKeys && <p className="text-xs text-gray-400">{t("service_type_constructor.form.keys_hint")}</p>}

                  <div className="space-y-3">
                    {draft.type.fields.map((field, index) => {
                      const fieldErrors = visibleErrors?.fields[field.id]
                      const isPersisted = persistedKeyById.has(field.id)
                      return (
                        <Card key={field.id} className="bg-gray-700 border-gray-600">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-4">
                              <div className="flex flex-col gap-1 mt-6">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-gray-400 hover:text-white"
                                  onClick={() => moveField(index, -1)}
                                  disabled={index === 0}
                                  aria-label={t("service_type_constructor.form.move_up")}
                                  title={t("service_type_constructor.form.move_up")}
                                >
                                  <ChevronUp className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-gray-400 hover:text-white"
                                  onClick={() => moveField(index, 1)}
                                  disabled={index === draft.type.fields.length - 1}
                                  aria-label={t("service_type_constructor.form.move_down")}
                                  title={t("service_type_constructor.form.move_down")}
                                >
                                  <ChevronDown className="w-4 h-4" />
                                </Button>
                              </div>
                              <div className="flex-1 grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label className="text-gray-300 text-sm">
                                    {t("service_type_constructor.form.field_name")}
                                  </Label>
                                  <Input
                                    value={field.label}
                                    onChange={(e) => handleLabelChange(field.id, e.target.value)}
                                    placeholder={t("service_type_constructor.form.field_name_placeholder")}
                                    className="bg-gray-600 border-gray-500 text-white"
                                    aria-invalid={!!fieldErrors?.label}
                                  />
                                  {errorText(fieldErrors?.label)}
                                  {!showKeys && (
                                    <p className="text-xs text-gray-400 font-mono truncate">
                                      {t("service_type_constructor.form.key_display", { key: field.key })}
                                    </p>
                                  )}
                                  {!showKeys && errorText(fieldErrors?.key)}
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-gray-300 text-sm">{t("service_type_constructor.form.type")}</Label>
                                  <Select
                                    value={field.type}
                                    onValueChange={(value) => handleTypeChange(field.id, value as FieldType)}
                                  >
                                    <SelectTrigger className="bg-gray-600 border-gray-500 text-white">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-gray-600 border-gray-500">
                                      {FIELD_TYPES.map((type) => (
                                        <SelectItem key={type} value={type}>
                                          {fieldTypeLabel(t, type)}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {showKeys && (
                                  <div className="space-y-2 col-span-2">
                                    <Label className="text-gray-300 text-sm">{t("service_type_constructor.form.key")}</Label>
                                    <Input
                                      value={field.key}
                                      onChange={(e) => handleKeyChange(field.id, e.target.value)}
                                      placeholder={t("service_type_constructor.form.key_placeholder")}
                                      className="bg-gray-600 border-gray-500 text-white font-mono"
                                      aria-invalid={!!fieldErrors?.key}
                                    />
                                    {isPersisted && persistedKeyById.get(field.id) !== field.key && (
                                      <p className="text-xs text-amber-300">
                                        {t("service_type_constructor.form.key_renamed_hint", {
                                          from: persistedKeyById.get(field.id),
                                        })}
                                      </p>
                                    )}
                                    {errorText(fieldErrors?.key)}
                                  </div>
                                )}
                                {field.type === "linked_service" && (
                                  <div className="space-y-2 col-span-2">
                                    <Label className="text-gray-300 text-sm">
                                      {t("service_type_constructor.form.linked_service_type")}
                                    </Label>
                                    <Select
                                      value={field.linkedServiceTypeId || undefined}
                                      onValueChange={(value) =>
                                        updateField(field.id, (f) => ({ ...f, linkedServiceTypeId: value }))
                                      }
                                    >
                                      <SelectTrigger className="bg-gray-600 border-gray-500 text-white">
                                        <SelectValue placeholder={t("service_type_constructor.form.select_type_placeholder")} />
                                      </SelectTrigger>
                                      <SelectContent className="bg-gray-600 border-gray-500">
                                        {serviceTypes.map((st) => (
                                          <SelectItem key={st.id} value={st.id}>
                                            {st.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {errorText(fieldErrors?.linked)}
                                  </div>
                                )}
                                <div className="space-y-3 col-span-2 grid grid-cols-2">
                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      id={`required-${field.id}`}
                                      checked={field.required}
                                      onCheckedChange={(checked) =>
                                        updateField(field.id, (f) => ({ ...f, required: checked === true }))
                                      }
                                    />
                                    <Label htmlFor={`required-${field.id}`} className="text-gray-300 text-sm">
                                      {t("service_type_constructor.form.required")}
                                    </Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      id={`masked-${field.id}`}
                                      checked={field.type === "2fa" || field.masked}
                                      disabled={field.type === "2fa"}
                                      onCheckedChange={(checked) =>
                                        updateField(field.id, (f) => ({ ...f, masked: checked === true }))
                                      }
                                    />
                                    <Label
                                      htmlFor={`masked-${field.id}`}
                                      className="text-gray-300 text-sm"
                                      title={field.type === "2fa" ? t("service_type_constructor.form.masked_2fa_hint") : undefined}
                                    >
                                      {t("service_type_constructor.form.masked")}
                                    </Label>
                                  </div>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void removeField(field)}
                                className="text-gray-400 hover:text-red-400 mt-6"
                                aria-label={t("service_type_constructor.form.remove_field")}
                                title={t("service_type_constructor.form.remove_field")}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                    {draft.type.fields.length === 0 && (
                      <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-600 rounded-lg">
                        <p>{t("service_type_constructor.form.no_fields")}</p>
                        <p className="text-sm">{t("service_type_constructor.form.no_fields_description")}</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : selectedType ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-white">{selectedType.name}</h2>
                    <p className="text-gray-400">{t("service_type_constructor.id_label", { id: selectedType.id })}</p>
                    <p className="text-sm text-gray-400">
                      {t("service_type_constructor.used_by", { count: serviceCountByType.get(selectedType.id) ?? 0 })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => void startEditing(selectedType)} className={PRIMARY_BUTTON} disabled={busy}>
                      {t("common.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleDelete(selectedType)}
                      className="text-gray-400 hover:text-red-500 hover:bg-red-500/10"
                      disabled={busy}
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
                    >
                      {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-lg font-medium text-white">
                    {t("service_type_constructor.form.fields_title")} ({selectedType.fields.length})
                  </h3>
                  {selectedType.fields.map((field) => (
                    <Card key={field.id} className="bg-gray-700 border-gray-600">
                      <CardContent className="p-4">
                        <div>
                          <h4 className="font-medium text-white">{field.label}</h4>
                          <p className="text-sm text-gray-400">
                            <span className="font-mono">{field.key}</span>
                            {" • "}
                            {fieldTypeLabel(t, field.type)}
                            {field.type === "linked_service" && ` → ${typeName(field.linkedServiceTypeId)}`}
                            {field.required && ` • ${t("service_type_constructor.form.required").toLowerCase()}`}
                            {(field.masked || field.type === "2fa") &&
                              ` • ${t("service_type_constructor.form.masked").toLowerCase()}`}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <div className="w-16 h-16 bg-gray-700 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Plus className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-medium mb-2">{t("service_type_constructor.main_title")}</h3>
                <p className="text-sm mb-4">{t("service_type_constructor.welcome_description")}</p>
                <Button onClick={() => void startCreating()} className={PRIMARY_BUTTON}>
                  {t("service_type_constructor.create_button")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
