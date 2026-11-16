// Pure helpers for service-field keys and for what a change of a type's fields does to stored
// values. No React and no "@/" runtime imports.
import type { Service, ServiceField, ServiceType } from "@/types"

/** What the backend accepts for `ServiceField.key`. */
export const FIELD_KEY_PATTERN = /^[a-z0-9_]+$/

export const MAX_FIELD_KEY_LENGTH = 48

// Ukrainian national transliteration (2010), plus the Russian/Belarusian letters it lacks.
const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y",
  і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
  т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu",
  я: "ia", ё: "e", ы: "y", э: "e", ъ: "", ў: "u",
}

// Forms used at the start of a word (Євген → yevhen, Юрій → yurii).
const CYRILLIC_WORD_INITIAL: Record<string, string> = { є: "ye", ї: "yi", й: "y", ю: "yu", я: "ya" }

/** True if `key` is a syntactically valid field key. */
export function isValidFieldKey(key: string): boolean {
  return FIELD_KEY_PATTERN.test(key)
}

function transliterate(text: string): string {
  const chars = [...text.toLowerCase()]
  let out = ""
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const prev = i > 0 ? chars[i - 1] : ""
    const wordStart = !/[\p{L}'’ʼ]/u.test(prev)
    if (wordStart && ch in CYRILLIC_WORD_INITIAL) {
      out += CYRILLIC_WORD_INITIAL[ch]
    } else if (ch === "г" && prev === "з") {
      // "зг" is "zgh" so it is not read as "ж" (zh).
      out += "gh"
    } else {
      out += ch in CYRILLIC ? CYRILLIC[ch] : ch
    }
  }
  return out
}

/**
 * Turns a label into a key candidate: Cyrillic is transliterated, Latin diacritics are dropped,
 * every other run of characters becomes "_". May return "" when nothing usable is left.
 */
export function slugifyFieldKey(label: string): string {
  return transliterate(label ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’ʼ`"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_FIELD_KEY_LENGTH)
    .replace(/_+$/g, "")
}

/**
 * A unique key for a field with this label. Falls back to `field_N` when the label has nothing
 * usable; appends `_2`, `_3`, ... on collisions. The result always matches FIELD_KEY_PATTERN.
 */
export function generateFieldKey(label: string, existingKeys: Iterable<string> = []): string {
  const taken = new Set(existingKeys)
  const base = slugifyFieldKey(label)

  if (!base) {
    let n = 1
    while (taken.has(`field_${n}`)) n++
    return `field_${n}`
  }
  if (!taken.has(base)) return base

  let n = 2
  for (;;) {
    const suffix = `_${n}`
    const candidate = base.slice(0, MAX_FIELD_KEY_LENGTH - suffix.length).replace(/_+$/g, "") + suffix
    if (!taken.has(candidate)) return candidate
    n++
  }
}

// ---------------------------------------------------------------------------------------------
// Stored values that saving a changed service type deletes (mirrors vault_ops::update_service_type)

export interface FieldValueLoss {
  /** The field in the edited type. */
  field: ServiceField
  /**
   * "link": the saved field became a linked field or got another target; values that are not ids
   * of services of the target type are cleared.
   * "reused_key": a new field reuses the key of a removed field; the removed field's values are
   * deleted, not moved to the new field.
   */
  reason: "link" | "reused_key"
  /** Key the values are stored under now. */
  storedKey: string
  /** Services of the type whose value is deleted. */
  count: number
}

type ServiceData = Pick<Service, "id" | "serviceTypeId" | "data">

/**
 * Stored values that saving `edited` over `stored` deletes, besides the values of removed fields
 * (those are confirmed when the field is removed). The backend keeps a value by field id; it
 * clears a value of a field that becomes linked (or changes its target, including to the type
 * itself) unless it is the id of a service of the target type, and a new field id never takes over
 * the values of a removed field that had the same key.
 */
export function fieldValueLosses(
  stored: Pick<ServiceType, "id" | "fields"> | undefined,
  edited: Pick<ServiceType, "id" | "fields">,
  services: readonly ServiceData[],
): FieldValueLoss[] {
  if (!stored) return []
  const ownServices = services.filter((s) => s.serviceTypeId === stored.id)
  const hasValue = (value: string | undefined): value is string => typeof value === "string" && value !== ""
  const storedById = new Map(stored.fields.map((f) => [f.id, f] as const))
  const editedIds = new Set(edited.fields.map((f) => f.id))
  const losses: FieldValueLoss[] = []

  for (const field of edited.fields) {
    const before = storedById.get(field.id)
    if (before) {
      const target = field.type === "linked_service" ? (field.linkedServiceTypeId ?? "").trim() : ""
      const linkChanged =
        target !== "" && (before.type !== "linked_service" || (before.linkedServiceTypeId ?? "").trim() !== target)
      if (!linkChanged) continue
      const validIds = new Set(services.filter((s) => s.serviceTypeId === target).map((s) => s.id))
      const count = ownServices.filter((s) => {
        const value = s.data[before.key]
        return hasValue(value) && !validIds.has(value)
      }).length
      if (count > 0) losses.push({ field, reason: "link", storedKey: before.key, count })
      continue
    }
    const removed = stored.fields.find((f) => f.key === field.key && !editedIds.has(f.id))
    if (!removed) continue
    const count = ownServices.filter((s) => hasValue(s.data[removed.key])).length
    if (count > 0) losses.push({ field, reason: "reused_key", storedKey: removed.key, count })
  }
  return losses
}
