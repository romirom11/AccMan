//! `commands.rs`: Defines the Tauri commands exposed to the frontend.

use crate::crypto::MasterPassword;
use crate::models::{Account, Service, ServiceType, Settings, Vault};
use crate::storage::{self, StorageError};
use crate::StoragePath;
use crate::defaults; // Import the defaults module
use std::sync::Mutex;
use tauri::State;
use uuid;

// --- State Management ---

/// Manages the in-memory state of the decrypted vault.
pub struct AppState(pub Mutex<Option<Vault>>);

/// Manages the session's master password. This is cleared on lock.
#[derive(Default)]
pub struct SessionState {
    pub master_password: Mutex<Option<MasterPassword>>,
}

// --- Command Errors ---

#[derive(Debug, serde::Serialize, thiserror::Error)]
pub enum CommandError {
    #[error("Storage Error: {0}")]
    Storage(String),
    #[error("Vault is already unlocked.")]
    AlreadyUnlocked,
    #[error("Vault is locked or not yet created.")]
    VaultLocked,
    #[error("A Service Type with ID '{0}' already exists.")]
    ServiceTypeExists(String),
    #[error("Service Type with ID '{0}' not found.")]
    ServiceTypeNotFound(String),
    #[error("Service with ID '{0}' not found.")]
    ServiceNotFound(String),
    #[error("Account with ID '{0}' not found.")]
    AccountNotFound(String),
    #[error("The old password provided is incorrect.")]
    InvalidOldPassword,
}

impl From<StorageError> for CommandError {
    fn from(err: StorageError) -> Self {
        CommandError::Storage(err.to_string())
    }
}

// --- Helper for saving ---
fn save_vault_with_session_password(
    path: &State<StoragePath>,
    app_state: &State<AppState>,
    session_state: &State<SessionState>,
) -> Result<(), CommandError> {
    let vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_ref().ok_or(CommandError::VaultLocked)?;

    let password_guard = session_state.master_password.lock().unwrap();
    let password = password_guard
        .as_ref()
        .ok_or(CommandError::VaultLocked)?;

    storage::save_vault(path, vault, password)?;
    Ok(())
}

// --- Vault Lifecycle Commands ---

#[tauri::command]
pub fn vault_exists(path: State<StoragePath>) -> bool {
    storage::vault_exists(&path)
}

#[tauri::command]
pub fn get_default_service_types_list() -> Vec<ServiceType> {
    defaults::get_default_service_types()
}


#[tauri::command]
pub fn create_vault(
    path: State<StoragePath>,
    password: String,
    settings: Settings,
    selected_service_type_ids: Vec<String>,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<Vault, CommandError> {
    let mut vault_state = app_state.0.lock().unwrap();
    if vault_exists(path.clone()) {
        if let Some(existing_vault) = vault_state.as_ref() {
            return Ok(existing_vault.clone());
        }
    }

    let all_default_types = defaults::get_default_service_types();
    let selected_types = all_default_types
        .into_iter()
        .filter(|st| selected_service_type_ids.contains(&st.id))
        .collect();

    let new_vault = Vault {
        version: "0.2.0".to_string(),
        service_types: selected_types,
        services: vec![],
        accounts: vec![],
        settings,
    };

    let master_pass = MasterPassword(password);
    storage::save_vault(&path, &new_vault, &master_pass)?;

    let mut session_pass = session_state.master_password.lock().unwrap();
    *session_pass = Some(master_pass);

    let vault_clone = new_vault.clone();
    *vault_state = Some(new_vault);

    Ok(vault_clone)
}

#[tauri::command]
pub fn unlock_vault(
    path: State<StoragePath>,
    password: String,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<Vault, CommandError> {
    let mut vault_state = app_state.0.lock().unwrap();
    if let Some(existing_vault) = vault_state.as_ref() {
        return Ok(existing_vault.clone());
    }

    let master_pass = MasterPassword(password);
    let vault = storage::load_vault(&path, &master_pass)?;

    let mut session_pass = session_state.master_password.lock().unwrap();
    *session_pass = Some(master_pass);

    let vault_clone = vault.clone();
    *vault_state = Some(vault);

    Ok(vault_clone)
}

#[tauri::command]
pub fn lock_vault(
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_state = app_state.0.lock().unwrap();
    if vault_state.is_none() {
        return Err(CommandError::VaultLocked);
    }
    *vault_state = None;

    let mut session_pass = session_state.master_password.lock().unwrap();
    *session_pass = None; // This will trigger ZeroizeOnDrop for MasterPassword

    Ok(())
}

#[tauri::command]
pub fn get_vault(app_state: State<AppState>) -> Result<Vault, CommandError> {
    let vault_guard = app_state.0.lock().unwrap();
    match vault_guard.as_ref() {
        Some(vault) => Ok(vault.clone()),
        None => Err(CommandError::VaultLocked),
    }
}

// --- Settings Commands ---

#[tauri::command]
pub fn update_settings(
    path: State<StoragePath>,
    settings: Settings,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    vault.settings = settings;

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

#[tauri::command]
pub fn delete_services(
    path: State<'_, StoragePath>,
    service_ids: Vec<String>,
    app_state: State<'_, AppState>,
    session_state: State<'_, SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    vault.services.retain(|s| !service_ids.contains(&s.id));

    // Also remove these services from any account that links to them
    for account in &mut vault.accounts {
        account.linked_services.retain(|id| !service_ids.contains(id));
    }

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}


// --- ServiceType Commands ---

#[tauri::command]
pub fn add_service_type(
    path: State<StoragePath>,
    service_type: ServiceType,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    if vault
        .service_types
        .iter()
        .any(|st| st.id == service_type.id)
    {
        return Err(CommandError::ServiceTypeExists(service_type.id));
    }

    vault.service_types.push(service_type);

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

#[tauri::command]
pub fn update_service_type(
    path: State<StoragePath>,
    service_type: ServiceType,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    if let Some(st) = vault
        .service_types
        .iter_mut()
        .find(|st| st.id == service_type.id)
    {
        *st = service_type;
    } else {
        return Err(CommandError::ServiceTypeNotFound(service_type.id));
    }

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

#[tauri::command]
pub fn delete_service_type(
    path: State<StoragePath>,
    service_type_id: String,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    let initial_len = vault.service_types.len();
    vault
        .service_types
        .retain(|st| st.id != service_type_id);

    if vault.service_types.len() == initial_len {
        return Err(CommandError::ServiceTypeNotFound(service_type_id));
    }

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

// --- Service Commands ---

#[tauri::command]
pub fn add_service(
    path: State<StoragePath>,
    service: Service,
    account_id: Option<String>,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    let service_id = service.id.clone();
    vault.services.push(service);

    // If account_id is provided, link the service to the account
    if let Some(account_id) = account_id {
        if let Some(account) = vault.accounts.iter_mut().find(|a| a.id == account_id) {
            account.linked_services.push(service_id);
            account.linked_services.sort();
            account.linked_services.dedup();
        } else {
            return Err(CommandError::AccountNotFound(account_id));
        }
    }

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

#[tauri::command]
pub fn add_services(
    path: State<StoragePath>,
    services: Vec<Service>,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    vault.services.extend(services);

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

#[tauri::command]
pub fn update_service(
    path: State<StoragePath>,
    service: Service,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    if let Some(s) = vault.services.iter_mut().find(|s| s.id == service.id) {
        *s = service;
    } else {
        return Err(CommandError::ServiceNotFound(service.id));
    }

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

#[tauri::command]
pub fn delete_service(
    path: State<StoragePath>,
    service_id: String,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    let initial_len = vault.services.len();
    vault.services.retain(|s| s.id != service_id);

    if vault.services.len() == initial_len {
        return Err(CommandError::ServiceNotFound(service_id));
    }

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

// --- Account Commands ---

#[tauri::command]
pub fn add_account(
    path: State<StoragePath>,
    account: Account,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    vault.accounts.push(account);

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

#[tauri::command]
pub fn update_account(
    path: State<StoragePath>,
    account: Account,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    if let Some(a) = vault.accounts.iter_mut().find(|a| a.id == account.id) {
        *a = account;
    } else {
        return Err(CommandError::AccountNotFound(account.id));
    }

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

#[tauri::command]
pub fn delete_account(
    path: State<StoragePath>,
    account_id: String,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    let initial_len = vault.accounts.len();
    vault.accounts.retain(|a| a.id != account_id);

    if vault.accounts.len() == initial_len {
        return Err(CommandError::AccountNotFound(account_id));
    }

    // Also unlink services from this account
    // This is a simple implementation. A more robust one might check if other accounts use these services.
    // For now, we assume services can be linked to multiple accounts.

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

#[tauri::command]
pub fn link_services_to_account(
    path: State<StoragePath>,
    account_id: String,
    service_ids: Vec<String>,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    if let Some(account) = vault.accounts.iter_mut().find(|a| a.id == account_id) {
        account.linked_services.extend(service_ids.into_iter());
        account.linked_services.sort();
        account.linked_services.dedup();
    } else {
        return Err(CommandError::AccountNotFound(account_id));
    }

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;

    Ok(())
}

#[tauri::command]
pub fn change_master_password(
    path: State<StoragePath>,
    old_password: String,
    new_password: String,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_ref().ok_or(CommandError::VaultLocked)?;

    let mut password_guard = session_state.master_password.lock().unwrap();
    let session_password = password_guard.as_ref().ok_or(CommandError::VaultLocked)?;

    if session_password.0 != old_password {
        return Err(CommandError::InvalidOldPassword);
    }
    
    let new_master_password = MasterPassword(new_password);

    storage::save_vault(&path, &vault, &new_master_password)?;

    *password_guard = Some(new_master_password);

    Ok(())
}

#[derive(Debug, serde::Deserialize)]
pub struct BulkAccountConfig {
    pub count: u32,
    #[serde(rename = "nameTemplate")]
    pub name_template: String,
    #[serde(rename = "startNumber")]
    pub start_number: u32,
    pub tags: Vec<String>,
    pub notes: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct ServiceLinkConfig {
    #[serde(rename = "serviceTypeId")]
    pub service_type_id: String,
    #[serde(rename = "nameTemplate")]
    pub name_template: String,
    pub data: std::collections::HashMap<String, String>,
    pub tags: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct BulkCreateRequest {
    #[serde(rename = "accountConfig")]
    pub account_config: BulkAccountConfig,
    #[serde(rename = "linkServices")]
    pub link_services: bool,
    #[serde(rename = "serviceConfigs")]
    pub service_configs: Vec<ServiceLinkConfig>,
}

#[tauri::command]
pub fn bulk_create_accounts(
    path: State<StoragePath>,
    request: BulkCreateRequest,
    app_state: State<AppState>,
    session_state: State<SessionState>,
) -> Result<(), CommandError> {
    let mut vault_guard = app_state.0.lock().unwrap();
    let vault = vault_guard.as_mut().ok_or(CommandError::VaultLocked)?;

    let mut created_accounts = Vec::new();

    // Create accounts
    for i in 0..request.account_config.count {
        let account_number = request.account_config.start_number + i;
        let account_name = request.account_config.name_template.replace("%n%", &account_number.to_string());
        
        let account = Account {
            id: uuid::Uuid::new_v4().to_string(),
            label: account_name,
            notes: request.account_config.notes.clone(),
            tags: request.account_config.tags.clone(),
            linked_services: Vec::new(),
        };
        
        created_accounts.push(account.clone());
        vault.accounts.push(account);
    }

    // Link existing services if requested
    if request.link_services {
        for account in &mut created_accounts {
            let account_number = account.label
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse::<u32>()
                .unwrap_or(1);

            for service_config in &request.service_configs {
                // Check if service type exists
                if !vault.service_types.iter().any(|st| st.id == service_config.service_type_id) {
                    continue; // Skip if service type doesn't exist
                }

                let service_name = service_config.name_template.replace("%n%", &account_number.to_string());
                
                // Search for existing service by name and service type
                if let Some(existing_service) = vault.services.iter().find(|s| 
                    s.label == service_name && s.service_type_id == service_config.service_type_id
                ) {
                    // Link existing service to account
                    if let Some(vault_account) = vault.accounts.iter_mut().find(|a| a.id == account.id) {
                        if !vault_account.linked_services.contains(&existing_service.id) {
                            vault_account.linked_services.push(existing_service.id.clone());
                        }
                    }
                }
            }
        }
    }

    drop(vault_guard);
    save_vault_with_session_password(&path, &app_state, &session_state)?;
    Ok(())
}
