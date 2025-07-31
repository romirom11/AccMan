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
