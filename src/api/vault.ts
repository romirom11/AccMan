import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import type {
  AccountInput,
  BackupInfo,
  BulkCreateRequest,
  BulkCreateResult,
  EmailConnection,
  EmailFetchResult,
  ImportResult,
  MergeStrategy,
  PinKind,
  ServiceInput,
  ServiceType,
  Settings,
  Vault,
} from "@/types"
import { getErrorMessage, toApiError } from "@/lib/errors"

export interface CallOptions {
  /** Do not show the error toast (the caller displays the error itself). */
  silent?: boolean
}

/**
 * Invokes a Tauri command. On failure it converts the rejection into an `ApiError`,
 * shows ONE localised error toast (unless `silent`) and rethrows the ApiError.
 * Success toasts are the store's job, not this layer's.
 */
export async function callApi<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: CallOptions,
): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    const apiError = toApiError(error, command)
    console.error(`API error in '${command}': [${apiError.code}] ${apiError.message}`)
    if (!options?.silent) {
      toast.error(getErrorMessage(apiError))
    }
    throw apiError
  }
}

export const vaultApi = {
  // Vault lifecycle
  vaultExists: (opts?: CallOptions) => callApi<boolean>("vault_exists", undefined, opts),

  getDefaultServiceTypesList: (opts?: CallOptions) =>
    callApi<ServiceType[]>("get_default_service_types_list", undefined, opts),

  createVault: (password: string, settings: Settings, selectedServiceTypeIds: string[], opts?: CallOptions) =>
    callApi<Vault>("create_vault", { password, settings, selectedServiceTypeIds }, opts),

  unlockVault: (password: string, opts?: CallOptions) => callApi<Vault>("unlock_vault", { password }, opts),

  /** Idempotent: succeeds when already locked. */
  lockVault: (opts?: CallOptions) => callApi<void>("lock_vault", undefined, opts),

  getVault: (opts?: CallOptions) => callApi<Vault>("get_vault", undefined, opts),

  // Settings & password
  updateSettings: (settings: Settings, opts?: CallOptions) => callApi<Vault>("update_settings", { settings }, opts),

  changePassword: (oldPassword: string, newPassword: string, opts?: CallOptions) =>
    callApi<void>("change_master_password", { oldPassword, newPassword }, opts),

  // Export / import / backups
  exportVault: (exportPath: string, password: string, opts?: CallOptions) =>
    callApi<void>("export_vault", { exportPath, password }, opts),

  importVault: (importPath: string, password: string, mergeStrategy: MergeStrategy, opts?: CallOptions) =>
    callApi<ImportResult>("import_vault", { importPath, password, mergeStrategy }, opts),

  /** Newest first. Works while locked. */
  listBackups: (opts?: CallOptions) => callApi<BackupInfo[]>("list_backups", undefined, opts),

  /** Works locked or unlocked; leaves the session unlocked with the restored vault. */
  restoreBackup: (fileName: string, password: string, opts?: CallOptions) =>
    callApi<Vault>("restore_backup", { fileName, password }, opts),

  // Service types
  addServiceType: (serviceType: ServiceType, opts?: CallOptions) =>
    callApi<Vault>("add_service_type", { serviceType }, opts),

  updateServiceType: (serviceType: ServiceType, opts?: CallOptions) =>
    callApi<Vault>("update_service_type", { serviceType }, opts),

  deleteServiceType: (serviceTypeId: string, cascade: boolean, opts?: CallOptions) =>
    callApi<Vault>("delete_service_type", { serviceTypeId, cascade }, opts),

  // Services
  addService: (service: ServiceInput, accountId?: string, opts?: CallOptions) =>
    callApi<Vault>("add_service", accountId ? { service, accountId } : { service }, opts),

  addServices: (services: ServiceInput[], opts?: CallOptions) => callApi<Vault>("add_services", { services }, opts),

  updateService: (service: ServiceInput, opts?: CallOptions) => callApi<Vault>("update_service", { service }, opts),

  deleteService: (serviceId: string, opts?: CallOptions) => callApi<Vault>("delete_service", { serviceId }, opts),

  deleteServices: (serviceIds: string[], opts?: CallOptions) =>
    callApi<Vault>("delete_services", { serviceIds }, opts),

  // Accounts
  addAccount: (account: AccountInput, opts?: CallOptions) => callApi<Vault>("add_account", { account }, opts),

  updateAccount: (account: AccountInput, opts?: CallOptions) => callApi<Vault>("update_account", { account }, opts),

  deleteAccount: (accountId: string, opts?: CallOptions) => callApi<Vault>("delete_account", { accountId }, opts),

  deleteAccounts: (accountIds: string[], opts?: CallOptions) =>
    callApi<Vault>("delete_accounts", { accountIds }, opts),

  linkServicesToAccount: (accountId: string, serviceIds: string[], opts?: CallOptions) =>
    callApi<Vault>("link_services_to_account", { accountId, serviceIds }, opts),

  unlinkServicesFromAccount: (accountId: string, serviceIds: string[], opts?: CallOptions) =>
    callApi<Vault>("unlink_services_from_account", { accountId, serviceIds }, opts),

  setPinned: (kind: PinKind, id: string, pinned: boolean, opts?: CallOptions) =>
    callApi<Vault>("set_pinned", { kind, id, pinned }, opts),

  bulkCreateAccounts: (request: BulkCreateRequest, opts?: CallOptions) =>
    callApi<BulkCreateResult>("bulk_create_accounts", { request }, opts),

  // Clipboard
  clipboardCopy: (text: string, clearAfterSeconds?: number, opts?: CallOptions) =>
    callApi<void>("clipboard_copy", clearAfterSeconds && clearAfterSeconds > 0 ? { text, clearAfterSeconds } : { text }, opts),

  clipboardClear: (opts?: CallOptions) => callApi<void>("clipboard_clear", undefined, opts),

  // Email
  isEmailProviderSupported: (email: string, imapHost?: string, opts?: CallOptions) =>
    callApi<boolean>("is_email_provider_supported", withOptional({ email }, { imapHost }), opts),

  testEmailConnection: (email: string, password: string, imapHost?: string, imapPort?: number, opts?: CallOptions) =>
    callApi<EmailConnection>("test_email_connection", withOptional({ email, password }, { imapHost, imapPort }), opts),

  fetchRecentEmails: (
    email: string,
    password: string,
    limit?: number,
    imapHost?: string,
    imapPort?: number,
    opts?: CallOptions,
  ) =>
    callApi<EmailFetchResult>(
      "fetch_recent_emails",
      withOptional({ email, password, limit: limit ?? 5 }, { imapHost, imapPort }),
      opts,
    ),
}

/** Adds optional args only when they carry a value (empty strings count as unset). */
function withOptional(
  args: Record<string, unknown>,
  optional: Record<string, string | number | undefined | null>,
): Record<string, unknown> {
  const result = { ...args }
  for (const [key, value] of Object.entries(optional)) {
    if (value === undefined || value === null) continue
    if (typeof value === "string" && value.trim() === "") continue
    if (typeof value === "number" && !Number.isFinite(value)) continue
    result[key] = typeof value === "string" ? value.trim() : value
  }
  return result
}
