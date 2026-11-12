//! `session.rs`: the unlocked session and every operation that touches it. No Tauri types, so
//! the whole lifecycle (create, unlock, migrate, save, backups, import/export) is unit-testable.
//!
//! Locking rules:
//! - `inner` (the session) is held only for in-memory work plus the encrypt + atomic write of a
//!   save; never while a key is derived.
//! - `lifecycle` serialises the slow, key-deriving operations (create, unlock, password change,
//!   import, restore) so they cannot interleave with each other. It is always taken before
//!   `inner`.
//! - `lock()` takes neither guard for long: it bumps `lock_generation` and drops the session.
//!   Operations that install a session (create, unlock, restore) remember the generation when
//!   they start and refuse to install one if a lock arrived in the meantime, so a slow key
//!   derivation can never reopen a vault the user has just locked.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use log::{info, warn};
use zeroize::Zeroizing;

use crate::crypto::{self, KdfParams, SessionKey};
use crate::error::{CommandError, CommandResult, ErrorCode};
use crate::models::{BackupInfo, ImportResult, Settings, Vault};
use crate::storage;
use crate::vault_ops;

const UNLOCK_CANCELLED: &str = "The vault was locked again while it was being unlocked.";

pub struct Session {
    pub vault: Vault,
    pub key: SessionKey,
    /// Whether a backup snapshot was already taken during this session.
    pub first_write_done: bool,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.vault.wipe();
    }
}

pub struct AppState {
    inner: Mutex<Option<Session>>,
    lifecycle: Mutex<()>,
    /// Incremented by every `lock()`.
    lock_generation: AtomicU64,
    vault_path: PathBuf,
    kdf: KdfParams,
}

fn lock_ignoring_poison<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn new(vault_path: PathBuf, kdf: KdfParams) -> AppState {
        AppState {
            inner: Mutex::new(None),
            lifecycle: Mutex::new(()),
            lock_generation: AtomicU64::new(0),
            vault_path,
            kdf,
        }
    }

    pub fn vault_path(&self) -> &Path {
        &self.vault_path
    }

    fn session(&self) -> MutexGuard<'_, Option<Session>> {
        lock_ignoring_poison(&self.inner)
    }

    fn lifecycle(&self) -> MutexGuard<'_, ()> {
        lock_ignoring_poison(&self.lifecycle)
    }

    pub fn vault_exists(&self) -> CommandResult<bool> {
        storage::vault_exists(&self.vault_path)
    }

    pub fn is_unlocked(&self) -> bool {
        self.session().is_some()
    }

    pub fn get_vault(&self) -> CommandResult<Vault> {
        self.session()
            .as_ref()
            .map(|s| s.vault.clone())
            .ok_or_else(CommandError::vault_locked)
    }

    pub fn settings(&self) -> CommandResult<Settings> {
        self.session()
            .as_ref()
            .map(|s| s.vault.settings.clone())
            .ok_or_else(CommandError::vault_locked)
    }

    /// Idempotent: Ok when already locked. Also cancels a create/unlock/restore that is still
    /// deriving its key (see the module docs).
    pub fn lock(&self) {
        self.lock_generation.fetch_add(1, Ordering::SeqCst);
        let session = self.session().take();
        drop(session);
    }

    fn lock_generation(&self) -> u64 {
        self.lock_generation.load(Ordering::SeqCst)
    }

    /// Fails with VAULT_LOCKED when `lock()` ran after `started` was read. Call it with the
    /// `inner` guard held, right before installing a session.
    fn ensure_not_locked_since(&self, started: u64, message: &str) -> CommandResult<()> {
        if self.lock_generation() != started {
            return Err(CommandError::new(ErrorCode::VaultLocked, message));
        }
        Ok(())
    }

    pub fn create_vault(
        &self,
        password: &str,
        settings: Settings,
        selected_service_type_ids: &[String],
    ) -> CommandResult<Vault> {
        let started = self.lock_generation();
        let _lifecycle = self.lifecycle();
        if self.vault_exists()? {
            return Err(CommandError::new(
                ErrorCode::VaultExists,
                "A vault already exists on this device.",
            ));
        }
        if !crypto::password_long_enough(password) {
            return Err(CommandError::password_too_short());
        }
        let vault = vault_ops::new_vault(settings, selected_service_type_ids)?;
        let key = SessionKey::derive(password.as_bytes(), self.kdf)?;

        let mut guard = self.session();
        self.ensure_not_locked_since(
            started,
            "The app was locked while the vault was being created; no vault was created.",
        )?;
        if let Some(parent) = self.vault_path.parent() {
            storage::ensure_private_dir(parent)?;
        }
        storage::save_vault(&self.vault_path, &vault, &key)?;
        *guard = Some(Session {
            vault: vault.clone(),
            key,
            first_write_done: true,
        });
        Ok(vault)
    }

    /// Always verifies the password, also when the session is already unlocked.
    pub fn unlock(&self, password: &str) -> CommandResult<Vault> {
        self.unlock_since(password, self.lock_generation())
    }

    fn unlock_since(&self, password: &str, started: u64) -> CommandResult<Vault> {
        let _lifecycle = self.lifecycle();

        // Already unlocked: verify against the session key without touching the disk.
        let existing = self
            .session()
            .as_ref()
            .map(|s| (*s.key.salt(), s.key.params()));
        if let Some((salt, params)) = existing {
            let candidate = SessionKey::derive_with_salt(password.as_bytes(), salt, params)?;
            let guard = self.session();
            match guard.as_ref() {
                Some(session) if session.key.same_key_as(&candidate) => {
                    return Ok(session.vault.clone())
                }
                Some(_) => return Err(CommandError::invalid_password()),
                // Locked while the key was being derived: that lock wins.
                None => self.ensure_not_locked_since(started, UNLOCK_CANCELLED)?,
            }
        }

        let bytes = storage::read_file(&self.vault_path, ErrorCode::VaultNotFound)?;
        let opened = storage::open_vault_bytes(&bytes, password.as_bytes(), self.kdf)?;
        let mut vault = opened.vault;
        vault_ops::normalize(&mut vault);

        let mut key = opened.key;
        let mut first_write_done = false;
        if opened.needs_upgrade {
            match self.migrate(&vault, password) {
                Ok(new_key) => {
                    key = new_key;
                    first_write_done = true;
                }
                Err(e) => warn!("Vault format upgrade skipped: {e}"),
            }
        }

        let mut guard = self.session();
        self.ensure_not_locked_since(started, UNLOCK_CANCELLED)?;
        *guard = Some(Session {
            vault: vault.clone(),
            key,
            first_write_done,
        });
        Ok(vault)
    }

    /// Re-encrypts the vault with the current KDF parameters and a fresh salt, after taking a
    /// backup snapshot of the old file.
    fn migrate(&self, vault: &Vault, password: &str) -> CommandResult<SessionKey> {
        let new_key = SessionKey::derive(password.as_bytes(), self.kdf)?;
        storage::snapshot(&self.vault_path)?;
        storage::save_vault(&self.vault_path, vault, &new_key)?;
        info!("Vault upgraded to the current format.");
        Ok(new_key)
    }

    /// Transactional mutation: the change is applied to a clone, validated, written to disk and
    /// only then committed to memory. On any error nothing changes.
    pub fn mutate<T>(
        &self,
        change: impl FnOnce(&mut Vault) -> CommandResult<T>,
    ) -> CommandResult<(Vault, T)> {
        let mut guard = self.session();
        let session = guard.as_mut().ok_or_else(CommandError::vault_locked)?;
        let mut next = session.vault.clone();
        let output = change(&mut next)?;
        vault_ops::check_integrity(&next)?;
        if !session.first_write_done {
            storage::snapshot(&self.vault_path)?;
        }
        storage::save_vault(&self.vault_path, &next, &session.key)?;
        session.first_write_done = true;
        session.vault = next;
        Ok((session.vault.clone(), output))
    }

    pub fn change_master_password(&self, old_password: &str, new_password: &str) -> CommandResult<()> {
        let _lifecycle = self.lifecycle();
        if !crypto::password_long_enough(new_password) {
            return Err(CommandError::password_too_short());
        }
        let (salt, params) = self
            .session()
            .as_ref()
            .map(|s| (*s.key.salt(), s.key.params()))
            .ok_or_else(CommandError::vault_locked)?;
        let old_key = SessionKey::derive_with_salt(old_password.as_bytes(), salt, params)?;
        let new_key = SessionKey::derive(new_password.as_bytes(), self.kdf)?;

        let mut guard = self.session();
        let session = guard.as_mut().ok_or_else(CommandError::vault_locked)?;
        if !session.key.same_key_as(&old_key) {
            return Err(CommandError::invalid_password());
        }
        storage::snapshot(&self.vault_path)?;
        storage::save_vault(&self.vault_path, &session.vault, &new_key)?;
        session.key = new_key;
        session.first_write_done = true;
        Ok(())
    }

    /// Encrypts the current vault with `password` (not the master password) into `export_path`,
    /// then reads the file back and decrypts it to verify it.
    pub fn export_vault(&self, export_path: &Path, password: &str) -> CommandResult<()> {
        if !crypto::password_long_enough(password) {
            return Err(CommandError::password_too_short());
        }
        let vault = self.get_vault()?;
        self.check_export_target(export_path)?;

        let key = SessionKey::derive(password.as_bytes(), self.kdf)?;
        let bytes = storage::encode_vault(&vault, &key)?;
        storage::atomic_write(export_path, &bytes)?;
        storage::restrict_file_permissions(export_path);

        let written = storage::read_file(export_path, ErrorCode::Io)?;
        let reopened = storage::open_vault_bytes(&written, password.as_bytes(), self.kdf)
            .map_err(|e| CommandError::new(ErrorCode::Io, format!("The export could not be verified: {e}")))?;
        if reopened.vault != vault {
            return Err(CommandError::new(
                ErrorCode::Io,
                "The export could not be verified: the written data differs.",
            ));
        }
        info!("Vault exported to {}", export_path.display());
        Ok(())
    }

    /// Refuses targets that would destroy something: the live vault, the backups folder, or an
    /// existing file that is not an AccMan vault.
    fn check_export_target(&self, export_path: &Path) -> CommandResult<()> {
        if !export_path.is_absolute() || export_path.file_name().is_none() {
            return Err(CommandError::validation("The export path must be an absolute file path."));
        }
        let folder_missing = || CommandError::validation("The export folder does not exist.");
        let canonical_parent = export_path
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .ok_or_else(folder_missing)?;
        // atomic_write writes through a symlink, so check where a link at the target points.
        let target =
            storage::resolve_symlinks(&canonical_parent.join(export_path.file_name().unwrap_or_default()));
        let target_parent = target
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .ok_or_else(folder_missing)?;
        // Compare by identity, not by spelling: case-insensitive file systems, symlinks and hard
        // links can all name the live vault or the backups folder differently. No export belongs
        // directly in the app's data folder.
        let backups = storage::backups_dir(&self.vault_path);
        let in_data_dir = self
            .vault_path
            .parent()
            .is_some_and(|data_dir| storage::same_entry(&target_parent, data_dir));
        let in_backups = target_parent
            .ancestors()
            .any(|dir| storage::same_entry(dir, &backups));
        if in_data_dir || in_backups || storage::same_entry(&target, &self.vault_path) {
            return Err(CommandError::validation(
                "Choose a location outside the app's data folder for the export.",
            ));
        }
        if target.is_dir() {
            return Err(CommandError::validation("The export path is a folder."));
        }
        if target.exists() {
            let existing = storage::read_file(&target, ErrorCode::Io)?;
            if crypto::Envelope::parse(&existing).is_err() {
                return Err(CommandError::validation(
                    "Refusing to overwrite a file that is not an AccMan backup.",
                ));
            }
        }
        Ok(())
    }

    pub fn import_vault(&self, import_path: &Path, password: &str, strategy: &str) -> CommandResult<ImportResult> {
        if strategy != "merge" && strategy != "replace" {
            return Err(CommandError::validation(format!(
                "Unknown import strategy '{strategy}': expected 'merge' or 'replace'."
            )));
        }
        let _lifecycle = self.lifecycle();
        if !self.is_unlocked() {
            return Err(CommandError::vault_locked());
        }
        let bytes = storage::read_file(import_path, ErrorCode::Io)?;
        let imported = storage::open_vault_bytes(&bytes, password.as_bytes(), self.kdf)?.vault;

        let mut guard = self.session();
        let session = guard.as_mut().ok_or_else(CommandError::vault_locked)?;
        let mut next = session.vault.clone();
        let summary = vault_ops::import_vault(&mut next, imported, strategy)?;
        vault_ops::check_integrity(&next)?;
        storage::snapshot(&self.vault_path)?;
        storage::save_vault(&self.vault_path, &next, &session.key)?;
        session.vault = next;
        session.first_write_done = true;
        Ok(ImportResult {
            vault: session.vault.clone(),
            summary,
        })
    }

    pub fn list_backups(&self) -> CommandResult<Vec<BackupInfo>> {
        storage::list_backups(&self.vault_path)
    }

    /// Restores a backup snapshot as the main vault and leaves the session unlocked with it.
    /// The backup's password becomes the master password.
    ///
    /// If `lock()` runs while the backup is being decrypted, the restore is cancelled with
    /// VAULT_LOCKED before anything is written. If it runs after the restored file was written,
    /// the file stays restored and the new session is dropped by that lock.
    pub fn restore_backup(&self, file_name: &str, password: &str) -> CommandResult<Vault> {
        self.restore_backup_since(file_name, password, self.lock_generation())
    }

    fn restore_backup_since(&self, file_name: &str, password: &str, started: u64) -> CommandResult<Vault> {
        let _lifecycle = self.lifecycle();
        let backup_path = storage::resolve_backup(&self.vault_path, file_name)?;
        let bytes = storage::read_file(&backup_path, ErrorCode::BackupNotFound)?;
        let opened = storage::open_vault_bytes(&bytes, password.as_bytes(), self.kdf)?;
        let mut vault = opened.vault;
        vault_ops::normalize(&mut vault);
        let key = if opened.needs_upgrade {
            SessionKey::derive(password.as_bytes(), self.kdf)?
        } else {
            opened.key
        };

        let mut guard = self.session();
        self.ensure_not_locked_since(
            started,
            "The vault was locked while the backup was being restored; nothing was changed.",
        )?;
        storage::snapshot(&self.vault_path)?;
        storage::save_vault(&self.vault_path, &vault, &key)?;
        *guard = Some(Session {
            vault: vault.clone(),
            key,
            first_write_done: true,
        });
        info!("Vault restored from backup {file_name}");
        Ok(vault)
    }
}

/// Wraps a password received over IPC so it is wiped when dropped.
pub fn secret(value: String) -> Zeroizing<String> {
    Zeroizing::new(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::tests::{legacy_v1_file, TEST_PARAMS};
    use crate::models::{Account, Service};
    use crate::storage::tests::TempDir;
    use std::fs;

    const PW: &str = "master-password";

    fn state(dir: &TempDir) -> AppState {
        AppState::new(dir.path().join("vault.json"), TEST_PARAMS)
    }

    fn add_account(state: &AppState, id: &str) -> Vault {
        state
            .mutate(|v| {
                vault_ops::add_account(
                    v,
                    Account { id: id.into(), label: format!("Account {id}"), ..Default::default() },
                    1,
                )
            })
            .unwrap()
            .0
    }

    #[test]
    fn create_unlock_lock_cycle() {
        let dir = TempDir::new("cycle");
        let st = state(&dir);
        assert!(!st.vault_exists().unwrap());
        assert_eq!(st.get_vault().unwrap_err().code, ErrorCode::VaultLocked);
        assert_eq!(
            st.create_vault("short", Settings::default(), &[]).unwrap_err().code,
            ErrorCode::PasswordTooShort
        );
        let created = st.create_vault(PW, Settings::default(), &["email".into()]).unwrap();
        assert_eq!(created.service_types.len(), 1);
        assert_eq!(
            st.create_vault(PW, Settings::default(), &[]).unwrap_err().code,
            ErrorCode::VaultExists
        );

        add_account(&st, "a1");
        st.lock();
        st.lock(); // idempotent
        assert!(!st.is_unlocked());
        assert_eq!(
            st.mutate(|_| Ok(())).unwrap_err().code,
            ErrorCode::VaultLocked
        );
        // A locked vault file can never be overwritten by create.
        assert_eq!(
            st.create_vault(PW, Settings::default(), &[]).unwrap_err().code,
            ErrorCode::VaultExists
        );

        assert_eq!(st.unlock("wrong-password").unwrap_err().code, ErrorCode::InvalidPassword);
        let vault = st.unlock(PW).unwrap();
        assert_eq!(vault.accounts.len(), 1);
    }

    #[test]
    fn unlock_verifies_password_when_already_unlocked() {
        let dir = TempDir::new("reunlock");
        let st = state(&dir);
        st.create_vault(PW, Settings::default(), &[]).unwrap();
        assert!(st.is_unlocked());
        assert_eq!(st.unlock("anything-else").unwrap_err().code, ErrorCode::InvalidPassword);
        assert!(st.unlock(PW).is_ok());
    }

    #[test]
    fn unlock_missing_vault() {
        let dir = TempDir::new("nofile");
        assert_eq!(state(&dir).unlock(PW).unwrap_err().code, ErrorCode::VaultNotFound);
    }

    #[test]
    fn failed_mutation_changes_nothing() {
        let dir = TempDir::new("txn");
        let st = state(&dir);
        st.create_vault(PW, Settings::default(), &[]).unwrap();
        add_account(&st, "a1");
        let disk_before = fs::read(st.vault_path()).unwrap();
        let mem_before = st.get_vault().unwrap();

        let err = st
            .mutate(|v| {
                v.accounts.clear();
                vault_ops::delete_account(v, "missing")
            })
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::AccountNotFound);
        assert_eq!(st.get_vault().unwrap(), mem_before);
        assert_eq!(fs::read(st.vault_path()).unwrap(), disk_before);

        // Integrity violations introduced by a change are rejected too.
        let err = st
            .mutate(|v| {
                let dup = v.accounts[0].clone();
                v.accounts.push(dup);
                Ok(())
            })
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::DuplicateId);
        assert_eq!(st.get_vault().unwrap(), mem_before);
    }

    #[test]
    fn save_failure_rolls_back_memory() {
        let dir = TempDir::new("savefail");
        let st = state(&dir);
        st.create_vault(PW, Settings::default(), &[]).unwrap();
        // Make the atomic write fail: a directory occupies the temp file name.
        fs::create_dir(dir.path().join("vault.json.tmp")).unwrap();
        let err = st.mutate(|v| vault_ops::add_account(v, Account { id: "a".into(), label: "A".into(), ..Default::default() }, 1));
        assert_eq!(err.unwrap_err().code, ErrorCode::Io);
        assert!(st.get_vault().unwrap().accounts.is_empty());
    }

    #[test]
    fn first_write_of_session_takes_one_snapshot() {
        let dir = TempDir::new("firstwrite");
        let st = state(&dir);
        st.create_vault(PW, Settings::default(), &[]).unwrap();
        st.lock();
        st.unlock(PW).unwrap();
        assert!(st.list_backups().unwrap().is_empty());
        add_account(&st, "a1");
        assert_eq!(st.list_backups().unwrap().len(), 1);
        add_account(&st, "a2");
        assert_eq!(st.list_backups().unwrap().len(), 1);
    }

    #[test]
    fn legacy_v1_file_is_migrated_on_unlock() {
        let dir = TempDir::new("migrate");
        let st = state(&dir);
        let legacy_json = r#"{
            "version": "0.2.0",
            "serviceTypes": [{"id":"discord","name":"Discord","icon":"X","fields":[
                {"id":"d-7","key":"2fa_key","label":"2FA Key","type":"secret","masked":true,"required":false}
            ]}],
            "services": [{"id":"s1","serviceTypeId":"discord","label":"D1","data":{"2fa_key":"JBSWY3DP"},"tags":[]}],
            "accounts": [{"id":"a1","label":"A","notes":"","tags":[],"linkedServices":["s1","s1","ghost"]}],
            "settings": {"autoLockMinutes": 5}
        }"#;
        fs::write(st.vault_path(), legacy_v1_file(legacy_json.as_bytes(), PW)).unwrap();

        assert_eq!(st.unlock("bad-password").unwrap_err().code, ErrorCode::InvalidPassword);
        let vault = st.unlock(PW).unwrap();
        assert_eq!(vault.version, "0.3.0");
        assert_eq!(vault.service_types[0].fields[0].field_type, "2fa");
        assert_eq!(vault.accounts[0].linked_services, vec!["s1".to_string()]);
        assert_eq!(vault.settings.auto_lock_minutes, 5);

        // The old file was backed up and the vault rewritten in format 2 with the target KDF.
        let backups = st.list_backups().unwrap();
        assert_eq!(backups.len(), 1);
        let backup = fs::read(storage::backups_dir(st.vault_path()).join(&backups[0].file_name)).unwrap();
        assert!(crypto::decrypt(&backup, PW.as_bytes()).unwrap().format == 1);
        let migrated = fs::read(st.vault_path()).unwrap();
        let envelope = crypto::Envelope::parse(&migrated).unwrap();
        assert_eq!(envelope.format, 2);
        assert_eq!(envelope.params, TEST_PARAMS);

        // Unlocking again works and needs no further migration or snapshot.
        st.lock();
        let again = st.unlock(PW).unwrap();
        assert_eq!(again, vault);
        assert_eq!(st.list_backups().unwrap().len(), 1);
    }

    #[test]
    fn change_master_password() {
        let dir = TempDir::new("chpw");
        let st = state(&dir);
        st.create_vault(PW, Settings::default(), &[]).unwrap();
        assert_eq!(
            st.change_master_password("not-it-at-all", "new-password-1").unwrap_err().code,
            ErrorCode::InvalidPassword
        );
        assert_eq!(
            st.change_master_password(PW, "short").unwrap_err().code,
            ErrorCode::PasswordTooShort
        );
        st.change_master_password(PW, "new-password-1").unwrap();
        assert_eq!(st.list_backups().unwrap().len(), 1);
        // Later saves use the new key.
        add_account(&st, "a1");
        st.lock();
        assert_eq!(st.unlock(PW).unwrap_err().code, ErrorCode::InvalidPassword);
        assert_eq!(st.unlock("new-password-1").unwrap().accounts.len(), 1);
    }

    #[test]
    fn export_uses_its_own_password_and_import_merges() {
        let dir = TempDir::new("export");
        let st = state(&dir);
        st.create_vault(PW, Settings::default(), &["email".into()]).unwrap();
        add_account(&st, "a1");
        let export = dir.path().join("out").join("backup.json");
        fs::create_dir(dir.path().join("out")).unwrap();

        assert_eq!(st.export_vault(&export, "short").unwrap_err().code, ErrorCode::PasswordTooShort);
        st.export_vault(&export, "export-password").unwrap();
        // Overwriting an earlier export is fine.
        st.export_vault(&export, "export-password").unwrap();
        let bytes = fs::read(&export).unwrap();
        assert_eq!(
            crypto::decrypt(&bytes, PW.as_bytes()).err(),
            Some(crypto::CryptoError::InvalidPassword)
        );
        assert!(crypto::decrypt(&bytes, b"export-password").is_ok());

        // Refuses to clobber the live vault or a non-vault file.
        assert_eq!(
            st.export_vault(st.vault_path(), "export-password").unwrap_err().code,
            ErrorCode::Validation
        );
        let other = dir.path().join("out").join("notes.txt");
        fs::write(&other, b"important").unwrap();
        assert_eq!(st.export_vault(&other, "export-password").unwrap_err().code, ErrorCode::Validation);
        assert_eq!(fs::read(&other).unwrap(), b"important");

        // Import into a second vault.
        let dir2 = TempDir::new("import");
        let st2 = state(&dir2);
        st2.create_vault("other-password", Settings { auto_lock_minutes: 1, clipboard_clear_seconds: 10 }, &[])
            .unwrap();
        add_account(&st2, "b1");
        assert_eq!(
            st2.import_vault(&export, "wrong-password", "merge").unwrap_err().code,
            ErrorCode::InvalidPassword
        );
        assert_eq!(
            st2.import_vault(&export, "export-password", "mix").unwrap_err().code,
            ErrorCode::Validation
        );
        let result = st2.import_vault(&export, "export-password", "merge").unwrap();
        assert_eq!(result.summary.accounts_added, 1);
        assert_eq!(result.summary.service_types_added, 1);
        assert_eq!(result.vault.accounts.len(), 2);
        assert_eq!(result.vault.settings.auto_lock_minutes, 1);
        // A snapshot was taken and the master password did not change.
        assert!(!st2.list_backups().unwrap().is_empty());
        st2.lock();
        assert_eq!(st2.unlock("other-password").unwrap().accounts.len(), 2);

        let replaced = st2.import_vault(&export, "export-password", "replace").unwrap();
        assert_eq!(replaced.vault.accounts.len(), 1);
        assert_eq!(replaced.vault.settings.auto_lock_minutes, 1);
    }

    #[test]
    fn export_refuses_the_data_folder_by_identity() {
        let dir = TempDir::new("exportguard");
        let st = state(&dir);
        st.create_vault(PW, Settings::default(), &[]).unwrap();
        add_account(&st, "a1");
        st.change_master_password(PW, "second-password").unwrap(); // creates backups/
        let vault_before = fs::read(st.vault_path()).unwrap();
        let out = dir.path().join("out");
        fs::create_dir(&out).unwrap();
        let refused = |path: &Path| {
            assert_eq!(
                st.export_vault(path, "export-password").unwrap_err().code,
                ErrorCode::Validation,
                "{}",
                path.display()
            );
        };
        // Another spelling of the vault (as on a case-insensitive file system) or any other
        // file directly in the data folder.
        refused(&dir.path().join("Vault.json"));
        refused(&dir.path().join("export.json"));
        refused(&out.join("..").join("vault.json"));
        // Anything inside backups/, also in a subfolder.
        let nested = storage::backups_dir(st.vault_path()).join("nested");
        fs::create_dir(&nested).unwrap();
        refused(&nested.join("x.json"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            // A symlink to the vault, a hard link to it, and a link to the backups folder.
            symlink(st.vault_path(), out.join("link.json")).unwrap();
            refused(&out.join("link.json"));
            fs::hard_link(st.vault_path(), out.join("hard.json")).unwrap();
            refused(&out.join("hard.json"));
            symlink(storage::backups_dir(st.vault_path()), out.join("b")).unwrap();
            refused(&out.join("b").join("x.json"));
            // A plain file elsewhere is fine.
            st.export_vault(&out.join("ok.json"), "export-password").unwrap();
        }
        assert_eq!(fs::read(st.vault_path()).unwrap(), vault_before);
    }

    #[test]
    fn unwritable_backups_folder_blocks_saves_with_a_clear_error() {
        let dir = TempDir::new("nobackups");
        let st = state(&dir);
        st.create_vault(PW, Settings::default(), &[]).unwrap();
        st.lock();
        st.unlock(PW).unwrap();
        fs::write(storage::backups_dir(st.vault_path()), b"not a folder").unwrap();
        let disk_before = fs::read(st.vault_path()).unwrap();
        let err = st
            .mutate(|v| vault_ops::add_account(v, Account { id: "a".into(), label: "A".into(), ..Default::default() }, 1))
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::Io);
        assert!(err.message.contains("backups folder"), "{}", err.message);
        assert!(st.get_vault().unwrap().accounts.is_empty());
        assert_eq!(fs::read(st.vault_path()).unwrap(), disk_before);
    }

    #[test]
    fn lock_during_restore_or_unlock_wins() {
        let dir = TempDir::new("lockrace");
        let st = state(&dir);
        st.create_vault(PW, Settings::default(), &[]).unwrap();
        st.lock();
        st.unlock(PW).unwrap();
        add_account(&st, "a1"); // first write: snapshot of the empty vault
        let backup = st.list_backups().unwrap()[0].file_name.clone();
        let disk_before = fs::read(st.vault_path()).unwrap();

        // A lock arrives while the restore derives its key: nothing is written or unlocked.
        let started = st.lock_generation();
        st.lock();
        let err = st.restore_backup_since(&backup, PW, started).unwrap_err();
        assert_eq!(err.code, ErrorCode::VaultLocked);
        assert!(!st.is_unlocked());
        assert_eq!(fs::read(st.vault_path()).unwrap(), disk_before);
        assert_eq!(st.list_backups().unwrap().len(), 1);

        // The same for unlock (e.g. a webview reload locks while an unlock is in flight).
        let started = st.lock_generation();
        st.lock();
        assert_eq!(st.unlock_since(PW, started).unwrap_err().code, ErrorCode::VaultLocked);
        assert!(!st.is_unlocked());

        // Without an intervening lock both work.
        assert_eq!(st.unlock(PW).unwrap().accounts.len(), 1);
        assert!(st.restore_backup(&backup, PW).unwrap().accounts.is_empty());
        assert!(st.is_unlocked());
    }

    #[test]
    fn import_requires_unlocked_vault() {
        let dir = TempDir::new("importlocked");
        let st = state(&dir);
        let err = st.import_vault(&dir.path().join("x.json"), PW, "merge").unwrap_err();
        assert_eq!(err.code, ErrorCode::VaultLocked);
    }

    #[test]
    fn restore_backup_while_locked_and_unlocked() {
        let dir = TempDir::new("restore");
        let st = state(&dir);
        st.create_vault(PW, Settings::default(), &[]).unwrap();
        add_account(&st, "a1");
        // A backup exists from before the password change (old password, one account).
        st.change_master_password(PW, "second-password").unwrap();
        st.mutate(|v| {
            vault_ops::add_service_type(
                v,
                crate::models::ServiceType { id: "t".into(), name: "T".into(), icon: String::new(), fields: vec![] },
            )
        })
        .unwrap();
        st.mutate(|v| {
            vault_ops::add_service(
                v,
                Service { id: "s".into(), service_type_id: "t".into(), label: "S".into(), ..Default::default() },
                None,
                1,
            )
        })
        .unwrap();
        let backups = st.list_backups().unwrap();
        let oldest = backups.last().unwrap().file_name.clone();

        st.lock();
        assert_eq!(st.restore_backup(&oldest, "second-password").unwrap_err().code, ErrorCode::InvalidPassword);
        assert_eq!(st.restore_backup("../vault.json", PW).unwrap_err().code, ErrorCode::Validation);
        assert_eq!(st.restore_backup("vault-1.json", PW).unwrap_err().code, ErrorCode::BackupNotFound);

        let restored = st.restore_backup(&oldest, PW).unwrap();
        assert!(st.is_unlocked());
        assert_eq!(restored.accounts.len(), 1);
        assert!(restored.services.is_empty());
        // The backup's password is now the master password.
        st.lock();
        assert_eq!(st.unlock("second-password").unwrap_err().code, ErrorCode::InvalidPassword);
        assert_eq!(st.unlock(PW).unwrap(), restored);
        // Restoring while unlocked works too.
        assert!(st.restore_backup(&oldest, PW).is_ok());
    }

    #[test]
    fn corrupted_vault_file_reports_corruption() {
        let dir = TempDir::new("corrupt");
        let st = state(&dir);
        fs::write(st.vault_path(), b"{\"salt\":\"AAAA\",\"ciphertext\":[1,2]}").unwrap();
        assert_eq!(st.unlock(PW).unwrap_err().code, ErrorCode::VaultCorrupted);
        fs::write(st.vault_path(), b"").unwrap();
        assert_eq!(st.unlock(PW).unwrap_err().code, ErrorCode::VaultCorrupted);
        fs::write(st.vault_path(), b"{\"format\":9}").unwrap();
        assert_eq!(st.unlock(PW).unwrap_err().code, ErrorCode::UnsupportedVaultVersion);
    }
}
