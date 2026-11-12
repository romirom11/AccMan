//! IMAP server selection: a table of well-known providers (detected from the address domain) and
//! explicit `imap_host` / `imap_port` overrides, so any IMAP server with implicit TLS works.

use std::net::IpAddr;

/// Implicit-TLS IMAP port, used whenever no port is given.
pub const DEFAULT_IMAP_PORT: u16 = 993;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailProviderConfig {
    pub name: String,
    pub imap_host: String,
    pub imap_port: u16,
}

impl EmailProviderConfig {
    pub fn new(name: &str, imap_host: &str, imap_port: u16) -> Self {
        Self {
            name: name.to_string(),
            imap_host: imap_host.to_string(),
            imap_port,
        }
    }
}

/// Built-in providers: (display name, IMAP host, address domains). All use port 993.
/// Proton Mail is deliberately absent: it only offers IMAP through the local Proton Bridge,
/// which serves STARTTLS with a self-signed certificate. This client only speaks implicit TLS
/// and trusts system certificates, so Bridge is not supported, even with an explicit host.
const PROVIDERS: &[(&str, &str, &[&str])] = &[
    (
        // Microsoft has disabled password (basic-auth) IMAP for most consumer accounts; it still
        // works for some accounts and tenants, so the provider stays listed.
        "Outlook",
        "outlook.office365.com",
        &[
            "outlook.com",
            "hotmail.com",
            "live.com",
            "msn.com",
            "passport.com",
            "outlook.de",
            "outlook.fr",
            "outlook.es",
            "outlook.it",
            "hotmail.co.uk",
            "hotmail.de",
            "hotmail.fr",
            "hotmail.es",
            "hotmail.it",
            "live.co.uk",
            "live.de",
            "live.fr",
            "live.it",
            "live.ru",
        ],
    ),
    (
        "Rambler",
        "imap.rambler.ru",
        &[
            "rambler.ru",
            "rambler.ua",
            "lenta.ru",
            "autorambler.ru",
            "myrambler.ru",
            "ro.ru",
        ],
    ),
    (
        "FirstMail",
        "imap.firstmail.ltd",
        &[
            "firstmail.ltd",
            "mailkv.com",
            "oonmail.com",
            "znemail.com",
            "maillsk.com",
            "maillv.com",
        ],
    ),
    ("Gmail", "imap.gmail.com", &["gmail.com", "googlemail.com"]),
    (
        "Yahoo",
        "imap.mail.yahoo.com",
        &[
            "yahoo.com",
            "yahoo.co.uk",
            "yahoo.de",
            "yahoo.fr",
            "ymail.com",
            "rocketmail.com",
        ],
    ),
    ("iCloud", "imap.mail.me.com", &["icloud.com", "me.com", "mac.com"]),
    ("GMX", "imap.gmx.com", &["gmx.com", "gmx.us", "gmx.co.uk"]),
    ("GMX", "imap.gmx.net", &["gmx.net", "gmx.de", "gmx.at", "gmx.ch"]),
    (
        "Mail.ru",
        "imap.mail.ru",
        &["mail.ru", "inbox.ru", "list.ru", "bk.ru", "internet.ru"],
    ),
    (
        "Yandex",
        "imap.yandex.com",
        &[
            "yandex.ru",
            "yandex.com",
            "yandex.ua",
            "yandex.by",
            "yandex.kz",
            "ya.ru",
        ],
    ),
    ("UKR.NET", "imap.ukr.net", &["ukr.net"]),
    ("I.UA", "imap.i.ua", &["i.ua"]),
    ("META.UA", "imap.meta.ua", &["meta.ua"]),
    ("Zoho", "imap.zoho.com", &["zoho.com", "zohomail.com"]),
    ("Zoho", "imap.zoho.eu", &["zoho.eu", "zohomail.eu"]),
    ("AOL", "imap.aol.com", &["aol.com", "aim.com"]),
];

/// Built-in provider for an email address, detected from its domain.
pub fn get_provider_config(email: &str) -> Option<EmailProviderConfig> {
    let domain = extract_domain(email)?;
    PROVIDERS
        .iter()
        .find(|(_, _, domains)| domains.contains(&domain.as_str()))
        .map(|(name, host, _)| EmailProviderConfig::new(name, host, DEFAULT_IMAP_PORT))
}

/// Lowercased domain of an address. Surrounding whitespace is ignored; `None` when there is no
/// local part or no domain, or the domain contains whitespace.
pub fn extract_domain(email: &str) -> Option<String> {
    let (local, domain) = email.trim().rsplit_once('@')?;
    let domain = domain.trim().trim_end_matches('.');
    if local.trim().is_empty() || domain.is_empty() || domain.chars().any(char::is_whitespace) {
        return None;
    }
    Some(domain.to_lowercase())
}

/// Validates a user-supplied IMAP host name and returns it normalised (trimmed, lowercased,
/// without a trailing dot).
pub fn normalize_imap_host(host: &str) -> Result<String, String> {
    let host = host.trim();
    if host.is_empty() {
        return Err("The IMAP host is empty.".to_string());
    }
    if host.contains("://") || host.contains('/') {
        return Err(format!(
            "The IMAP host '{host}' must be a plain host name such as imap.example.com, without a scheme or path."
        ));
    }
    if host.chars().any(char::is_whitespace) {
        return Err(format!("The IMAP host '{host}' contains spaces."));
    }
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if bare.parse::<IpAddr>().is_ok() {
        return Ok(bare.to_string());
    }
    if host.contains(':') {
        return Err(format!(
            "The IMAP host '{host}' must not contain a port; enter the port separately."
        ));
    }
    let name = host.trim_end_matches('.').to_ascii_lowercase();
    let valid_label = |label: &str| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };
    if name.is_empty() || name.len() > 253 || !name.split('.').all(valid_label) {
        return Err(format!("'{host}' is not a valid IMAP host name."));
    }
    Ok(name)
}

/// Validates a user-supplied IMAP port.
pub fn validate_imap_port(port: u16) -> Result<u16, String> {
    if port == 0 {
        Err("The IMAP port must be between 1 and 65535.".to_string())
    } else {
        Ok(port)
    }
}

/// Outcome of [`resolve_server`] when the address cannot be served.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveError {
    /// No explicit host and the domain is not a built-in provider.
    Unsupported(String),
    /// The explicit host or port is malformed.
    Invalid(String),
}

/// Chooses the IMAP server for an address. An explicit host (optionally with a port, default
/// 993) always wins, so any IMAP server works; a port alone overrides the detected provider's
/// port.
pub fn resolve_server(
    email: &str,
    imap_host: Option<&str>,
    imap_port: Option<u16>,
) -> Result<EmailProviderConfig, ResolveError> {
    let port = imap_port
        .map(validate_imap_port)
        .transpose()
        .map_err(ResolveError::Invalid)?;
    let detected = get_provider_config(email);

    match imap_host.map(str::trim).filter(|h| !h.is_empty()) {
        Some(host) => {
            let host = normalize_imap_host(host).map_err(ResolveError::Invalid)?;
            let name = detected
                .filter(|p| p.imap_host == host)
                .map(|p| p.name)
                .unwrap_or_else(|| host.clone());
            Ok(EmailProviderConfig {
                name,
                imap_host: host,
                imap_port: port.unwrap_or(DEFAULT_IMAP_PORT),
            })
        }
        None => {
            let mut config = detected.ok_or_else(|| {
                ResolveError::Unsupported(format!(
                    "No built-in IMAP settings for '{}'. Set an IMAP host for this mailbox.",
                    email.trim()
                ))
            })?;
            if let Some(port) = port {
                config.imap_port = port;
            }
            Ok(config)
        }
    }
}

/// True when the address can be used: an explicit IMAP host is given, or its domain is a
/// built-in provider.
pub fn is_provider_supported(email: &str, imap_host: Option<&str>) -> bool {
    imap_host.is_some_and(|h| !h.trim().is_empty()) || get_provider_config(email).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_domain_handles_case_whitespace_and_garbage() {
        assert_eq!(extract_domain("user@gmail.com"), Some("gmail.com".into()));
        assert_eq!(extract_domain("  User@GMail.COM \r\n"), Some("gmail.com".into()));
        assert_eq!(extract_domain("a@b@outlook.com"), Some("outlook.com".into()));
        assert_eq!(extract_domain("user@rambler.ru."), Some("rambler.ru".into()));
        assert_eq!(extract_domain("invalid"), None);
        assert_eq!(extract_domain("user@"), None);
        assert_eq!(extract_domain("@gmail.com"), None);
        assert_eq!(extract_domain("user@gm ail.com"), None);
        assert_eq!(extract_domain(""), None);
    }

    #[test]
    fn detects_builtin_providers() {
        let cases = [
            ("test@outlook.com", "Outlook", "outlook.office365.com"),
            ("x@hotmail.co.uk", "Outlook", "outlook.office365.com"),
            ("user@mailkv.com", "FirstMail", "imap.firstmail.ltd"),
            ("user@rambler.ru", "Rambler", "imap.rambler.ru"),
            ("user@gmail.com", "Gmail", "imap.gmail.com"),
            ("user@googlemail.com", "Gmail", "imap.gmail.com"),
            ("user@yahoo.com", "Yahoo", "imap.mail.yahoo.com"),
            ("user@me.com", "iCloud", "imap.mail.me.com"),
            ("user@icloud.com", "iCloud", "imap.mail.me.com"),
            ("user@gmx.com", "GMX", "imap.gmx.com"),
            ("user@gmx.net", "GMX", "imap.gmx.net"),
            ("user@bk.ru", "Mail.ru", "imap.mail.ru"),
            ("user@yandex.ru", "Yandex", "imap.yandex.com"),
            ("user@ya.ru", "Yandex", "imap.yandex.com"),
            ("user@ukr.net", "UKR.NET", "imap.ukr.net"),
            ("user@i.ua", "I.UA", "imap.i.ua"),
            ("user@meta.ua", "META.UA", "imap.meta.ua"),
            ("user@zoho.com", "Zoho", "imap.zoho.com"),
            ("user@aol.com", "AOL", "imap.aol.com"),
            ("  USER@Gmail.Com ", "Gmail", "imap.gmail.com"),
        ];
        for (email, name, host) in cases {
            let config = get_provider_config(email).unwrap_or_else(|| panic!("{email}"));
            assert_eq!(config.name, name, "{email}");
            assert_eq!(config.imap_host, host, "{email}");
            assert_eq!(config.imap_port, 993, "{email}");
        }
    }

    #[test]
    fn unknown_and_unsupported_domains() {
        assert!(!is_provider_supported("user@unknown.com", None));
        assert!(!is_provider_supported("user@proton.me", None));
        assert!(!is_provider_supported("user@protonmail.com", None));
        assert!(!is_provider_supported("not-an-email", None));
        assert!(!is_provider_supported("user@unknown.com", Some("   ")));
        assert!(is_provider_supported("user@unknown.com", Some("mail.unknown.com")));
        assert!(is_provider_supported("login-without-domain", Some("mail.example.org")));
        assert!(is_provider_supported("user@gmail.com", None));
    }

    #[test]
    fn firstmail_aliases() {
        for alias in ["gxazitdd@mailkv.com", "aorlwfuz@oonmail.com", "umumbhff@znemail.com"] {
            let config = get_provider_config(alias).unwrap();
            assert_eq!(config.name, "FirstMail");
            assert_eq!(config.imap_host, "imap.firstmail.ltd");
            assert_eq!(config.imap_port, 993);
        }
    }

    #[test]
    fn explicit_host_overrides_detection() {
        let config = resolve_server("user@company.org", Some(" Mail.Company.org "), None).unwrap();
        assert_eq!(config.imap_host, "mail.company.org");
        assert_eq!(config.imap_port, 993);
        assert_eq!(config.name, "mail.company.org");

        let config = resolve_server("user@gmail.com", Some("imap.other.net"), Some(1993)).unwrap();
        assert_eq!(config.imap_host, "imap.other.net");
        assert_eq!(config.imap_port, 1993);

        // Same host as the detected provider keeps the provider's name.
        let config = resolve_server("user@gmail.com", Some("imap.gmail.com"), None).unwrap();
        assert_eq!(config.name, "Gmail");

        // A port alone overrides the detected provider's port.
        let config = resolve_server("user@gmail.com", None, Some(1143)).unwrap();
        assert_eq!(config.imap_host, "imap.gmail.com");
        assert_eq!(config.imap_port, 1143);

        // Blank host falls back to detection.
        let config = resolve_server("user@ukr.net", Some("  "), None).unwrap();
        assert_eq!(config.imap_host, "imap.ukr.net");

        let config = resolve_server("user@x.org", Some("127.0.0.1"), Some(143)).unwrap();
        assert_eq!(config.imap_host, "127.0.0.1");
        let config = resolve_server("user@x.org", Some("[::1]"), None).unwrap();
        assert_eq!(config.imap_host, "::1");
    }

    #[test]
    fn resolve_errors() {
        assert!(matches!(
            resolve_server("user@unknown.com", None, None),
            Err(ResolveError::Unsupported(_))
        ));
        for bad_host in [
            "imaps://imap.example.com",
            "imap.example.com/inbox",
            "imap example.com",
            "imap.example.com:993",
            "-bad.example.com",
            "imap..example.com",
            "imap.exa$mple.com",
        ] {
            assert!(
                matches!(
                    resolve_server("user@example.com", Some(bad_host), None),
                    Err(ResolveError::Invalid(_))
                ),
                "{bad_host}"
            );
        }
        assert!(matches!(
            resolve_server("user@gmail.com", None, Some(0)),
            Err(ResolveError::Invalid(_))
        ));
        assert!(matches!(
            resolve_server("user@example.com", Some("imap.example.com"), Some(0)),
            Err(ResolveError::Invalid(_))
        ));
    }
}
