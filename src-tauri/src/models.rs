//! `models.rs`: Defines the core data structures for the application.
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub auto_lock_minutes: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServiceField {
    pub id: String,
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String, // "text", "secret", "url", "linked_service"
    pub masked: bool,
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_service_type_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServiceType {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub fields: Vec<ServiceField>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub service_type_id: String,
    pub label: String,
    pub data: std::collections::HashMap<String, String>,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub label: String,
    pub notes: String,
    pub tags: Vec<String>,
    pub linked_services: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Vault {
    pub version: String,
    pub service_types: Vec<ServiceType>,
    pub services: Vec<Service>,
    pub accounts: Vec<Account>,
    pub settings: Settings,
}

// Email-related models

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    pub id: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub body_preview: String, // First 200 chars of body
    pub body_content: String, // Full email content (text)
    pub body_html: Option<String>, // HTML content if available
    pub has_verification_code: bool,
    pub verification_codes: Vec<String>, // Extracted codes
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailConnection {
    pub email: String,
    pub provider_name: String,
    pub is_connected: bool,
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailFetchResult {
    pub messages: Vec<EmailMessage>,
    pub total_count: u32,
    pub has_more: bool,
}
