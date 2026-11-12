import { create } from "zustand"
import { toast } from "sonner"
import i18n from "@/i18n"
import { vaultApi, type CallOptions } from "@/api/vault"
import { getErrorMessage, isApiError, toApiError } from "@/lib/errors"
import {
  DEFAULT_SETTINGS,
  type AccountInput,
  type BackupInfo,
  type BulkCreateRequest,
  type BulkCreateSummary,
  type ImportSummary,
  type MergeStrategy,
  type PinKind,
  type ServiceInput,
  type ServiceType,
  type Settings,
  type Vault,
} from "@/types"

export type {
  Vault,
  Service,
  ServiceType,
  ServiceField,
  Account,
  Settings,
  BulkCreateRequest,
  BulkCreateSummary,
  ImportSummary,
  BackupInfo,
  ServiceInput,
  AccountInput,
  MergeStrategy,
  PinKind,
} from "@/types"
export type { CallOptions } from "@/api/vault"

/**
 * loading     – only the very first status check at startup
 * needs_setup – no vault file yet
 * locked      – vault file exists, session locked
 * unlocked    – vault loaded
 * error       – the startup check itself failed (see `error`); `resetError()` retries it
 */
export type AppStatus = "loading" | "needs_setup" | "locked" | "unlocked" | "error"

interface VaultStore {
  appStatus: AppStatus
  vault: Vault | null
  /** Localised message of a failed startup check (status 'error'). */
  error: string | null
  servicesViewMode: "grid" | "table"
  accountsViewMode: "grid" | "list"

  // Lifecycle
  checkInitialStatus: () => Promise<void>
  /**
   * unlock, createVault and restoreBackup resolve quietly (no toast, nothing thrown) when a lock
   * arrived while they were running (VAULT_LOCKED): the lock wins and the app stays where it is.
   */
  unlock: (password: string) => Promise<void>
  createVault: (password: string, settings: Partial<Settings>, selectedServiceTypeIds: string[]) => Promise<void>
  lock: () => Promise<void>
  refreshVault: () => Promise<void>
  resetError: () => void

  // Settings & password
  updateSettings: (settings: Settings) => Promise<void>
  changePassword: (oldPassword: string, newPassword: string, opts?: CallOptions) => Promise<void>

  // Export / import / backups
  exportVault: (exportPath: string, password: string, opts?: CallOptions) => Promise<void>
  importVault: (
    importPath: string,
    password: string,
    mergeStrategy: MergeStrategy,
    opts?: CallOptions,
  ) => Promise<ImportSummary>
  listBackups: (opts?: CallOptions) => Promise<BackupInfo[]>
  restoreBackup: (fileName: string, password: string, opts?: CallOptions) => Promise<void>

  // Service types
  addServiceType: (serviceType: ServiceType) => Promise<void>
  updateServiceType: (serviceType: ServiceType) => Promise<void>
  deleteServiceType: (serviceTypeId: string, cascade?: boolean) => Promise<void>

  // Services
  addService: (service: ServiceInput, accountId?: string) => Promise<void>
  addServices: (services: ServiceInput[]) => Promise<void>
  updateService: (service: ServiceInput) => Promise<void>
  deleteService: (serviceId: string) => Promise<void>
  deleteServices: (serviceIds: string[]) => Promise<void>

  // Accounts
  addAccount: (account: AccountInput) => Promise<void>
  updateAccount: (account: AccountInput) => Promise<void>
  deleteAccount: (accountId: string) => Promise<void>
  deleteAccounts: (accountIds: string[]) => Promise<void>
  linkServicesToAccount: (accountId: string, serviceIds: string[]) => Promise<void>
  unlinkServicesFromAccount: (accountId: string, serviceIds: string[]) => Promise<void>
  setPinned: (kind: PinKind, id: string, pinned: boolean) => Promise<void>
  bulkCreateAccounts: (request: BulkCreateRequest) => Promise<BulkCreateSummary>

  // UI preferences
  setServicesViewMode: (mode: "grid" | "table") => void
  setAccountsViewMode: (mode: "grid" | "list") => void
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)

/**
 * VAULT_LOCKED from a command that opens a session (unlock, create, restore) means a lock arrived
 * while it was running and won: the backend installed no session and changed nothing. That is not
 * an error to show; the app simply stays on the lock (or setup) screen.
 */
function isLockedDuringOpen(error: unknown): boolean {
  return isApiError(error, "VAULT_LOCKED")
}

// Incremented whenever the session changes (lock, unlock, create, restore). A command result
// that belongs to an older session is dropped instead of resurrecting data after a lock.
let sessionEpoch = 0
// Overlapping mutations: each returns the vault as of its own commit, and responses may
// arrive in any order, so after an overlap we resync once from the backend.
let mutationsInFlight = 0
let mutationsOverlapped = false
let initialCheck: Promise<void> | null = null

/** "Added: 1 account, 2 services…" with each count pluralised on its own. */
function importSummaryText(summary: ImportSummary): string {
  return t("api.success.vault_imported_summary", {
    serviceTypesAdded: t("api.counts.service_types", { count: summary.serviceTypesAdded }),
    servicesAdded: t("api.counts.services", { count: summary.servicesAdded }),
    accountsAdded: t("api.counts.accounts", { count: summary.accountsAdded }),
    serviceTypesMerged: t("api.counts.service_types", { count: summary.serviceTypesMerged }),
    servicesSkipped: t("api.counts.services", { count: summary.servicesSkipped }),
    accountsSkipped: t("api.counts.accounts", { count: summary.accountsSkipped }),
  })
}

/** Keeps backend-managed fields (pinned, timestamps) from the current copy when the caller omitted them. */
function withManagedFields<T extends { id: string }>(
  input: T,
  current: { pinned: boolean; createdAt: number; updatedAt: number } | undefined,
): T {
  if (!current) return input
  return { pinned: current.pinned, createdAt: current.createdAt, updatedAt: current.updatedAt, ...input }
}

export const useVaultStore = create<VaultStore>((set, get) => {
  const isCurrentSession = (epoch: number) => epoch === sessionEpoch && get().appStatus === "unlocked"

  const resync = async (epoch: number) => {
    try {
      const vault = await vaultApi.getVault({ silent: true })
      if (isCurrentSession(epoch)) set({ vault })
    } catch {
      // The next mutation brings a fresh copy anyway.
    }
  }

  /** Runs a vault-returning command and adopts the returned vault. Errors are toasted by the API layer and rethrown. */
  const mutate = async (
    call: () => Promise<Vault>,
    success?: { key: string; params?: Record<string, unknown> },
  ): Promise<void> => {
    const epoch = sessionEpoch
    if (mutationsInFlight > 0) mutationsOverlapped = true
    mutationsInFlight++
    try {
      const vault = await call()
      if (isCurrentSession(epoch)) {
        set({ vault })
        if (success) toast.success(t(success.key, success.params))
      }
    } finally {
      mutationsInFlight--
      if (mutationsInFlight === 0 && mutationsOverlapped) {
        mutationsOverlapped = false
        void resync(epoch)
      }
    }
  }

  const startSession = (vault: Vault) => {
    sessionEpoch++
    set({ vault, appStatus: "unlocked", error: null })
  }

  /**
   * For commands that open a session (unlock, create, restore): if the session changed while the
   * command was running (the user locked, or a reload check ran), the late result must not unlock
   * the app. The backend may have installed a session after our lock_vault, so lock it again
   * (unless the user has meanwhile unlocked a newer session, which must stay open).
   * Returns false when the result was dropped.
   */
  const adoptSession = (epoch: number, vault: Vault): boolean => {
    if (epoch !== sessionEpoch) {
      if (get().appStatus !== "unlocked") void vaultApi.lockVault({ silent: true }).catch(() => undefined)
      return false
    }
    startSession(vault)
    return true
  }

  const runInitialCheck = async () => {
    // A webview reload must never leave the backend unlocked behind a lock screen.
    try {
      await vaultApi.lockVault({ silent: true })
    } catch {
      // Ignore: lock_vault is idempotent, and vault_exists below reports real problems.
    }
    try {
      const exists = await vaultApi.vaultExists({ silent: true })
      sessionEpoch++
      set({ appStatus: exists ? "locked" : "needs_setup", vault: null, error: null })
    } catch (e) {
      set({ appStatus: "error", vault: null, error: getErrorMessage(e) })
    }
  }

  return {
    appStatus: "loading",
    vault: null,
    error: null,
    servicesViewMode: "grid",
    accountsViewMode: "grid",

    checkInitialStatus: () => {
      // Shared promise: StrictMode runs mount effects twice.
      if (!initialCheck) {
        initialCheck = runInitialCheck().finally(() => {
          initialCheck = null
        })
      }
      return initialCheck
    },

    resetError: () => {
      if (get().appStatus === "error") {
        set({ appStatus: "loading", error: null })
        void get().checkInitialStatus()
      }
    },

    unlock: async (password) => {
      const epoch = sessionEpoch
      try {
        const vault = await vaultApi.unlockVault(password, { silent: true })
        adoptSession(epoch, vault)
      } catch (e) {
        if (isLockedDuringOpen(e)) return
        const error = toApiError(e)
        if (error.code === "VAULT_NOT_FOUND") {
          set({ appStatus: "needs_setup", vault: null })
        }
        throw error
      }
    },

    createVault: async (password, settings, selectedServiceTypeIds) => {
      const epoch = sessionEpoch
      try {
        const vault = await vaultApi.createVault(
          password,
          { ...DEFAULT_SETTINGS, ...settings },
          selectedServiceTypeIds,
          { silent: true },
        )
        if (adoptSession(epoch, vault)) toast.success(t("api.success.vault_created"))
      } catch (e) {
        // Nothing was created: the setup page stays as it is.
        if (isLockedDuringOpen(e)) return
        const error = toApiError(e)
        if (error.code === "VAULT_EXISTS") {
          // A vault appeared on disk (e.g. created by another instance): go to the lock screen.
          sessionEpoch++
          set({ appStatus: "locked", vault: null })
          toast.info(t("setup.vault_exists_redirect"))
        }
        throw error
      }
    },

    lock: async () => {
      // Drop decrypted data from the UI first, even if the backend call fails.
      sessionEpoch++
      set((state) => ({
        appStatus: state.appStatus === "unlocked" ? "locked" : state.appStatus,
        vault: null,
      }))
      try {
        await vaultApi.lockVault()
      } catch {
        // Error toast already shown by the API layer.
      }
    },

    refreshVault: async () => {
      if (get().appStatus !== "unlocked") return
      await resync(sessionEpoch)
    },

    setServicesViewMode: (mode) => set({ servicesViewMode: mode }),
    setAccountsViewMode: (mode) => set({ accountsViewMode: mode }),

    // Settings & password

    updateSettings: (settings) =>
      mutate(() => vaultApi.updateSettings(settings), { key: "settings.notifications.saved" }),

    changePassword: async (oldPassword, newPassword, opts) => {
      await vaultApi.changePassword(oldPassword, newPassword, opts)
      toast.success(t("api.success.password_changed"))
    },

    // Export / import / backups

    exportVault: async (exportPath, password, opts) => {
      await vaultApi.exportVault(exportPath, password, opts)
      toast.success(t("api.success.vault_exported"))
    },

    importVault: async (importPath, password, mergeStrategy, opts) => {
      const epoch = sessionEpoch
      const { vault, summary } = await vaultApi.importVault(importPath, password, mergeStrategy, opts)
      if (isCurrentSession(epoch)) {
        set({ vault })
        toast.success(t("api.success.vault_imported"), { description: importSummaryText(summary) })
      }
      return summary
    },

    listBackups: (opts) => vaultApi.listBackups(opts),

    restoreBackup: async (fileName, password, opts) => {
      const epoch = sessionEpoch
      let vault: Vault
      try {
        // Always silent here, so VAULT_LOCKED never toasts; other errors toast as the caller asked.
        vault = await vaultApi.restoreBackup(fileName, password, { silent: true })
      } catch (e) {
        // Nothing was restored; the lock that won leaves the app on the lock screen.
        if (isLockedDuringOpen(e)) return
        const error = toApiError(e)
        if (!opts?.silent) toast.error(getErrorMessage(error))
        throw error
      }
      if (adoptSession(epoch, vault)) {
        toast.success(t("api.success.backup_restored"))
      } else {
        // The file on disk was replaced, so its master password is now the backup's.
        toast.info(t("api.success.backup_restored_locked"))
      }
    },

    // Service types

    addServiceType: (serviceType) =>
      mutate(() => vaultApi.addServiceType(serviceType), { key: "api.success.service_type_added" }),

    updateServiceType: (serviceType) =>
      mutate(() => vaultApi.updateServiceType(serviceType), { key: "api.success.service_type_updated" }),

    deleteServiceType: (serviceTypeId, cascade = false) =>
      mutate(() => vaultApi.deleteServiceType(serviceTypeId, cascade), { key: "api.success.service_type_deleted" }),

    // Services

    addService: (service, accountId) =>
      mutate(() => vaultApi.addService(service, accountId), {
        key: accountId ? "api.success.service_added_and_linked" : "api.success.service_added",
      }),

    // No toast: the caller (bulk import) shows its own summary.
    addServices: (services) => mutate(() => vaultApi.addServices(services)),

    updateService: (service) => {
      const current = get().vault?.services.find((s) => s.id === service.id)
      return mutate(() => vaultApi.updateService(withManagedFields(service, current)), {
        key: "api.success.service_updated",
      })
    },

    deleteService: (serviceId) =>
      mutate(() => vaultApi.deleteService(serviceId), { key: "api.success.service_deleted" }),

    deleteServices: (serviceIds) =>
      mutate(() => vaultApi.deleteServices(serviceIds), {
        key: "api.success.services_deleted_count",
        params: { count: serviceIds.length },
      }),

    // Accounts

    addAccount: (account) => mutate(() => vaultApi.addAccount(account), { key: "api.success.account_added" }),

    updateAccount: (account) => {
      const current = get().vault?.accounts.find((a) => a.id === account.id)
      return mutate(() => vaultApi.updateAccount(withManagedFields(account, current)), {
        key: "api.success.account_updated",
      })
    },

    deleteAccount: (accountId) =>
      mutate(() => vaultApi.deleteAccount(accountId), { key: "api.success.account_deleted" }),

    deleteAccounts: (accountIds) =>
      mutate(() => vaultApi.deleteAccounts(accountIds), {
        key: "api.success.accounts_deleted_count",
        params: { count: accountIds.length },
      }),

    linkServicesToAccount: (accountId, serviceIds) =>
      mutate(() => vaultApi.linkServicesToAccount(accountId, serviceIds), {
        key: "api.success.services_linked",
        params: { count: serviceIds.length },
      }),

    unlinkServicesFromAccount: (accountId, serviceIds) =>
      mutate(() => vaultApi.unlinkServicesFromAccount(accountId, serviceIds), {
        key: "api.success.services_unlinked",
        params: { count: serviceIds.length },
      }),

    // No toast: the pin icon changes immediately.
    setPinned: (kind, id, pinned) => mutate(() => vaultApi.setPinned(kind, id, pinned)),

    bulkCreateAccounts: async (request) => {
      const epoch = sessionEpoch
      let summary: BulkCreateSummary = { created: 0, linked: 0, unmatched: 0 }
      await mutate(async () => {
        const result = await vaultApi.bulkCreateAccounts(request)
        summary = result.summary
        return result.vault
      })
      if (!isCurrentSession(epoch)) return summary
      toast.success(t("api.success.bulk_accounts_created", { count: summary.created }), {
        description: t("api.success.bulk_accounts_created_summary", {
          linked: t("api.counts.services", { count: summary.linked }),
        }),
      })
      if (summary.unmatched > 0) {
        toast.warning(t("api.warning.bulk_unmatched", { count: summary.unmatched }))
      }
      return summary
    },
  }
})
