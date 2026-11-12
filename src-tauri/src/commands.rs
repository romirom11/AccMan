//! `commands.rs`: the Tauri command layer. Thin wrappers over `session::AppState` and
//! `vault_ops`; all logic lives there.
//!
//! Commands that derive a key (create, unlock, password change, export, import, restore) and
//! clipboard access run on a blocking worker, never on the main thread. Ordinary mutations reuse
//! the session key, are fast, and stay synchronous so they execute in the order they were sent.

use std::path::PathBuf;

use log::warn;
use tauri::{AppHandle, Manager, State};

use crate::clipboard;
use crate::defaults;
use crate::error::CommandResult;
use crate::models::{
    Account, BackupInfo, BulkCreateRequest, BulkCreateResult, ImportResult, Service, ServiceType,
    Settings, Vault,
};
use crate::session::{secret, AppState};
use crate::storage::now_millis;
use crate::vault_ops;

/// Runs `work` against the app state on the blocking thread pool.
async fn on_worker<T, F>(app: &AppHandle, work: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> CommandResult<T> + Send + 'static,
{
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        work(&state)
    })
    .await?
}

fn mutate(
    state: &AppState,
    change: impl FnOnce(&mut Vault, u64) -> CommandResult<()>,
) -> CommandResult<Vault> {
    let now = now_millis();
    state.mutate(|vault| change(vault, now)).map(|(vault, ())| vault)
}

// --- Vault lifecycle ---

#[tauri::command]
pub fn vault_exists(state: State<'_, AppState>) -> CommandResult<bool> {
    state.vault_exists()
}

#[tauri::command]
pub fn get_default_service_types_list() -> Vec<ServiceType> {
    defaults::get_default_service_types()
}

#[tauri::command]
pub async fn create_vault(
    app: AppHandle,
    password: String,
    settings: Settings,
    selected_service_type_ids: Vec<String>,
) -> CommandResult<Vault> {
    let password = secret(password);
    on_worker(&app, move |state| {
        state.create_vault(&password, settings, &selected_service_type_ids)
    })
    .await
}

#[tauri::command]
pub async fn unlock_vault(app: AppHandle, password: String) -> CommandResult<Vault> {
    let password = secret(password);
    on_worker(&app, move |state| state.unlock(&password)).await
}

/// Idempotent. Also clears the clipboard if it still holds a value copied by the app.
#[tauri::command]
pub async fn lock_vault(app: AppHandle) -> CommandResult<()> {
    app.state::<AppState>().lock();
    let handle = app.clone();
    let cleared = tauri::async_runtime::spawn_blocking(move || clipboard::clear_if_owned(&handle)).await;
    match cleared {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => warn!("Clipboard was not cleared on lock: {e}"),
        Err(e) => warn!("Clipboard was not cleared on lock: {e}"),
    }
    Ok(())
}

#[tauri::command]
pub fn get_vault(state: State<'_, AppState>) -> CommandResult<Vault> {
    state.get_vault()
}

#[tauri::command]
pub fn update_settings(state: State<'_, AppState>, settings: Settings) -> CommandResult<Vault> {
    mutate(&state, |v, _| vault_ops::update_settings(v, settings))
}

#[tauri::command]
pub async fn change_master_password(
    app: AppHandle,
    old_password: String,
    new_password: String,
) -> CommandResult<()> {
    let old_password = secret(old_password);
    let new_password = secret(new_password);
    on_worker(&app, move |state| {
        state.change_master_password(&old_password, &new_password)
    })
    .await
}

#[tauri::command]
pub async fn export_vault(app: AppHandle, export_path: String, password: String) -> CommandResult<()> {
    let password = secret(password);
    on_worker(&app, move |state| {
        state.export_vault(&PathBuf::from(export_path), &password)
    })
    .await
}

#[tauri::command]
pub async fn import_vault(
    app: AppHandle,
    import_path: String,
    password: String,
    merge_strategy: String,
) -> CommandResult<ImportResult> {
    let password = secret(password);
    on_worker(&app, move |state| {
        state.import_vault(&PathBuf::from(import_path), &password, &merge_strategy)
    })
    .await
}

#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> CommandResult<Vec<BackupInfo>> {
    state.list_backups()
}

#[tauri::command]
pub async fn restore_backup(app: AppHandle, file_name: String, password: String) -> CommandResult<Vault> {
    let password = secret(password);
    on_worker(&app, move |state| state.restore_backup(&file_name, &password)).await
}

// --- Service types ---

#[tauri::command]
pub fn add_service_type(state: State<'_, AppState>, service_type: ServiceType) -> CommandResult<Vault> {
    mutate(&state, |v, _| vault_ops::add_service_type(v, service_type))
}

#[tauri::command]
pub fn update_service_type(state: State<'_, AppState>, service_type: ServiceType) -> CommandResult<Vault> {
    mutate(&state, |v, _| vault_ops::update_service_type(v, service_type))
}

#[tauri::command]
pub fn delete_service_type(
    state: State<'_, AppState>,
    service_type_id: String,
    cascade: Option<bool>,
) -> CommandResult<Vault> {
    mutate(&state, |v, _| {
        vault_ops::delete_service_type(v, &service_type_id, cascade.unwrap_or(false))
    })
}

// --- Services ---

#[tauri::command]
pub fn add_service(
    state: State<'_, AppState>,
    service: Service,
    account_id: Option<String>,
) -> CommandResult<Vault> {
    mutate(&state, |v, now| {
        vault_ops::add_service(v, service, account_id.as_deref(), now)
    })
}

#[tauri::command]
pub fn add_services(state: State<'_, AppState>, services: Vec<Service>) -> CommandResult<Vault> {
    mutate(&state, |v, now| vault_ops::add_services(v, services, now))
}

#[tauri::command]
pub fn update_service(state: State<'_, AppState>, service: Service) -> CommandResult<Vault> {
    mutate(&state, |v, now| vault_ops::update_service(v, service, now))
}

#[tauri::command]
pub fn delete_service(state: State<'_, AppState>, service_id: String) -> CommandResult<Vault> {
    mutate(&state, |v, _| vault_ops::delete_service(v, &service_id))
}

#[tauri::command]
pub fn delete_services(state: State<'_, AppState>, service_ids: Vec<String>) -> CommandResult<Vault> {
    mutate(&state, |v, _| vault_ops::delete_services(v, &service_ids))
}

// --- Accounts ---

#[tauri::command]
pub fn add_account(state: State<'_, AppState>, account: Account) -> CommandResult<Vault> {
    mutate(&state, |v, now| vault_ops::add_account(v, account, now))
}

#[tauri::command]
pub fn update_account(state: State<'_, AppState>, account: Account) -> CommandResult<Vault> {
    mutate(&state, |v, now| vault_ops::update_account(v, account, now))
}

#[tauri::command]
pub fn delete_account(state: State<'_, AppState>, account_id: String) -> CommandResult<Vault> {
    mutate(&state, |v, _| vault_ops::delete_account(v, &account_id))
}

#[tauri::command]
pub fn delete_accounts(state: State<'_, AppState>, account_ids: Vec<String>) -> CommandResult<Vault> {
    mutate(&state, |v, _| vault_ops::delete_accounts(v, &account_ids))
}

#[tauri::command]
pub fn link_services_to_account(
    state: State<'_, AppState>,
    account_id: String,
    service_ids: Vec<String>,
) -> CommandResult<Vault> {
    mutate(&state, |v, now| {
        vault_ops::link_services_to_account(v, &account_id, &service_ids, now)
    })
}

#[tauri::command]
pub fn unlink_services_from_account(
    state: State<'_, AppState>,
    account_id: String,
    service_ids: Vec<String>,
) -> CommandResult<Vault> {
    mutate(&state, |v, now| {
        vault_ops::unlink_services_from_account(v, &account_id, &service_ids, now)
    })
}

#[tauri::command]
pub fn set_pinned(state: State<'_, AppState>, kind: String, id: String, pinned: bool) -> CommandResult<Vault> {
    mutate(&state, |v, _| vault_ops::set_pinned(v, &kind, &id, pinned))
}

#[tauri::command]
pub fn bulk_create_accounts(
    state: State<'_, AppState>,
    request: BulkCreateRequest,
) -> CommandResult<BulkCreateResult> {
    let now = now_millis();
    let (vault, summary) = state.mutate(|v| vault_ops::bulk_create_accounts(v, &request, now))?;
    Ok(BulkCreateResult { vault, summary })
}

// --- Clipboard ---

#[tauri::command]
pub async fn clipboard_copy(
    app: AppHandle,
    text: String,
    clear_after_seconds: Option<u32>,
) -> CommandResult<()> {
    let text = secret(text);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || clipboard::copy(&handle, &text, clear_after_seconds))
        .await?
}

#[tauri::command]
pub async fn clipboard_clear(app: AppHandle) -> CommandResult<()> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || clipboard::clear_if_owned(&handle).map(|_| ()))
        .await?
}
