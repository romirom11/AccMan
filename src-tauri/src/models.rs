//! `models.rs`: data structures stored in the vault and exchanged with the frontend.
//!
//! Every field added after the first release carries a serde default so existing vault files
//! keep loading. JSON is camelCase.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use zeroize::Zeroize;

// Email models live in their own module (owned by the email feature) and are re-exported here
// so `crate::models::EmailMessage` etc. keep working.
pub use crate::email_models::*;

pub const VAULT_VERSION: &str = "0.3.0";

/// Field types understood by the frontend.
pub const FIELD_TYPES: &[&str] = &["text", "secret", "textarea", "url", "linked_service", "2fa"];

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// 0 disables auto-lock.
    pub auto_lock_minutes: u32,
    /// 0 never clears the clipboard.
    pub clipboard_clear_seconds: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            auto_lock_minutes: 15,
            clipboard_clear_seconds: 30,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServiceField {
    pub id: String,
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub masked: bool,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_service_type_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServiceType {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub fields: Vec<ServiceField>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub service_type_id: String,
    pub label: String,
    #[serde(default)]
    pub data: HashMap<String, String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub pinned: bool,
    /// Unix milliseconds; 0 = unknown (legacy record).
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub linked_services: Vec<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Vault {
    pub version: String,
    pub service_types: Vec<ServiceType>,
    pub services: Vec<Service>,
    pub accounts: Vec<Account>,
    pub settings: Settings,
}

impl Default for Vault {
    fn default() -> Self {
        Vault {
            version: VAULT_VERSION.to_string(),
            service_types: Vec::new(),
            services: Vec::new(),
            accounts: Vec::new(),
            settings: Settings::default(),
        }
    }
}

impl Vault {
    /// Best-effort wipe of the decrypted contents before the memory is released.
    pub fn wipe(&mut self) {
        for service in &mut self.services {
            for value in service.data.values_mut() {
                value.zeroize();
            }
            service.label.zeroize();
            service.tags.iter_mut().for_each(Zeroize::zeroize);
        }
        for account in &mut self.accounts {
            account.label.zeroize();
            account.notes.zeroize();
            account.tags.iter_mut().for_each(Zeroize::zeroize);
        }
        self.services.clear();
        self.accounts.clear();
        self.service_types.clear();
    }
}

// --- Command payloads and results ---

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file_name: String,
    /// Unix milliseconds.
    pub created_at: u64,
    pub size_bytes: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub service_types_added: u32,
    pub service_types_merged: u32,
    pub services_added: u32,
    pub services_skipped: u32,
    pub accounts_added: u32,
    pub accounts_skipped: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub vault: Vault,
    pub summary: ImportSummary,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BulkAccountConfig {
    pub count: u32,
    pub name_template: String,
    pub start_number: u32,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLinkConfig {
    pub service_type_id: String,
    pub name_template: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BulkCreateRequest {
    pub account_config: BulkAccountConfig,
    #[serde(default)]
    pub link_services: bool,
    #[serde(default)]
    pub service_configs: Vec<ServiceLinkConfig>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BulkCreateSummary {
    pub created: u32,
    pub linked: u32,
    pub unmatched: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BulkCreateResult {
    pub vault: Vault,
    pub summary: BulkCreateSummary,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_vault_json_loads_with_defaults() {
        let legacy = r#"{
            "version": "0.2.0",
            "serviceTypes": [{"id":"t","name":"T","icon":"X","fields":[
                {"id":"f1","key":"k","label":"K","type":"text","masked":false,"required":false}
            ]}],
            "services": [{"id":"s1","serviceTypeId":"t","label":"S","data":{"k":"v"},"tags":[]}],
            "accounts": [{"id":"a1","label":"A","notes":"","tags":[],"linkedServices":["s1"]}],
            "settings": {"autoLockMinutes": 5}
        }"#;
        let vault: Vault = serde_json::from_str(legacy).unwrap();
        assert_eq!(vault.settings.auto_lock_minutes, 5);
        assert_eq!(vault.settings.clipboard_clear_seconds, 30);
        assert_eq!(vault.services[0].created_at, 0);
        assert!(!vault.accounts[0].pinned);

        let json = serde_json::to_value(&vault).unwrap();
        assert!(json["services"][0].get("createdAt").is_some());
        assert!(json["settings"].get("clipboardClearSeconds").is_some());
        assert!(json["serviceTypes"][0]["fields"][0].get("linkedServiceTypeId").is_none());
    }

    #[test]
    fn settings_default_values() {
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.auto_lock_minutes, 15);
        assert_eq!(s.clipboard_clear_seconds, 30);
    }
}
