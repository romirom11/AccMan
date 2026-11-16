use tauri::{path::BaseDirectory, Manager};

pub mod clipboard;
pub mod commands;
pub mod crypto;
pub mod defaults;
pub mod email_client;
pub mod email_commands;
pub mod email_models;
pub mod email_providers;
pub mod error;
pub mod models;
pub mod session;
pub mod storage;
pub mod vault_ops;

use clipboard::ClipboardState;
use crypto::KdfParams;
use session::AppState;

/// Keeps the main window on the app's own pages (defence in depth: nothing in the UI should
/// ever navigate it elsewhere, e.g. a link inside an email).
fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(
            url.host_str(),
            Some("tauri.localhost") | Some("localhost") | Some("127.0.0.1")
        ),
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be the first plugin: a second launch focuses the running window instead of opening
    // the same vault twice.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
                .on_navigation(|_webview, url| {
                    let allowed = is_app_url(url);
                    if !allowed {
                        log::warn!("Blocked navigation to {}", url.scheme());
                    }
                    allowed
                })
                .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let path = app
                .path()
                .resolve("vault.json", BaseDirectory::AppLocalData)?;
            if let Some(parent) = path.parent() {
                storage::ensure_private_dir(parent)?;
            }
            storage::restrict_file_permissions(&path);

            app.manage(AppState::new(path, KdfParams::CURRENT));
            app.manage(ClipboardState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_exists,
            commands::get_default_service_types_list,
            commands::create_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::get_vault,
            // Settings
            commands::update_settings,
            commands::change_master_password,
            // Export/Import/Backups
            commands::export_vault,
            commands::import_vault,
            commands::list_backups,
            commands::restore_backup,
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
            commands::delete_accounts,
            commands::link_services_to_account,
            commands::unlink_services_from_account,
            commands::set_pinned,
            commands::bulk_create_accounts,
            // Clipboard
            commands::clipboard_copy,
            commands::clipboard_clear,
            // Email
            email_commands::is_email_provider_supported,
            email_commands::test_email_connection,
            email_commands::fetch_recent_emails
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // ExitRequested, not Exit: on Exit the clipboard plugin has already released its
            // handle (plugins see each event before this callback), and using it would panic.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                on_exit_requested(app);
            }
        });
}

/// Drops the decrypted session and clears a value the app copied and still owns on the
/// clipboard, so quitting before the auto-clear timer fires does not leave a secret behind.
fn on_exit_requested(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.lock();
    }
    if app.try_state::<ClipboardState>().is_none() {
        return;
    }
    // Reading the clipboard on the main thread can deadlock on Linux, so use a worker, and never
    // hold up the exit for long.
    let handle = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(clipboard::clear_if_owned(&handle));
    });
    match rx.recv_timeout(std::time::Duration::from_millis(500)) {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => log::warn!("Clipboard was not cleared on exit: {e}"),
        Err(_) => log::warn!("Clipboard was not cleared on exit: timed out"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_guard_allows_only_app_urls() {
        for ok in [
            "tauri://localhost/",
            "http://tauri.localhost/index.html",
            "http://localhost:5173/",
            "about:blank",
            "about:srcdoc",
        ] {
            assert!(is_app_url(&tauri::Url::parse(ok).unwrap()), "{ok}");
        }
        for bad in ["https://evil.example/", "http://localhost.evil.example/", "file:///etc/passwd", "ipc://localhost/x"] {
            assert!(!is_app_url(&tauri::Url::parse(bad).unwrap()), "{bad}");
        }
    }
}
