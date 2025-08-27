//! Email client module for fetching emails via IMAP
//! Focuses on retrieving recent emails and extracting verification codes

use crate::email_providers::{get_provider_config, EmailProviderConfig};
use crate::models::{EmailMessage, EmailConnection, EmailFetchResult};
use regex::Regex;
use uuid::Uuid;
use mail_parser::MessageParser;

pub struct EmailClient {
    config: EmailProviderConfig,
    username: String,
    password: String,
}

impl EmailClient {
    pub fn new(email: String, password: String) -> Result<Self, EmailError> {
        let config = get_provider_config(&email)
            .ok_or_else(|| EmailError::UnsupportedProvider(email.clone()))?;
        
        Ok(Self {
            config,
            username: email,
            password,
        })
    }

    /// Test connection to email server
    pub fn test_connection(&self) -> Result<EmailConnection, EmailError> {
        match self.connect_imap() {
            Ok(_) => Ok(EmailConnection {
                email: self.username.clone(),
                provider_name: self.config.name.clone(),
                is_connected: true,
                last_error: None,
            }),
            Err(e) => Ok(EmailConnection {
                email: self.username.clone(),
                provider_name: self.config.name.clone(),
                is_connected: false,
                last_error: Some(e.to_string()),
            }),
        }
    }

    /// Fetch recent emails from INBOX
    pub fn fetch_recent_emails(&self, limit: u32) -> Result<EmailFetchResult, EmailError> {
        let mut imap_session = self.connect_imap()?;
        
        // Select INBOX
        imap_session.select("INBOX")
            .map_err(|e| EmailError::ImapError(e.to_string()))?;

        // Search for recent emails
        let search_result = imap_session.search("ALL")
            .map_err(|e| EmailError::ImapError(e.to_string()))?;

        let total_count = search_result.len() as u32;
        
        // Convert to Vec and get the most recent messages (limit the count)
        let mut ids_vec: Vec<u32> = search_result.into_iter().collect();
        ids_vec.sort(); // Sort to get consistent ordering
        
        let start_idx = if ids_vec.len() > limit as usize {
            ids_vec.len() - limit as usize
        } else {
            0
        };
        
        let recent_ids: Vec<u32> = ids_vec[start_idx..].iter().cloned().collect();
        
        if recent_ids.is_empty() {
            imap_session.logout().ok();
            return Ok(EmailFetchResult {
                messages: vec![],
                total_count,
                has_more: false,
            });
        }

        // Fetch message data - get both headers and full body
        let sequences = recent_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",");
        let messages = imap_session.fetch(&sequences, "(UID ENVELOPE BODY.PEEK[])")
            .map_err(|e| EmailError::ImapError(e.to_string()))?;

        let mut email_messages = Vec::new();
        
        for fetch in messages.iter() {
            if let Some(email_msg) = self.parse_email_message(fetch) {
                email_messages.push(email_msg);
            }
        }

        // Sort by date (newest first)
        email_messages.sort_by(|a, b| b.date.cmp(&a.date));

        // Logout from server
        imap_session.logout().ok();

        Ok(EmailFetchResult {
            messages: email_messages,
            total_count,
            has_more: total_count > limit,
        })
    }

    /// Connect to IMAP server
    fn connect_imap(&self) -> Result<imap::Session<native_tls::TlsStream<std::net::TcpStream>>, EmailError> {
        let tls = native_tls::TlsConnector::builder()
            .build()
            .map_err(|e| EmailError::TlsError(e.to_string()))?;

        // Connect with TLS
        let client = imap::connect(
            (&self.config.imap_host[..], self.config.imap_port),
            &self.config.imap_host,
            &tls,
        ).map_err(|e| EmailError::ConnectionError(e.to_string()))?;
        
        // Login
        let imap_session = client
            .login(&self.username, &self.password)
            .map_err(|(e, _)| EmailError::AuthenticationError(e.to_string()))?;

        Ok(imap_session)
    }

    /// Extract readable text from email message
    fn extract_email_text(&self, fetch: &imap::types::Fetch) -> (String, Option<String>) {
        if let Some(body) = fetch.body() {
            // Use mail-parser to properly parse the email
            if let Some(message) = MessageParser::default().parse(body) {
                // Get HTML body if available
                let html_body = message.body_html(0);
                
                // Get text body (mail-parser automatically converts HTML to text if needed)
                let text_body = message.body_text(0);
                
                match (html_body, text_body) {
                    (Some(html), Some(text)) => (text.to_string(), Some(html.to_string())),
                    (Some(html), None) => {
                        // Only HTML available, extract simple text preview
                        let text_preview = self.strip_html_tags(&html);
                        (text_preview, Some(html.to_string()))
                    },
                    (None, Some(text)) => (text.to_string(), Some(text.to_string())),
                    (None, None) => ("No readable content found".to_string(), None),
                }
            } else {
                // Fallback if parsing fails
                if let Ok(body_str) = std::str::from_utf8(body) {
                    (body_str.to_string(), Some(body_str.to_string()))
                } else {
                    ("Unable to parse email content".to_string(), None)
                }
            }
        } else {
            // Fallback: try to get text from individual body parts
            if let Some(text) = fetch.text() {
                if let Ok(text_str) = std::str::from_utf8(text) {
                    return (text_str.to_string(), Some(text_str.to_string()));
                }
            }
            
            ("No content available".to_string(), None)
        }
    }

    /// Strip HTML tags and decode basic entities (simplified version)
    fn strip_html_tags(&self, html: &str) -> String {
        // Basic HTML tag removal
        let tag_regex = Regex::new(r"<[^>]*>").unwrap();
        let without_tags = tag_regex.replace_all(html, "");
        
        // Basic HTML entity decoding
        let decoded = without_tags
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&nbsp;", " ");
            
        // Clean up extra whitespace
        let lines: Vec<&str> = decoded.lines()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .collect();
            
        lines.join("\n")
    }

    /// Parse fetched email into EmailMessage
    fn parse_email_message(&self, fetch: &imap::types::Fetch) -> Option<EmailMessage> {
        let envelope = fetch.envelope()?;
        
        // Try to parse the full message first for better subject decoding
        let (subject, from) = if let Some(body) = fetch.body() {
            if let Some(message) = MessageParser::default().parse(body) {
                let subject = message.subject().unwrap_or("No Subject").to_string();
                let from = if let Some(from_addr) = message.from() {
                    if let Some(addr) = from_addr.first() {
                        if let Some(name) = addr.name() {
                            format!("{} <{}>", name, addr.address().unwrap_or("unknown"))
                        } else {
                            addr.address().unwrap_or("Unknown").to_string()
                        }
                    } else {
                        "Unknown".to_string()
                    }
                } else {
                    "Unknown".to_string()
                };
                (subject, from)
            } else {
                // Fallback to envelope parsing
                let subject = envelope.subject
                    .as_ref()
                    .and_then(|s| std::str::from_utf8(s).ok())
                    .unwrap_or("No Subject").to_string();
                
                let from = envelope.from
                    .as_ref()
                    .and_then(|addrs| addrs.first())
                    .and_then(|addr| {
                        let name = addr.name.as_ref().and_then(|n| std::str::from_utf8(n).ok()).unwrap_or("");
                        let mailbox = addr.mailbox.as_ref().and_then(|m| std::str::from_utf8(m).ok()).unwrap_or("");
                        let host = addr.host.as_ref().and_then(|h| std::str::from_utf8(h).ok()).unwrap_or("");
                        
                        if name.is_empty() {
                            Some(format!("{}@{}", mailbox, host))
                        } else {
                            Some(format!("{} <{}@{}>", name, mailbox, host))
                        }
                    })
                    .unwrap_or("Unknown".to_string());
                (subject, from)
            }
        } else {
            // No body available, use envelope only
            let subject = envelope.subject
                .as_ref()
                .and_then(|s| std::str::from_utf8(s).ok())
                .unwrap_or("No Subject").to_string();
            
            let from = envelope.from
                .as_ref()
                .and_then(|addrs| addrs.first())
                .and_then(|addr| {
                    let name = addr.name.as_ref().and_then(|n| std::str::from_utf8(n).ok()).unwrap_or("");
                    let mailbox = addr.mailbox.as_ref().and_then(|m| std::str::from_utf8(m).ok()).unwrap_or("");
                    let host = addr.host.as_ref().and_then(|h| std::str::from_utf8(h).ok()).unwrap_or("");
                    
                    if name.is_empty() {
                        Some(format!("{}@{}", mailbox, host))
                    } else {
                        Some(format!("{} <{}@{}>", name, mailbox, host))
                    }
                })
                .unwrap_or("Unknown".to_string());
            (subject, from)
        };

        let date = envelope.date
            .as_ref()
            .and_then(|d| std::str::from_utf8(d).ok())
            .unwrap_or("Unknown").to_string();

        // Get body content - try to extract readable text from email
        let (body_content, body_html) = self.extract_email_text(fetch);

        // Extract first 200 chars for preview (respecting UTF-8 boundaries)
        let body_preview = if body_content.chars().count() > 200 {
            let preview: String = body_content.chars().take(200).collect();
            format!("{}...", preview)
        } else {
            body_content.clone()
        };

        // Extract verification codes
        let verification_codes = extract_verification_codes(&body_content);
        let has_verification_code = !verification_codes.is_empty();

        Some(EmailMessage {
            id: Uuid::new_v4().to_string(),
            subject,
            from,
            date,
            body_preview,
            body_content,
            body_html,
            has_verification_code,
            verification_codes,
        })
    }
}

/// Extract verification codes from email body
fn extract_verification_codes(body: &str) -> Vec<String> {
    let mut codes = Vec::new();
    
    // Common patterns for verification codes
    let patterns = [
        // 6-digit codes
        r"(?i)(?:code|verification|confirm|activate|verify)(?:[^\d]{0,50})(\d{6})(?!\d)",
        // 4-digit codes  
        r"(?i)(?:code|verification|confirm|activate|verify)(?:[^\d]{0,50})(\d{4})(?!\d)",
        // Mixed alphanumeric codes (6-8 chars)
        r"(?i)(?:code|verification|confirm|activate|verify)(?:[^\w]{0,50})([A-Z0-9]{6,8})(?![A-Z0-9])",
        // Simple patterns like "Code: 123456"
        r"(?i)code\s*:?\s*(\d{4,6})",
        // OTP patterns
        r"(?i)otp\s*:?\s*(\d{4,6})",
    ];

    for pattern in &patterns {
        if let Ok(regex) = Regex::new(pattern) {
            for cap in regex.captures_iter(body) {
                if let Some(code) = cap.get(1) {
                    let code_str = code.as_str();
                    // Avoid duplicates and ensure reasonable length
                    if !codes.contains(&code_str.to_string()) && code_str.len() >= 4 && code_str.len() <= 8 {
                        codes.push(code_str.to_string());
                    }
                }
            }
        }
    }

    codes
}

#[derive(Debug, thiserror::Error)]
pub enum EmailError {
    #[error("Unsupported email provider: {0}")]
    UnsupportedProvider(String),
    #[error("Connection error: {0}")]
    ConnectionError(String),
    #[error("TLS error: {0}")]
    TlsError(String),
    #[error("Authentication error: {0}")]
    AuthenticationError(String),
    #[error("IMAP error: {0}")]
    ImapError(String),
    #[error("Parse error: {0}")]
    ParseError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verification_code_extraction() {
        let test_cases = vec![
            ("Your verification code is 123456", vec!["123456"]),
            ("Code: 4567", vec!["4567"]),
            ("Your OTP is 789012", vec!["789012"]),
            ("Confirm with ABC123", vec!["ABC123"]),
            ("No codes here", vec![]),
        ];

        for (body, expected) in test_cases {
            let codes = extract_verification_codes(body);
            assert_eq!(codes, expected, "Failed for: {}", body);
        }
    }
}