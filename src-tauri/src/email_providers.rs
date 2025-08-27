//! Email provider configurations for popular email services.
//! This module contains predefined IMAP settings for major email providers.

use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct EmailProviderConfig {
    pub name: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub use_tls: bool,
}

impl EmailProviderConfig {
    pub fn new(name: &str, imap_host: &str, imap_port: u16, use_tls: bool) -> Self {
        Self {
            name: name.to_string(),
            imap_host: imap_host.to_string(),
            imap_port,
            use_tls,
        }
    }
}

/// Get email provider configuration based on email domain
pub fn get_provider_config(email: &str) -> Option<EmailProviderConfig> {
    let domain = extract_domain(email)?;
    
    match domain.as_str() {
        // Microsoft/Outlook
        "outlook.com" | "hotmail.com" | "live.com" | "msn.com" => {
            Some(EmailProviderConfig::new("Outlook", "imap-mail.outlook.com", 993, true))
        }
        
        
        // Rambler
        "rambler.ru" | "lenta.ru" | "autorambler.ru" | "myrambler.ru" => {
            Some(EmailProviderConfig::new("Rambler", "imap.rambler.ru", 993, true))
        }
        
        // FirstMail and its aliases
        "firstmail.ltd" | "mailkv.com" | "oonmail.com" | "znemail.com" 
        | "maillsk.com" | "maillv.com" => {
            Some(EmailProviderConfig::new("FirstMail", "imap.firstmail.ltd", 993, true))
        }
        
        _ => None
    }
}

/// Extract domain from email address
fn extract_domain(email: &str) -> Option<String> {
    email.split('@').nth(1).map(|domain| domain.to_lowercase())
}

/// Get all supported providers for informational purposes
pub fn get_supported_providers() -> HashMap<String, EmailProviderConfig> {
    let mut providers = HashMap::new();
    
    providers.insert("outlook".to_string(), 
        EmailProviderConfig::new("Outlook", "imap-mail.outlook.com", 993, true));

    providers.insert("rambler".to_string(), 
        EmailProviderConfig::new("Rambler", "imap.rambler.ru", 993, true));
    providers.insert("firstmail".to_string(), 
        EmailProviderConfig::new("FirstMail", "imap.firstmail.ltd", 993, true));
    
    providers
}

/// Check if an email provider is supported
pub fn is_provider_supported(email: &str) -> bool {
    get_provider_config(email).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_domain() {
        assert_eq!(extract_domain("user@gmail.com"), Some("gmail.com".to_string()));
        assert_eq!(extract_domain("test@outlook.com"), Some("outlook.com".to_string()));
        assert_eq!(extract_domain("invalid"), None);
    }

    #[test]
    fn test_provider_detection() {
        assert!(is_provider_supported("test@outlook.com"));
        assert!(is_provider_supported("user@mailkv.com")); // FirstMail alias
        assert!(!is_provider_supported("user@unknown.com"));
        assert!(!is_provider_supported("user@gmail.com")); // Gmail not supported
    }

    #[test]
    fn test_firstmail_aliases() {
        let aliases = ["gxazitdd@mailkv.com", "aorlwfuz@oonmail.com", "umumbhff@znemail.com"];
        
        for alias in &aliases {
            let config = get_provider_config(alias).unwrap();
            assert_eq!(config.name, "FirstMail");
            assert_eq!(config.imap_host, "imap.firstmail.ltd");
            assert_eq!(config.imap_port, 993);
        }
    }
}