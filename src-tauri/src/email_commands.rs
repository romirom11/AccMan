//! `email_commands.rs`: Tauri commands of the email feature. The IMAP work blocks, so it runs on
//! the blocking thread pool, never on the main thread.
//!
//! `imap_host` / `imap_port` (JS: `imapHost` / `imapPort`) are optional overrides; without a
//! host the server is detected from the address domain.

use crate::email_client::{clamp_fetch_limit, EmailClient, EmailError};
use crate::email_providers::is_provider_supported;
use crate::error::{CommandError, CommandResult, ErrorCode};
use crate::models::{EmailConnection, EmailFetchResult};
use crate::session::secret;

impl EmailError {
    pub fn code(&self) -> ErrorCode {
        match self {
            EmailError::UnsupportedProvider(_) => ErrorCode::EmailUnsupportedProvider,
            EmailError::InvalidConfig(_) => ErrorCode::Validation,
            EmailError::ConnectionError(_) | EmailError::TlsError(_) => ErrorCode::EmailConnection,
            EmailError::Timeout(_) => ErrorCode::EmailTimeout,
            EmailError::AuthenticationError(_) => ErrorCode::EmailAuth,
            EmailError::ImapError(_) => ErrorCode::EmailProtocol,
        }
    }
}

impl From<EmailError> for CommandError {
    fn from(err: EmailError) -> Self {
        CommandError::new(err.code(), err.to_string())
    }
}

#[tauri::command]
pub fn is_email_provider_supported(email: String, imap_host: Option<String>) -> bool {
    is_provider_supported(&email, imap_host.as_deref())
}

/// Logs in and out. Input problems are errors (EMAIL_UNSUPPORTED_PROVIDER, VALIDATION);
/// network and login failures come back as `isConnected: false` with `lastError` and
/// `lastErrorCode`.
#[tauri::command]
pub async fn test_email_connection(
    email: String,
    password: String,
    imap_host: Option<String>,
    imap_port: Option<u16>,
) -> CommandResult<EmailConnection> {
    let password = secret(password);
    tauri::async_runtime::spawn_blocking(move || {
        let client = EmailClient::new(&email, &password, imap_host.as_deref(), imap_port)?;
        Ok(client.test_connection())
    })
    .await?
}

#[tauri::command]
pub async fn fetch_recent_emails(
    email: String,
    password: String,
    limit: Option<u32>,
    imap_host: Option<String>,
    imap_port: Option<u16>,
) -> CommandResult<EmailFetchResult> {
    let password = secret(password);
    let limit = clamp_fetch_limit(limit);
    tauri::async_runtime::spawn_blocking(move || {
        let client = EmailClient::new(&email, &password, imap_host.as_deref(), imap_port)?;
        Ok(client.fetch_recent_emails(limit)?)
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_errors_map_to_codes() {
        let cases = [
            (EmailError::UnsupportedProvider("x".into()), "EMAIL_UNSUPPORTED_PROVIDER"),
            (EmailError::InvalidConfig("x".into()), "VALIDATION"),
            (EmailError::ConnectionError("x".into()), "EMAIL_CONNECTION"),
            (EmailError::TlsError("x".into()), "EMAIL_CONNECTION"),
            (EmailError::Timeout("x".into()), "EMAIL_TIMEOUT"),
            (EmailError::AuthenticationError("x".into()), "EMAIL_AUTH"),
            (EmailError::ImapError("x".into()), "EMAIL_PROTOCOL"),
        ];
        for (err, code) in cases {
            let json = serde_json::to_value(CommandError::from(err)).unwrap();
            assert_eq!(json["code"], code);
        }
    }

    #[test]
    fn provider_support_command() {
        assert!(is_email_provider_supported(" User@Gmail.com ".into(), None));
        assert!(!is_email_provider_supported("user@unknown.org".into(), None));
        assert!(is_email_provider_supported(
            "user@unknown.org".into(),
            Some("imap.unknown.org".into())
        ));
    }
}
