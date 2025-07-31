//! `defaults.rs`: Defines the default service types for a new vault.
use crate::models::{ServiceField, ServiceType};

fn create_field(id: &str, key: &str, label: &str, field_type: &str, masked: bool, required: bool) -> ServiceField {
    ServiceField {
        id: id.to_string(),
        key: key.to_string(),
        label: label.to_string(),
        field_type: field_type.to_string(),
        masked,
        required,
        linked_service_type_id: None,
    }
}

pub fn get_default_service_types() -> Vec<ServiceType> {
    vec![
        // --- Discord ---
        ServiceType {
            id: "discord".to_string(),
            name: "Discord".to_string(),
            icon: "MessageSquare".to_string(), // Placeholder icon
            fields: vec![
                create_field("d-1", "username", "Username", "text", false, true),
                create_field("d-2", "email", "Email", "text", false, true),
                create_field("d-3", "password", "Password", "secret", true, true),
                create_field("d-6", "auth_token", "Auth Token", "textarea", true, false),
                create_field("d-7", "2fa_key", "2FA Key", "secret", true, false),
                create_field("d-8", "backup_codes", "Backup Codes", "textarea", true, false),
            ],
        },
        // --- Twitter ---
        ServiceType {
            id: "twitter-x".to_string(),
            name: "Twitter (X)".to_string(),
            icon: "Twitter".to_string(),
            fields: vec![
                create_field("t-1", "display_name", "Name", "text", false, true),
                create_field("t-2", "email", "Email", "text", false, true),
                create_field("t-3", "password", "Password", "secret", true, true),
                create_field("t-6", "auth_token", "Auth Token", "textarea", true, false),
                create_field("t-7", "2fa_key", "2FA Key", "secret", true, false),
                create_field("t-8", "backup_codes", "Backup Codes", "textarea", true, false),
            ],
        },
        // --- Email ---
        ServiceType {
            id: "email".to_string(),
            name: "Email".to_string(),
            icon: "Mail".to_string(),
            fields: vec![
                create_field("g-1", "display_name", "Name", "text", false, false),
                create_field("g-2", "email", "Email", "text", false, true),
                create_field("g-3", "password", "Password", "secret", true, true),
                create_field("g-4", "recovery_email", "Recovery Email", "text", false, false),
                create_field("g-5", "recovery_email_access_url", "Recovery Email Access URL", "url", false, false),
                create_field("g-6", "recovery_email_access_password", "Recovery Email Access Password", "secret", true, false),
                create_field("g-7", "2fa_key", "2FA Key", "secret", true, false),
            ],
        },
        // --- Proxy ---
        ServiceType {
            id: "proxy".to_string(),
            name: "Proxy".to_string(),
            icon: "Globe".to_string(),
            fields: vec![
                create_field("p-1", "proxy_string", "Proxy String", "secret", true, true),
            ],
        },
        // --- EVM Wallet ---
        ServiceType {
            id: "evm-wallet".to_string(),
            name: "EVM Wallet".to_string(),
            icon: "Wallet".to_string(),
            fields: vec![
                create_field("evm-1", "address", "Address", "text", false, true),
                create_field("evm-2", "seed_phrase", "Seed Phrase", "textarea", true, false),
                create_field("evm-3", "private_key", "Private Key", "textarea", true, false),
            ],
        },
        // --- Solana Wallet ---
        ServiceType {
            id: "solana-wallet".to_string(),
            name: "Solana Wallet".to_string(),
            icon: "WalletCards".to_string(),
            fields: vec![
                create_field("sol-1", "address", "Address", "text", false, true),
                create_field("sol-2", "seed_phrase", "Seed Phrase", "textarea", true, false),
                create_field("sol-3", "private_key", "Private Key", "textarea", true, false),
            ],
        },
    ]
}
