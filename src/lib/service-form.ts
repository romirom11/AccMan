// Pure logic of the create/edit service form: validation, type switching and building the payload.
// Only type imports from "@/", so it also runs under `node --test`.
import type { Service, ServiceField, ServiceInput, ServiceType } from "@/types"

/** A service created inline from a `linked_service` field of the form ("Create new"). */
export interface InlineServiceDraft {
  /** Generated once when the inline form opens, so a retried save never creates a second copy. */
  id: string
  label: string
  data: Record<string, string>
  tags: string
}

export type FormErrors = Record<string, "required">

export const formErrorKey = {
  label: "label",
  type: "type",
  field: (fieldKey: string) => `field:${fieldKey}`,
  inlineLabel: (parentKey: string) => `inline:${parentKey}:label`,
  inlineField: (parentKey: string, fieldKey: string) => `inline:${parentKey}:field:${fieldKey}`,
} as const

export function isBlank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === ""
}

/** "a, b ,, a" -> ["a", "b"] */
export function parseTags(text: string): string[] {
  const tags: string[] = []
  for (const raw of text.split(",")) {
    const tag = raw.trim()
    if (tag && !tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/** Drops keys whose value is empty or whitespace only. */
export function compactData(data: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && !isBlank(value)) result[key] = value
  }
  return result
}

/** Keys holding a non-empty value that the target type has no field for (they would be dropped). */
export function lostKeysOnTypeChange(data: Record<string, string>, toType: Pick<ServiceType, "fields"> | undefined): string[] {
  const keys = new Set(toType?.fields.map((field) => field.key) ?? [])
  return Object.keys(data).filter((key) => !keys.has(key) && !isBlank(data[key]))
}

/** Only the data keys the type declares. */
export function retainTypeKeys(data: Record<string, string>, type: Pick<ServiceType, "fields"> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!type) return result
  for (const field of type.fields) {
    if (field.key in data) result[field.key] = data[field.key]
  }
  return result
}

export interface ServiceFormState {
  label: string
  typeId: string
  data: Record<string, string>
  /** Inline drafts by the parent field key. */
  inline: Record<string, InlineServiceDraft>
}

export interface ServiceFormValidation {
  /** Problems that block saving. */
  errors: FormErrors
  /** Required fields that are empty but do not block saving (see checkServiceForm). */
  warnings: FormErrors
}

export interface ServiceFormCheckOptions {
  /**
   * The stored service when an existing service is edited. While the form keeps the stored type, a
   * required field that was already empty (or held a link to a missing service) before the edit is
   * only a warning, so an incomplete service (e.g. from the bulk import) can still be renamed or
   * tagged. Emptying a required field in this edit still blocks, and after switching to another
   * type every required field of the new type blocks (its keys are naturally absent from the
   * stored data).
   */
  previous?: Pick<Service, "serviceTypeId" | "data">
}

/**
 * Required checks for the main form and every inline draft. A required `linked_service` field is
 * satisfied by an existing service or by an inline draft. Inline drafts are new services, so their
 * required fields always block.
 */
export function checkServiceForm(
  form: ServiceFormState,
  serviceTypes: readonly ServiceType[],
  serviceExists: (id: string) => boolean,
  options: ServiceFormCheckOptions = {},
): ServiceFormValidation {
  const errors: FormErrors = {}
  const warnings: FormErrors = {}
  if (isBlank(form.label)) errors[formErrorKey.label] = "required"
  const type = serviceTypes.find((t) => t.id === form.typeId)
  if (!type) {
    errors[formErrorKey.type] = "required"
    return { errors, warnings }
  }

  // The "already empty before this edit" relaxation only holds for the stored type.
  const previousData = options.previous?.serviceTypeId === type.id ? options.previous.data : undefined

  const isMissing = (field: ServiceField, value: string | undefined) =>
    field.type === "linked_service" ? isBlank(value) || !serviceExists(value as string) : isBlank(value)

  for (const field of type.fields) {
    const draft = field.type === "linked_service" ? form.inline[field.key] : undefined
    if (draft) {
      if (isBlank(draft.label)) errors[formErrorKey.inlineLabel(field.key)] = "required"
      const targetType = serviceTypes.find((t) => t.id === field.linkedServiceTypeId)
      for (const nested of targetType?.fields ?? []) {
        if (nested.required && isMissing(nested, draft.data[nested.key])) {
          errors[formErrorKey.inlineField(field.key, nested.key)] = "required"
        }
      }
      continue
    }
    if (!field.required || !isMissing(field, form.data[field.key])) continue
    const key = formErrorKey.field(field.key)
    if (previousData && isMissing(field, previousData[field.key])) warnings[key] = "required"
    else errors[key] = "required"
  }
  return { errors, warnings }
}

/** The blocking problems of checkServiceForm. Returns an empty object when the form can be saved. */
export function validateServiceForm(
  form: ServiceFormState,
  serviceTypes: readonly ServiceType[],
  serviceExists: (id: string) => boolean,
  options: ServiceFormCheckOptions = {},
): FormErrors {
  return checkServiceForm(form, serviceTypes, serviceExists, options).errors
}

export interface ServicePayload {
  main: ServiceInput
  /** Services to create from inline drafts, in field order. */
  linked: ServiceInput[]
}

/**
 * Builds the main service and the inline-created linked services. Inline drafts replace whatever
 * the field held; drafts for fields the type does not have are ignored. Empty values are dropped.
 */
export function buildServicePayload(
  mainId: string,
  form: ServiceFormState & { tags: string },
  serviceTypes: readonly ServiceType[],
): ServicePayload {
  const type = serviceTypes.find((t) => t.id === form.typeId)
  const data = { ...form.data }
  const linked: ServiceInput[] = []
  for (const field of type?.fields ?? []) {
    if (field.type !== "linked_service" || !field.linkedServiceTypeId) continue
    const draft = form.inline[field.key]
    if (!draft) continue
    const targetType = serviceTypes.find((t) => t.id === field.linkedServiceTypeId)
    linked.push({
      id: draft.id,
      label: draft.label.trim(),
      serviceTypeId: field.linkedServiceTypeId,
      data: compactData(retainTypeKeys(draft.data, targetType)),
      tags: parseTags(draft.tags),
    })
    data[field.key] = draft.id
  }
  return {
    main: {
      id: mainId,
      label: form.label.trim(),
      serviceTypeId: form.typeId,
      data: compactData(data),
      tags: parseTags(form.tags),
    },
    linked,
  }
}

/** True when saving `next` would change the stored service (label, type, tags or data). */
export function serviceDiffers(stored: Service, next: ServiceInput): boolean {
  if (stored.label !== next.label || stored.serviceTypeId !== next.serviceTypeId) return true
  if (stored.tags.length !== next.tags.length || stored.tags.some((tag, i) => tag !== next.tags[i])) return true
  const storedKeys = Object.keys(stored.data).filter((key) => !isBlank(stored.data[key]))
  const nextKeys = Object.keys(next.data)
  if (storedKeys.length !== nextKeys.length) return true
  return nextKeys.some((key) => stored.data[key] !== next.data[key])
}
