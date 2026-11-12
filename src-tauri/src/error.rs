//! `error.rs`: the single error type returned by every command.
//!
//! It crosses the IPC boundary as `{ "code": "<CODE>", "message": "<English text>" }`.

use serde::ser::SerializeStruct;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    VaultLocked,
    VaultExists,
    VaultNotFound,
    VaultCorrupted,
    UnsupportedVaultVersion,
    InvalidPassword,
    PasswordTooShort,
    ServiceTypeExists,
    ServiceTypeNotFound,
    ServiceTypeInUse,
    ServiceNotFound,
    AccountNotFound,
    DuplicateId,
    Validation,
    BackupNotFound,
    Io,
    Internal,
    EmailUnsupportedProvider,
    EmailConnection,
    EmailAuth,
    EmailTimeout,
    EmailProtocol,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::VaultLocked => "VAULT_LOCKED",
            ErrorCode::VaultExists => "VAULT_EXISTS",
            ErrorCode::VaultNotFound => "VAULT_NOT_FOUND",
            ErrorCode::VaultCorrupted => "VAULT_CORRUPTED",
            ErrorCode::UnsupportedVaultVersion => "UNSUPPORTED_VAULT_VERSION",
            ErrorCode::InvalidPassword => "INVALID_PASSWORD",
            ErrorCode::PasswordTooShort => "PASSWORD_TOO_SHORT",
            ErrorCode::ServiceTypeExists => "SERVICE_TYPE_EXISTS",
            ErrorCode::ServiceTypeNotFound => "SERVICE_TYPE_NOT_FOUND",
            ErrorCode::ServiceTypeInUse => "SERVICE_TYPE_IN_USE",
            ErrorCode::ServiceNotFound => "SERVICE_NOT_FOUND",
            ErrorCode::AccountNotFound => "ACCOUNT_NOT_FOUND",
            ErrorCode::DuplicateId => "DUPLICATE_ID",
            ErrorCode::Validation => "VALIDATION",
            ErrorCode::BackupNotFound => "BACKUP_NOT_FOUND",
            ErrorCode::Io => "IO",
            ErrorCode::Internal => "INTERNAL",
            ErrorCode::EmailUnsupportedProvider => "EMAIL_UNSUPPORTED_PROVIDER",
            ErrorCode::EmailConnection => "EMAIL_CONNECTION",
            ErrorCode::EmailAuth => "EMAIL_AUTH",
            ErrorCode::EmailTimeout => "EMAIL_TIMEOUT",
            ErrorCode::EmailProtocol => "EMAIL_PROTOCOL",
        }
    }
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct CommandError {
    pub code: ErrorCode,
    pub message: String,
}

pub type CommandResult<T> = Result<T, CommandError>;

impl CommandError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn vault_locked() -> Self {
        Self::new(ErrorCode::VaultLocked, "The vault is locked.")
    }

    pub fn invalid_password() -> Self {
        Self::new(
            ErrorCode::InvalidPassword,
            "The password is incorrect or the file has been modified.",
        )
    }

    pub fn password_too_short() -> Self {
        Self::new(
            ErrorCode::PasswordTooShort,
            format!(
                "The password must be at least {} characters long.",
                crate::crypto::MIN_PASSWORD_CHARS
            ),
        )
    }

    pub fn corrupted(detail: impl std::fmt::Display) -> Self {
        Self::new(
            ErrorCode::VaultCorrupted,
            format!("The vault file is damaged or not an AccMan vault ({detail})."),
        )
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Validation, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    pub fn io(context: &str, err: &std::io::Error) -> Self {
        Self::new(ErrorCode::Io, format!("{context}: {err}"))
    }

    pub fn service_not_found(id: &str) -> Self {
        Self::new(
            ErrorCode::ServiceNotFound,
            format!("Service with ID '{id}' not found."),
        )
    }

    pub fn account_not_found(id: &str) -> Self {
        Self::new(
            ErrorCode::AccountNotFound,
            format!("Account with ID '{id}' not found."),
        )
    }

    pub fn service_type_not_found(id: &str) -> Self {
        Self::new(
            ErrorCode::ServiceTypeNotFound,
            format!("Service type with ID '{id}' not found."),
        )
    }

    pub fn duplicate_id(kind: &str, id: &str) -> Self {
        Self::new(
            ErrorCode::DuplicateId,
            format!("A {kind} with ID '{id}' already exists."),
        )
    }
}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("CommandError", 2)?;
        s.serialize_field("code", self.code.as_str())?;
        s.serialize_field("message", &self.message)?;
        s.end()
    }
}

impl From<tauri::Error> for CommandError {
    fn from(err: tauri::Error) -> Self {
        CommandError::internal(format!("Background task failed: {err}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_as_code_and_message() {
        let err = CommandError::vault_locked();
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "code": "VAULT_LOCKED", "message": "The vault is locked." })
        );
    }
}
