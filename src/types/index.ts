// Mirrors the backend models (src-tauri/src/models.rs) and command payloads.
// JSON is camelCase. Timestamps are Unix milliseconds set by the backend (0 = unknown).

export type FieldType = "text" | "secret" | "textarea" | "url" | "linked_service" | "2fa"

export interface ServiceField {
  id: string
  key: string
  label: string
  type: FieldType
  masked: boolean
  required: boolean
  /** Omitted by the backend when not set. */
  linkedServiceTypeId?: string
}

export interface ServiceType {
  id: string
  name: string
  icon: string
  fields: ServiceField[]
}

export interface Service {
  id: string
  serviceTypeId: string
  label: string
  data: Record<string, string>
  tags: string[]
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface Account {
  id: string
  label: string
  notes: string
  tags: string[]
  linkedServices: string[]
  pinned: boolean
  createdAt: number
  updatedAt: number
}

/** Backend-managed fields of Service/Account. The backend sets the timestamps and ignores client values. */
type ManagedFields = "pinned" | "createdAt" | "updatedAt"

/** A service as sent by the client (add/update). Missing managed fields are filled in by the store/backend. */
export type ServiceInput = Omit<Service, ManagedFields> & Partial<Pick<Service, ManagedFields>>

/** An account as sent by the client (add/update). Missing managed fields are filled in by the store/backend. */
export type AccountInput = Omit<Account, ManagedFields> & Partial<Pick<Account, ManagedFields>>

export interface Settings {
  /** 0 disables auto-lock. Default 15. */
  autoLockMinutes: number
  /** 0 = never clear. Default 30. */
  clipboardClearSeconds: number
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 15,
  clipboardClearSeconds: 30,
}

export interface Vault {
  version: string
  serviceTypes: ServiceType[]
  services: Service[]
  accounts: Account[]
  settings: Settings
}

// Vault management

export type MergeStrategy = "merge" | "replace"

export interface ImportSummary {
  serviceTypesAdded: number
  serviceTypesMerged: number
  servicesAdded: number
  servicesSkipped: number
  accountsAdded: number
  accountsSkipped: number
}

export interface ImportResult {
  vault: Vault
  summary: ImportSummary
}

export interface BackupInfo {
  fileName: string
  /** Unix milliseconds */
  createdAt: number
  sizeBytes: number
}

export type PinKind = "account" | "service"

// Bulk create

export interface BulkAccountConfig {
  count: number
  nameTemplate: string
  startNumber: number
  tags: string[]
  notes: string
}

export interface ServiceLinkConfig {
  serviceTypeId: string
  nameTemplate: string
}

export interface BulkCreateRequest {
  accountConfig: BulkAccountConfig
  linkServices: boolean
  serviceConfigs: ServiceLinkConfig[]
}

export interface BulkCreateSummary {
  created: number
  linked: number
  unmatched: number
}

export interface BulkCreateResult {
  vault: Vault
  summary: BulkCreateSummary
}

// Email

export interface EmailMessage {
  /** IMAP UID */
  id: string
  subject: string
  from: string
  date: string
  /** Unix milliseconds, 0 = unknown */
  timestamp: number
  bodyPreview: string
  bodyContent: string
  bodyHtml?: string | null
  hasVerificationCode: boolean
  verificationCodes: string[]
}

export interface EmailConnection {
  email: string
  providerName: string
  isConnected: boolean
  lastError?: string | null
  /** One of the EMAIL_* error codes when `isConnected` is false. */
  lastErrorCode?: string | null
}

export interface EmailFetchResult {
  messages: EmailMessage[]
  totalCount: number
  hasMore: boolean
}

// Errors

/** Error codes of the backend `CommandError` ({ code, message }). */
export const ERROR_CODES = [
  "VAULT_LOCKED",
  "VAULT_EXISTS",
  "VAULT_NOT_FOUND",
  "VAULT_CORRUPTED",
  "UNSUPPORTED_VAULT_VERSION",
  "INVALID_PASSWORD",
  "PASSWORD_TOO_SHORT",
  "SERVICE_TYPE_EXISTS",
  "SERVICE_TYPE_NOT_FOUND",
  "SERVICE_TYPE_IN_USE",
  "SERVICE_NOT_FOUND",
  "ACCOUNT_NOT_FOUND",
  "DUPLICATE_ID",
  "VALIDATION",
  "BACKUP_NOT_FOUND",
  "IO",
  "INTERNAL",
  "EMAIL_UNSUPPORTED_PROVIDER",
  "EMAIL_CONNECTION",
  "EMAIL_AUTH",
  "EMAIL_TIMEOUT",
  "EMAIL_PROTOCOL",
] as const

export type BackendErrorCode = (typeof ERROR_CODES)[number]

/** `UNKNOWN` is used by the frontend for errors that carry no recognised code. */
export type ErrorCode = BackendErrorCode | "UNKNOWN"

export interface CommandErrorPayload {
  code: string
  message: string
}
