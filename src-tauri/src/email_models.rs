//! `email_models.rs`: wire types of the email commands (re-exported from `models`).
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    /// IMAP UID of the message in INBOX (stable across fetches).
    pub id: String,
    pub subject: String,
    pub from: String,
    /// Human-readable date (RFC 2822 style); empty when unknown.
    pub date: String,
    /// Unix milliseconds from the Date header, falling back to INTERNALDATE; 0 when unknown.
    #[serde(default)]
    pub timestamp: u64,
    /// First 200 characters of the plain text, on one line.
    pub body_preview: String,
    /// Plain text: the text/plain part, or a text rendering of the HTML part.
    pub body_content: String,
    /// Only set when the message really has a text/html part.
    pub body_html: Option<String>,
    pub has_verification_code: bool,
    /// Most likely code first, at most 5.
    pub verification_codes: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmailConnection {
    pub email: String,
    pub provider_name: String,
    pub is_connected: bool,
    pub last_error: Option<String>,
    /// Error code (EMAIL_CONNECTION, EMAIL_AUTH, EMAIL_TIMEOUT, EMAIL_PROTOCOL) when not connected.
    #[serde(default)]
    pub last_error_code: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmailFetchResult {
    pub messages: Vec<EmailMessage>,
    /// Number of messages in INBOX.
    pub total_count: u32,
    pub has_more: bool,
}
