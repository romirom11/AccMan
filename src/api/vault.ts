import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { Vault, ServiceType, Service, Account, Settings } from '@/types';

/**
 * Універсальна функція-обгортка для викликів API Rust-бекенду.
 * Централізовано обробляє помилки та показує відповідні toast-повідомлення.
 * @param command Назва команди Tauri для виклику.
 * @param args Аргументи, що передаються команді.
 * @param successMessage Повідомлення, яке відображається при успішному виконанні.
 * @returns Повертає результат виконання команди.
 */
async function callApi<T>(
  command: string,
  args?: Record<string, unknown>,
  successMessage?: string,
): Promise<T> {
  try {
    const result = await invoke<T>(command, args);
    if (successMessage) {
      toast.success(successMessage);
    }
    return result;
  } catch (error: any) {
    const errorMessage = typeof error === 'string' ? error : (error.message || 'An unknown error occurred');
    console.error(`API Error on command '${command}':`, errorMessage);
    toast.error(`Помилка: ${errorMessage}`);
    throw new Error(errorMessage);
  }
}

export const vaultApi = {
  vaultExists: () => callApi<boolean>('vault_exists'),

  getDefaultServiceTypesList: () => callApi<ServiceType[]>('get_default_service_types_list'),

  createVault: (password: string, settings: Settings, selectedServiceTypeIds: string[]) =>
    callApi<Vault>('create_vault', { password, settings, selectedServiceTypeIds }, 'Сховище успішно створено'),

  unlockVault: (password: string) =>
    callApi<Vault>('unlock_vault', { password }),

  lockVault: () =>
    callApi<void>('lock_vault'),

  // Settings
  updateSettings: (settings: Settings) =>
    callApi<void>('update_settings', { settings }),
  changePassword: (oldPassword: string, newPassword: string) =>
    callApi<void>('change_master_password', { oldPassword, newPassword }, 'Майстер-пароль успішно змінено'),

  // Service Types
  addServiceType: (serviceType: ServiceType) =>
    callApi<void>('add_service_type', { serviceType }, 'Тип сервісу успішно додано'),

  updateServiceType: (serviceType: ServiceType) =>
    callApi<void>('update_service_type', { serviceType }, 'Тип сервісу успішно оновлено'),

  deleteServiceType: (serviceTypeId: string) =>
    callApi<void>('delete_service_type', { serviceTypeId }, 'Тип сервісу успішно видалено'),

  // Services
  addService: (service: Service) =>
    callApi<void>('add_service', { service }, 'Сервіс успішно додано'),
  addServices: (services: Service[]) =>
    callApi<void>('add_services', { services }),
  
  updateService: (service: Service) =>
    callApi<void>('update_service', { service }, 'Сервіс успішно оновлено'),

  deleteService: (serviceId: string) =>
    callApi<void>('delete_service', { serviceId }, 'Сервіс успішно видалено'),

  // Accounts
  addAccount: (account: Account) =>
    callApi<void>('add_account', { account }, 'Акаунт успішно додано'),

  updateAccount: (account: Account) =>
    callApi<void>('update_account', { account }, 'Акаунт успішно оновлено'),

  deleteAccount: (accountId: string) =>
    callApi<void>('delete_account', { accountId }, 'Акаунт успішно видалено'),
    
  linkServicesToAccount: (accountId: string, serviceIds: string[]) =>
    callApi<void>('link_services_to_account', { accountId, serviceIds }, 'Сервіси успішно прив\'язано'),
};
