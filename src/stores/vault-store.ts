import { create } from "zustand";
import { toast } from "sonner";
import i18n from "@/i18n";
import { vaultApi } from "@/api/vault";
import type { Vault, ServiceType, Service, Account, Settings, BulkCreateRequest } from "@/types";

export type { Vault, Service, ServiceType, ServiceField, Account, Settings, BulkCreateRequest } from "@/types";

type AppStatus = "loading" | "needs_setup" | "locked" | "unlocked" | "error";

interface VaultStore {
  appStatus: AppStatus;
  vault: Vault | null;
  error: string | null;
  servicesViewMode: "grid" | "table";
  accountsViewMode: "grid" | "list";
  checkInitialStatus: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  createVault: (password: string, settings: Settings, selectedServiceTypeIds: string[]) => Promise<void>;
  lock: () => Promise<void>;
  
  // Settings
  updateSettings: (settings: Settings) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;

  // Service Types
  addServiceType: (serviceType: ServiceType) => Promise<void>;
  updateServiceType: (serviceType: ServiceType) => Promise<void>;
  deleteServiceType: (serviceTypeId: string) => Promise<void>;

  // Services
  addService: (service: Service, accountId?: string) => Promise<void>;
  addServices: (services: Service[]) => Promise<void>; // Add this
  updateService: (service: Service) => Promise<void>;
  deleteService: (serviceId: string) => Promise<void>;
  deleteServices: (serviceIds: string[]) => Promise<void>;

  // Accounts
  addAccount: (account: Account) => Promise<void>;
  updateAccount: (account: Account) => Promise<void>;
  deleteAccount: (accountId: string) => Promise<void>;
  linkServicesToAccount: (accountId: string, serviceIds: string[]) => Promise<void>;
  bulkCreateAccounts: (request: BulkCreateRequest) => Promise<void>;

  setServicesViewMode: (mode: "grid" | "table") => void;
  setAccountsViewMode: (mode: "grid" | "list") => void;

  resetError: () => void;
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  appStatus: "loading",
  vault: null,
  error: null,
  servicesViewMode: "grid",
  accountsViewMode: "grid",

  checkInitialStatus: async () => {
    try {
      const exists = await vaultApi.vaultExists();
      set({ appStatus: exists ? "locked" : "needs_setup" });
    } catch (e: any) {
      set({ appStatus: "error", error: e.message || "Failed to initialize" });
    }
  },

  setServicesViewMode: (mode) => set({ servicesViewMode: mode }),
  setAccountsViewMode: (mode) => set({ accountsViewMode: mode }),

  unlock: async (password: string) => {
    set({ appStatus: "loading", error: null });
    try {
      const vault = await vaultApi.unlockVault(password);
      set({ appStatus: "unlocked", vault });
    } catch (e: any) {
      set({ appStatus: "error", error: e.message });
      throw e; // Re-throw to be caught in the component
    }
  },

  createVault: async (password: string, settings: Settings, selectedServiceTypeIds: string[]) => {
    set({ appStatus: "loading", error: null });
    try {
      const vault = await vaultApi.createVault(password, settings, selectedServiceTypeIds);
      set({ appStatus: "unlocked", vault });
    } catch (e: any) {
      set({ appStatus: "error", error: e.message });
      throw e; // Re-throw to be caught in the component
    }
  },

  lock: async () => {
    set({ appStatus: "loading" });
    try {
        await vaultApi.lockVault();
        set({ appStatus: "locked", vault: null, error: null });
    } catch (e: any) {
        set({ appStatus: "error", error: e.message });
        throw e;
    }
  },
  
  updateSettings: async (settings: Settings) => {
    const { vault } = get();
    if (!vault) return;

    await vaultApi.updateSettings(settings);
    set({
      vault: {
        ...vault,
        settings,
      },
    });
  },

  addServiceType: async (serviceType: ServiceType) => {
    const { vault } = get();
    if (!vault) return;
    
    await vaultApi.addServiceType(serviceType);
    set({
      vault: {
        ...vault,
        serviceTypes: [...vault.serviceTypes, serviceType],
      },
    });
  },

  changePassword: async (oldPassword: string, newPassword: string) => {
    await vaultApi.changePassword(oldPassword, newPassword);
  },
  
  updateServiceType: async (serviceType: ServiceType) => {
      const { vault } = get();
      if (!vault) return;
      
      await vaultApi.updateServiceType(serviceType);
      set({
          vault: {
              ...vault,
              serviceTypes: vault.serviceTypes.map(st => st.id === serviceType.id ? serviceType : st),
          }
      });
  },

  deleteServiceType: async (serviceTypeId: string) => {
      const { vault } = get();
      if (!vault) return;
      
      await vaultApi.deleteServiceType(serviceTypeId);
      set({
          vault: {
              ...vault,
              serviceTypes: vault.serviceTypes.filter(st => st.id !== serviceTypeId),
          }
      });
  },

  addService: async (service: Service, accountId?: string) => {
    const { vault } = get();
    if (!vault) return;

    await vaultApi.addService(service, accountId);
    set({
      vault: {
        ...vault,
        services: [...vault.services, service],
        accounts: accountId ? vault.accounts.map(acc => {
          if (acc.id === accountId) {
            const newLinkedServices = [...acc.linkedServices, service.id];
            return { ...acc, linkedServices: [...new Set(newLinkedServices)] };
          }
          return acc;
        }) : vault.accounts,
      },
    });
  },

  addServices: async (services: Service[]) => {
    const { vault } = get();
    if (!vault) return;

    await vaultApi.addServices(services);
    set({
      vault: {
        ...vault,
        services: [...vault.services, ...services],
      },
    });
  },

  updateService: async (service: Service) => {
    const { vault } = get();
    if (!vault) return;

    await vaultApi.updateService(service);
    set({
      vault: {
        ...vault,
        services: vault.services.map(s => s.id === service.id ? service : s),
      },
    });
  },

  deleteService: async (serviceId: string) => {
    const { vault } = get();
    if (!vault) return;

    await vaultApi.deleteService(serviceId);
    set({
      vault: {
        ...vault,
        services: vault.services.filter(s => s.id !== serviceId),
      },
    });
  },

  deleteServices: async (serviceIds: string[]) => {
    const { vault } = get();
    if (!vault) return;

    await vaultApi.deleteServices(serviceIds);
    set({
      vault: {
        ...vault,
        services: vault.services.filter(s => !serviceIds.includes(s.id)),
      },
    });
  },

  addAccount: async (account: Account) => {
    const { vault } = get();
    if (!vault) return;

    await vaultApi.addAccount(account);
    set({
      vault: {
        ...vault,
        accounts: [...vault.accounts, account],
      },
    });
  },

  updateAccount: async (account: Account) => {
    const { vault } = get();
    if (!vault) return;

    await vaultApi.updateAccount(account);
    set({
      vault: {
        ...vault,
        accounts: vault.accounts.map(a => a.id === account.id ? account : a),
      },
    });
  },

  deleteAccount: async (accountId: string) => {
    const { vault } = get();
    if (!vault) return;

    await vaultApi.deleteAccount(accountId);
    set({
      vault: {
        ...vault,
        accounts: vault.accounts.filter(a => a.id !== accountId),
      },
    });
  },

  linkServicesToAccount: async (accountId: string, serviceIds: string[]) => {
    const { vault } = get();
    if (!vault) return;

    await vaultApi.linkServicesToAccount(accountId, serviceIds);
    set({
        vault: {
            ...vault,
            accounts: vault.accounts.map(acc => {
                if (acc.id === accountId) {
                    const newLinkedServices = [...acc.linkedServices, ...serviceIds];
                    // Remove duplicates
                    return { ...acc, linkedServices: [...new Set(newLinkedServices)] };
                }
                return acc;
            })
        }
    })
  },

  bulkCreateAccounts: async (request: BulkCreateRequest) => {
    try {
      await vaultApi.bulkCreateAccounts(request);
      // Refresh vault data to get the newly created accounts
      const updatedVault = await vaultApi.getVault();
      set({ vault: updatedVault });
      toast.success(i18n.t('api.success.bulk_accounts_created'));
    } catch (e: any) {
      console.error('Failed to bulk create accounts:', e);
      throw e;
    }
  },

  resetError: () => {
    const { appStatus } = get();
    // Only reset error if it's a recoverable state (like failed unlock)
    if (appStatus === 'error') {
      set({ appStatus: 'locked', error: null });
    }
  },
}));
