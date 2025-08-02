import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { Vault, ServiceType, Service, Account, Settings } from '@/types';
import i18n from '@/i18n';

/**
 * Універсальна функція-обгортка для викликів API Rust-бекенду.
 * Централізовано обробляє помилки та показує відповідні toast-повідомлення.
 * @param command Назва команди Tauri для виклику.
 * @param args Аргументи, що передаються команді.
 * @param successMessageKey Ключ перекладу для повідомлення про успіх.
 * @returns Повертає результат виконання команди.
 */
async function callApi<T>(
  command: string,
  args?: Record<string, unknown>,
  successMessageKey?: string,
): Promise<T> {
  try {
    const result = await invoke<T>(command, args);
    if (successMessageKey) {
      toast.success(i18n.t(successMessageKey));
    }
    return result;
  } catch (error: any) {
    const errorMessage = typeof error === 'string' ? error : (error.message || 'An unknown error occurred');
    console.error(`API Error on command '${command}':`, errorMessage);
    toast.error(`${i18n.t('api.error.prefix')}: ${errorMessage}`);
    throw new Error(errorMessage);
  }
}

export const vaultApi = {
  vaultExists: () => callApi<boolean>('vault_exists'),

  getDefaultServiceTypesList: () => callApi<ServiceType[]>('get_default_service_types_list'),

  createVault: (password: string, settings: Settings, selectedServiceTypeIds: string[]) =>
    callApi<Vault>('create_vault', { password, settings, selectedServiceTypeIds }, 'api.success.vault_created'),

  unlockVault: (password: string) =>
    callApi<Vault>('unlock_vault', { password }),

  lockVault: () =>
    callApi<void>('lock_vault'),

  // Settings
  updateSettings: (settings: Settings) =>
    callApi<void>('update_settings', { settings }),
  changePassword: (oldPassword: string, newPassword: string) =>
    callApi<void>('change_master_password', { oldPassword, newPassword }, 'api.success.password_changed'),

  // Service Types
  addServiceType: (serviceType: ServiceType) =>
    callApi<void>('add_service_type', { serviceType }, 'api.success.service_type_added'),

  updateServiceType: (serviceType: ServiceType) =>
    callApi<void>('update_service_type', { serviceType }, 'api.success.service_type_updated'),

  deleteServiceType: (serviceTypeId: string) =>
    callApi<void>('delete_service_type', { serviceTypeId }, 'api.success.service_type_deleted'),

  // Services
  addService: (service: Service) =>
    callApi<void>('add_service', { service }, 'api.success.service_added'),
  addServices: (services: Service[]) =>
    callApi<void>('add_services', { services }),
  
  updateService: (service: Service) =>
    callApi<void>('update_service', { service }, 'api.success.service_updated'),

  deleteService: (serviceId: string) =>
    callApi<void>('delete_service', { serviceId }, 'api.success.service_deleted'),

  // Accounts
  addAccount: (account: Account) =>
    callApi<void>('add_account', { account }, 'api.success.account_added'),

  updateAccount: (account: Account) =>
    callApi<void>('update_account', { account }, 'api.success.account_updated'),

  deleteAccount: (accountId: string) =>
    callApi<void>('delete_account', { accountId }, 'api.success.account_deleted'),
    
  linkServicesToAccount: (accountId: string, serviceIds: string[]) =>
    callApi<void>('link_services_to_account', { accountId, serviceIds }, 'api.success.services_linked'),
};
