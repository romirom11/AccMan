//! `storage.rs`: vault files on disk (atomic writes, encoding, backups). No Tauri types.

use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use log::{info, warn};
use zeroize::Zeroizing;

use crate::crypto::{self, SessionKey};
use crate::error::{CommandError, CommandResult, ErrorCode};
use crate::models::{BackupInfo, Vault};

pub const BACKUP_DIR_NAME: &str = "backups";
pub const MAX_BACKUPS: usize = 15;
const BACKUP_PREFIX: &str = "vault-";
const BACKUP_SUFFIX: &str = ".json";

// --- Paths and permissions ---

pub fn vault_exists(path: &Path) -> CommandResult<bool> {
    path.try_exists()
        .map_err(|e| CommandError::io("Could not check the vault file", &e))
}

/// Creates `dir` (and parents) if missing; on Unix the directory is restricted to the owner.
/// Fails when something that is not a folder already occupies the path.
pub fn ensure_private_dir(dir: &Path) -> CommandResult<()> {
    if dir.exists() {
        if !dir.is_dir() {
            return Err(CommandError::new(
                ErrorCode::Io,
                format!("'{}' exists but is not a folder.", dir.display()),
            ));
        }
    } else {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(dir)
            .map_err(|e| CommandError::io(&format!("Could not create the folder '{}'", dir.display()), &e))?;
    }
    Ok(())
}

/// Tightens the permissions of an existing file to owner read/write (Unix only).
pub fn restrict_file_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path.exists() {
            if let Err(e) = fs::set_permissions(path, fs::Permissions::from_mode(0o600)) {
                warn!("Could not restrict permissions of {}: {e}", path.display());
            }
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Follows a chain of symbolic links (also a dangling one) to the path a write should go to.
/// Relative link targets are resolved against the link's folder. Paths that are not links are
/// returned unchanged.
pub fn resolve_symlinks(path: &Path) -> PathBuf {
    const MAX_HOPS: usize = 40;
    let mut current = path.to_path_buf();
    for _ in 0..MAX_HOPS {
        let is_link = fs::symlink_metadata(&current).is_ok_and(|m| m.file_type().is_symlink());
        if !is_link {
            break;
        }
        let Ok(link) = fs::read_link(&current) else { break };
        current = if link.is_absolute() {
            link
        } else {
            current.parent().unwrap_or_else(|| Path::new(".")).join(link)
        };
    }
    current
}

/// Whether two paths name the same existing file or folder (links are followed). On Unix the
/// file identity is compared, which also catches hard links and case-insensitive file systems;
/// elsewhere the canonical paths are compared, ignoring case.
pub fn same_entry(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::metadata(a), fs::metadata(b)) {
            (Ok(ma), Ok(mb)) => ma.dev() == mb.dev() && ma.ino() == mb.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        match (a.canonicalize(), b.canonicalize()) {
            (Ok(ca), Ok(cb)) => {
                ca == cb || ca.to_string_lossy().to_lowercase() == cb.to_string_lossy().to_lowercase()
            }
            _ => false,
        }
    }
}

/// Writes `bytes` to `path` crash-safely: `<name>.tmp` in the same directory (0600 on Unix),
/// fsync, rename over the target, fsync the directory (Unix). When `path` is a symbolic link the
/// link is kept and its target is replaced (so a vault linked into a synced folder keeps syncing).
pub fn atomic_write(path: &Path, bytes: &[u8]) -> CommandResult<()> {
    let resolved = resolve_symlinks(path);
    let path = resolved.as_path();
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .ok_or_else(|| CommandError::validation("The target path has no file name."))?;
    let mut tmp_name = file_name.to_os_string();
    tmp_name.push(".tmp");
    let tmp_path = dir.join(tmp_name);

    let result = (|| -> std::io::Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp_path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        rename_with_retry(&tmp_path, path)?;
        #[cfg(unix)]
        {
            if let Ok(dir_handle) = File::open(dir) {
                let _ = dir_handle.sync_all();
            }
        }
        Ok(())
    })();

    if let Err(e) = result {
        let _ = fs::remove_file(&tmp_path);
        return Err(CommandError::io("Could not write the file", &e));
    }
    Ok(())
}

fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    // On Windows an antivirus or indexer can briefly hold the target open.
    let mut attempt = 0;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if attempt < 3 && cfg!(windows) && e.kind() == ErrorKind::PermissionDenied => {
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(e),
        }
    }
}

pub fn read_file(path: &Path, missing: ErrorCode) -> CommandResult<Vec<u8>> {
    fs::read(path).map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            CommandError::new(missing, format!("File not found: {}", path.display()))
        } else {
            CommandError::io("Could not read the file", &e)
        }
    })
}

// --- Encoding ---

/// Serialises and encrypts a vault with an already derived key (no KDF).
pub fn encode_vault(vault: &Vault, key: &SessionKey) -> CommandResult<Vec<u8>> {
    let plaintext = Zeroizing::new(
        serde_json::to_vec(vault)
            .map_err(|_| CommandError::internal("Could not serialise the vault."))?,
    );
    Ok(crypto::encrypt(&plaintext, key)?)
}

/// Parses decrypted vault JSON. Parse errors are not echoed (they can contain vault contents).
pub fn decode_vault(plaintext: &[u8]) -> CommandResult<Vault> {
    serde_json::from_slice(plaintext).map_err(|e| {
        warn!("Decrypted vault payload could not be parsed (line {}, column {})", e.line(), e.column());
        CommandError::corrupted("the decrypted data is not a valid vault")
    })
}

/// A vault decrypted from file bytes.
pub struct OpenedVault {
    pub vault: Vault,
    pub key: SessionKey,
    /// The file is v1 or uses weaker KDF parameters than `target` and should be re-encrypted.
    pub needs_upgrade: bool,
}

/// Decrypts file bytes with a password (runs the KDF).
pub fn open_vault_bytes(
    bytes: &[u8],
    password: &[u8],
    target: crypto::KdfParams,
) -> CommandResult<OpenedVault> {
    let decrypted = crypto::decrypt(bytes, password)?;
    let vault = decode_vault(&decrypted.plaintext)?;
    let needs_upgrade = decrypted.format < crypto::FORMAT_V2
        || decrypted.key.params().is_weaker_than(&target);
    Ok(OpenedVault {
        vault,
        key: decrypted.key,
        needs_upgrade,
    })
}

pub fn save_vault(path: &Path, vault: &Vault, key: &SessionKey) -> CommandResult<()> {
    let bytes = encode_vault(vault, key)?;
    atomic_write(path, &bytes)?;
    info!("Vault saved to {}", path.display());
    Ok(())
}

// --- Backups ---

pub fn backups_dir(vault_path: &Path) -> PathBuf {
    vault_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(BACKUP_DIR_NAME)
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Parses `vault-<unix_seconds>.json`; returns the timestamp.
fn parse_backup_name(name: &str) -> Option<u64> {
    let digits = name.strip_prefix(BACKUP_PREFIX)?.strip_suffix(BACKUP_SUFFIX)?;
    if digits.is_empty() || digits.len() > 20 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// Copies the current vault file into `backups/` (if it exists). Returns the backup file name.
pub fn snapshot(vault_path: &Path) -> CommandResult<Option<String>> {
    snapshot_at(vault_path, now_secs())
}

/// Same as [`snapshot`] with an explicit timestamp. At most one snapshot per second is kept;
/// a second call within the same second is a no-op.
pub fn snapshot_at(vault_path: &Path, unix_secs: u64) -> CommandResult<Option<String>> {
    let bytes = match fs::read(vault_path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(CommandError::io("Could not read the vault for a backup", &e)),
    };
    let dir = backups_dir(vault_path);
    let backup_error = |e: CommandError| {
        CommandError::new(
            ErrorCode::Io,
            format!(
                "Could not create a backup in the backups folder '{}', so nothing was saved: {}",
                dir.display(),
                e.message
            ),
        )
    };
    ensure_private_dir(&dir).map_err(backup_error)?;
    let name = format!("{BACKUP_PREFIX}{unix_secs}{BACKUP_SUFFIX}");
    let target = dir.join(&name);
    if target.exists() {
        return Ok(Some(name));
    }
    atomic_write(&target, &bytes).map_err(backup_error)?;
    info!("Backup snapshot written: {name}");
    prune_backups_except(&dir, MAX_BACKUPS, Some(&name));
    Ok(Some(name))
}

fn backup_entries(dir: &Path) -> CommandResult<Vec<(u64, String, u64)>> {
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(CommandError::io("Could not list backups", &e)),
    };
    let mut entries = Vec::new();
    for entry in read_dir.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(ts) = parse_backup_name(&name) else {
            continue;
        };
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        entries.push((ts, name, meta.len()));
    }
    // Newest first.
    entries.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    Ok(entries)
}

/// Deletes all but the newest `keep` snapshots. Errors are logged, not returned.
pub fn prune_backups(dir: &Path, keep: usize) {
    prune_backups_except(dir, keep, None);
}

/// Like [`prune_backups`], but `protect` (the snapshot just written) is never deleted and counts
/// as one of the kept ones, even when it sorts as the oldest (the clock went backwards).
fn prune_backups_except(dir: &Path, keep: usize, protect: Option<&str>) {
    match backup_entries(dir) {
        Ok(entries) => {
            let protected = entries
                .iter()
                .any(|(_, name, _)| Some(name.as_str()) == protect);
            let others = keep.saturating_sub(usize::from(protected));
            let to_delete = entries
                .into_iter()
                .filter(|(_, name, _)| Some(name.as_str()) != protect)
                .skip(others);
            for (_, name, _) in to_delete {
                if let Err(e) = fs::remove_file(dir.join(&name)) {
                    warn!("Could not delete old backup {name}: {e}");
                }
            }
        }
        Err(e) => warn!("Could not prune backups: {e}"),
    }
}

pub fn list_backups(vault_path: &Path) -> CommandResult<Vec<BackupInfo>> {
    Ok(backup_entries(&backups_dir(vault_path))?
        .into_iter()
        .map(|(ts, file_name, size)| BackupInfo {
            file_name,
            created_at: ts.saturating_mul(1000),
            size_bytes: size,
        })
        .collect())
}

/// Validates a backup file name received from the frontend and returns its full path.
pub fn resolve_backup(vault_path: &Path, file_name: &str) -> CommandResult<PathBuf> {
    if file_name.contains(['/', '\\']) || file_name.contains("..") || parse_backup_name(file_name).is_none() {
        return Err(CommandError::validation("Invalid backup file name."));
    }
    let path = backups_dir(vault_path).join(file_name);
    match path.try_exists() {
        Ok(true) if path.is_file() => Ok(path),
        Ok(_) => Err(CommandError::new(
            ErrorCode::BackupNotFound,
            format!("Backup '{file_name}' not found."),
        )),
        Err(e) => Err(CommandError::io("Could not access the backup", &e)),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::crypto::tests::TEST_PARAMS;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A unique, empty directory under the system temp dir, removed on drop.
    pub struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new(tag: &str) -> TempDir {
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let path = std::env::temp_dir().join(format!(
                "accman-test-{tag}-{}-{}-{}",
                std::process::id(),
                now_millis(),
                COUNTER.fetch_add(1, Ordering::SeqCst)
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }

        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample_vault() -> Vault {
        let mut v = Vault::default();
        v.accounts.push(crate::models::Account {
            id: "a1".into(),
            label: "Main".into(),
            ..Default::default()
        });
        v
    }

    #[test]
    fn atomic_save_and_reload() {
        let dir = TempDir::new("save");
        let path = dir.path().join("vault.json");
        let key = SessionKey::derive(b"password1", TEST_PARAMS).unwrap();
        save_vault(&path, &sample_vault(), &key).unwrap();
        // Overwrite works and leaves no temp file behind.
        let mut changed = sample_vault();
        changed.accounts[0].label = "Changed".into();
        save_vault(&path, &changed, &key).unwrap();
        assert!(!dir.path().join("vault.json.tmp").exists());

        let bytes = read_file(&path, ErrorCode::VaultNotFound).unwrap();
        let opened = open_vault_bytes(&bytes, b"password1", TEST_PARAMS).unwrap();
        assert_eq!(opened.vault, changed);
        assert!(!opened.needs_upgrade);
        assert!(opened.key.same_key_as(&key));

        let wrong = open_vault_bytes(&bytes, b"password2", TEST_PARAMS).err().unwrap();
        assert_eq!(wrong.code, ErrorCode::InvalidPassword);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn missing_vault_is_vault_not_found() {
        let dir = TempDir::new("missing");
        let err = read_file(&dir.path().join("vault.json"), ErrorCode::VaultNotFound).unwrap_err();
        assert_eq!(err.code, ErrorCode::VaultNotFound);
        assert!(!vault_exists(&dir.path().join("vault.json")).unwrap());
    }

    #[test]
    fn corrupted_inner_json_is_vault_corrupted() {
        let key = SessionKey::derive(b"pw", TEST_PARAMS).unwrap();
        let file = crypto::encrypt(b"not json at all", &key).unwrap();
        let err = open_vault_bytes(&file, b"pw", TEST_PARAMS).err().unwrap();
        assert_eq!(err.code, ErrorCode::VaultCorrupted);
        assert!(!err.message.contains("not json"));
    }

    #[test]
    fn weaker_params_need_upgrade() {
        let key = SessionKey::derive(b"pw", TEST_PARAMS).unwrap();
        let file = encode_vault(&sample_vault(), &key).unwrap();
        let stronger = crypto::KdfParams { log_n: 5, r: 8, p: 1 };
        assert!(open_vault_bytes(&file, b"pw", stronger).unwrap().needs_upgrade);
        assert!(!open_vault_bytes(&file, b"pw", TEST_PARAMS).unwrap().needs_upgrade);
    }

    #[test]
    fn snapshot_rotation_and_listing() {
        let dir = TempDir::new("backups");
        let path = dir.path().join("vault.json");
        // No vault yet: nothing to back up.
        assert_eq!(snapshot_at(&path, 1_000).unwrap(), None);

        fs::write(&path, b"v1").unwrap();
        assert_eq!(snapshot_at(&path, 1_000).unwrap().as_deref(), Some("vault-1000.json"));
        // Same second: no second snapshot, the first stays untouched.
        fs::write(&path, b"v2").unwrap();
        snapshot_at(&path, 1_000).unwrap();
        assert_eq!(fs::read(backups_dir(&path).join("vault-1000.json")).unwrap(), b"v1");

        for i in 1..=20u64 {
            snapshot_at(&path, 1_000 + i).unwrap();
        }
        let list = list_backups(&path).unwrap();
        assert_eq!(list.len(), MAX_BACKUPS);
        assert_eq!(list[0].file_name, "vault-1020.json");
        assert_eq!(list[0].created_at, 1_020_000);
        assert_eq!(list[0].size_bytes, 2);
        assert_eq!(list.last().unwrap().file_name, "vault-1006.json");
        assert!(list.windows(2).all(|w| w[0].created_at > w[1].created_at));

        // Unrelated files in the directory are ignored and never deleted.
        fs::write(backups_dir(&path).join("notes.txt"), b"x").unwrap();
        prune_backups(&backups_dir(&path), 1);
        assert!(backups_dir(&path).join("notes.txt").exists());
        assert_eq!(list_backups(&path).unwrap().len(), 1);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let file = backups_dir(&path).join("vault-1020.json");
            assert_eq!(fs::metadata(file).unwrap().permissions().mode() & 0o777, 0o600);
            let dir_mode = fs::metadata(backups_dir(&path)).unwrap().permissions().mode() & 0o777;
            assert_eq!(dir_mode, 0o700);
        }
    }

    #[test]
    fn snapshot_after_clock_went_backwards_is_kept() {
        let dir = TempDir::new("clockback");
        let path = dir.path().join("vault.json");
        fs::write(&path, b"old").unwrap();
        // 15 snapshots from a time the clock was far ahead.
        for i in 0..MAX_BACKUPS as u64 {
            snapshot_at(&path, 4_000_000_000 + i).unwrap();
        }
        fs::write(&path, b"current").unwrap();
        let name = snapshot_at(&path, 1_000).unwrap().unwrap();
        assert_eq!(fs::read(backups_dir(&path).join(&name)).unwrap(), b"current");
        let list = list_backups(&path).unwrap();
        assert_eq!(list.len(), MAX_BACKUPS);
        assert!(list.iter().any(|b| b.file_name == name));
        // The next snapshot is kept too (the previous protected one may go).
        let next = snapshot_at(&path, 1_001).unwrap().unwrap();
        assert!(backups_dir(&path).join(&next).exists());
        assert_eq!(list_backups(&path).unwrap().len(), MAX_BACKUPS);
    }

    #[test]
    fn snapshot_fails_clearly_when_backups_is_not_a_folder() {
        let dir = TempDir::new("backupsfile");
        let path = dir.path().join("vault.json");
        fs::write(&path, b"v").unwrap();
        fs::write(dir.path().join(BACKUP_DIR_NAME), b"I am a file").unwrap();
        let err = snapshot_at(&path, 5).unwrap_err();
        assert_eq!(err.code, ErrorCode::Io);
        assert!(err.message.contains("backup"), "{}", err.message);
        assert!(err.message.contains("not a folder"), "{}", err.message);
        assert!(ensure_private_dir(&dir.path().join(BACKUP_DIR_NAME)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_writes_through_a_symlink() {
        use std::os::unix::fs::symlink;
        let dir = TempDir::new("symlink");
        let synced = dir.path().join("synced");
        fs::create_dir(&synced).unwrap();
        let real = synced.join("real.json");
        fs::write(&real, b"old").unwrap();
        let link = dir.path().join("vault.json");
        symlink("synced/real.json", &link).unwrap();

        atomic_write(&link, b"new").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(&real).unwrap(), b"new");
        assert!(!synced.join("real.json.tmp").exists());

        // A dangling link (the synced file does not exist yet) is written through as well.
        let dangling = dir.path().join("other.json");
        symlink(synced.join("later.json"), &dangling).unwrap();
        atomic_write(&dangling, b"x").unwrap();
        assert!(fs::symlink_metadata(&dangling).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(synced.join("later.json")).unwrap(), b"x");
    }

    #[test]
    fn same_entry_compares_identity() {
        let dir = TempDir::new("same");
        let a = dir.path().join("a.json");
        fs::write(&a, b"a").unwrap();
        fs::write(dir.path().join("b.json"), b"b").unwrap();
        assert!(same_entry(&a, &dir.path().join(".").join("a.json")));
        assert!(!same_entry(&a, &dir.path().join("b.json")));
        assert!(!same_entry(&a, &dir.path().join("missing.json")));
    }

    #[test]
    fn backup_names_are_validated() {
        let dir = TempDir::new("resolve");
        let path = dir.path().join("vault.json");
        for bad in ["../vault.json", "vault-1.json/..", "a/vault-1.json", "vault-.json", "vault-12a.json", "x.json", "vault-1.json\\x"] {
            assert_eq!(resolve_backup(&path, bad).unwrap_err().code, ErrorCode::Validation, "{bad}");
        }
        assert_eq!(
            resolve_backup(&path, "vault-5.json").unwrap_err().code,
            ErrorCode::BackupNotFound
        );
        fs::write(&path, b"v").unwrap();
        snapshot_at(&path, 5).unwrap();
        assert!(resolve_backup(&path, "vault-5.json").is_ok());
    }
}
