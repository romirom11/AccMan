//! `storage.rs`: Handles file system operations for the vault.

use crate::crypto::{self, CryptoError, EncryptedVault, MasterPassword};
use crate::models::Vault;
use crate::StoragePath;
use std::fs;
use tauri::State;
use log::{error, info}; // Import logging macros

// --- Error ---

#[derive(Debug, thiserror::Error, serde::Serialize)]
pub enum StorageError {
    #[error("File system error: {0}")]
    Io(String),
    #[error("Serialization/Deserialization error: {0}")]
    Json(String),
    #[error("Cryptography error: {0}")]
    Crypto(String),
    #[error("Vault file not found at path: {0}")]
    NotFound(String),
}

impl From<std::io::Error> for StorageError {
    fn from(err: std::io::Error) -> Self {
        StorageError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(err: serde_json::Error) -> Self {
        StorageError::Json(err.to_string())
    }
}

impl From<CryptoError> for StorageError {
    fn from(err: CryptoError) -> Self {
        StorageError::Crypto(err.to_string())
    }
}

// --- Public Functions ---

pub fn vault_exists(path: &State<StoragePath>) -> bool {
    path.0.exists()
}

pub fn save_vault(
    path: &State<StoragePath>,
    vault: &Vault,
    password: &MasterPassword,
) -> Result<(), StorageError> {
    info!("Attempting to save vault to {}", path.0.display());
    let vault_json = serde_json::to_string(vault).map_err(|e| {
        error!("Failed to serialize vault: {}", e);
        StorageError::from(e)
    })?;

    let encrypted_vault = crypto::encrypt_vault(vault_json.as_bytes(), password).map_err(|e| {
        error!("Failed to encrypt vault: {}", e);
        StorageError::from(e)
    })?;
    let encrypted_json = serde_json::to_string_pretty(&encrypted_vault).map_err(|e| {
        error!("Failed to serialize encrypted vault: {}", e);
        StorageError::from(e)
    })?;

    fs::write(&path.0, encrypted_json).map_err(|e| {
        error!("Failed to write vault to file: {}", e);
        StorageError::from(e)
    })?;
    
    info!("Vault saved successfully.");
    Ok(())
}

pub fn load_vault(
    path: &State<StoragePath>,
    password: &MasterPassword,
) -> Result<Vault, StorageError> {
    info!("Attempting to load vault from {}", path.0.display());
    if !vault_exists(path) {
        error!("Vault file not found at {}", path.0.display());
        return Err(StorageError::NotFound(path.0.display().to_string()));
    }

    let encrypted_json = fs::read_to_string(&path.0).map_err(|e| {
        error!("Failed to read vault file: {}", e);
        StorageError::from(e)
    })?;
    let encrypted_vault: EncryptedVault = serde_json::from_str(&encrypted_json).map_err(|e| {
        error!("Failed to deserialize encrypted vault from JSON: {}", e);
        StorageError::from(e)
    })?;

    let decrypted_json_bytes = crypto::decrypt_vault(encrypted_vault, password).map_err(|e| {
        error!("Failed to decrypt vault: {}", e);
        StorageError::from(e)
    })?;

    let vault: Vault = serde_json::from_slice(&decrypted_json_bytes).map_err(|e| {
        error!("Failed to deserialize vault from decrypted JSON: {}", e);
        StorageError::from(e)
    })?;
    
    info!("Vault loaded and decrypted successfully.");
    Ok(vault)
}
