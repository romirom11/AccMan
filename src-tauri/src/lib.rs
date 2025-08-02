use std::fs;
use tauri::{path::BaseDirectory, Manager};

pub mod commands;
pub mod crypto;
pub mod models;
pub mod storage;
pub mod defaults;

use commands::{AppState, SessionState};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct StoragePath(pub PathBuf);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = app
                .path()
                .resolve("vault.json", BaseDirectory::AppLocalData)?;

            if let Some(parent) = path.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)?;
                }
            }

            app.manage(StoragePath(path));
            app.manage(AppState(Mutex::new(None)));
            app.manage(SessionState::default());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_exists,
            commands::get_default_service_types_list,
            commands::create_vault,
            commands::unlock_vault,
            commands::lock_vault,
            // Settings
            commands::update_settings,
            commands::change_master_password,
            // ServiceType
            commands::add_service_type,
            commands::update_service_type,
            commands::delete_service_type,
            // Service
            commands::add_service,
            commands::add_services,
            commands::update_service,
            commands::delete_service,
            commands::delete_services,
            // Account
            commands::add_account,
            commands::update_account,
            commands::delete_account,
            commands::link_services_to_account
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
