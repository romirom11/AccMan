//! IMAP client for the newest messages of INBOX, message parsing (text rendering of HTML mail)
//! and verification-code extraction.
//!
//! Everything here blocks; the commands run it on the blocking thread pool.

use std::io;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::OnceLock;
use std::time::Duration;

use mail_parser::{Message, MessageParser, PartType};
use native_tls::{HandshakeError, TlsConnector, TlsStream};
use regex::{Captures, Regex};
use zeroize::Zeroizing;

use crate::email_models::{EmailConnection, EmailFetchResult, EmailMessage};
use crate::email_providers::{resolve_server, EmailProviderConfig, ResolveError};

/// TCP connect timeout and socket read/write timeout.
const IO_TIMEOUT: Duration = Duration::from_secs(15);
/// At most this many resolved addresses are tried (each with its own connect timeout).
const MAX_CONNECT_ATTEMPTS: usize = 3;
pub const DEFAULT_FETCH_LIMIT: u32 = 5;
pub const MAX_FETCH_LIMIT: u32 = 30;
/// Partial fetch size per message: larger messages (big attachments) are cut off here; the text
/// parts normally come first, so they still parse.
const BODY_FETCH_CAP: u32 = 2 * 1024 * 1024;
const PREVIEW_CHARS: usize = 200;
const MAX_CODES: usize = 5;
/// Codes sit near the top of a message; scanning is limited to this many bytes of text.
const MAX_SCAN_BYTES: usize = 128 * 1024;
/// How far (in characters) around a candidate its line and word are inspected.
const CONTEXT_CHARS: usize = 200;
const TOO_LARGE_PREVIEW: &str = "(This message is too large to preview.)";

type ImapClient = imap::Client<TlsStream<TcpStream>>;
type ImapSession = imap::Session<TlsStream<TcpStream>>;

#[derive(Debug, thiserror::Error)]
pub enum EmailError {
    #[error("{0}")]
    UnsupportedProvider(String),
    #[error("{0}")]
    InvalidConfig(String),
    #[error("Connection error: {0}")]
    ConnectionError(String),
    #[error("TLS error: {0}")]
    TlsError(String),
    #[error("Timed out: {0}")]
    Timeout(String),
    #[error("Authentication error: {0}")]
    AuthenticationError(String),
    #[error("IMAP error: {0}")]
    ImapError(String),
}

impl From<ResolveError> for EmailError {
    fn from(err: ResolveError) -> Self {
        match err {
            ResolveError::Unsupported(msg) => EmailError::UnsupportedProvider(msg),
            ResolveError::Invalid(msg) => EmailError::InvalidConfig(msg),
        }
    }
}

/// `limit` argument of `fetch_recent_emails`: default 5, clamped to 1..=30.
pub fn clamp_fetch_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(DEFAULT_FETCH_LIMIT).clamp(1, MAX_FETCH_LIMIT)
}

pub struct EmailClient {
    config: EmailProviderConfig,
    username: String,
    password: Zeroizing<String>,
}

impl EmailClient {
    /// Resolves the server (explicit host/port first, then the provider table). Email and
    /// password are trimmed, which also drops stray CR/LF from imported data.
    pub fn new(
        email: &str,
        password: &str,
        imap_host: Option<&str>,
        imap_port: Option<u16>,
    ) -> Result<Self, EmailError> {
        let username = email.trim();
        if username.is_empty() {
            return Err(EmailError::InvalidConfig("The email address is empty.".into()));
        }
        let password = Zeroizing::new(password.trim().to_string());
        if password.is_empty() {
            return Err(EmailError::InvalidConfig("The email password is empty.".into()));
        }
        let config = resolve_server(username, imap_host, imap_port)?;
        Ok(Self {
            config,
            username: username.to_string(),
            password,
        })
    }

    /// Logs in and out again. Network and login failures are reported in the result
    /// (`is_connected: false`), not as an error.
    pub fn test_connection(&self) -> EmailConnection {
        let result = self.with_session(|_| Ok(()));
        let (is_connected, last_error, last_error_code) = match result {
            Ok(()) => (true, None, None),
            Err(err) => (
                false,
                Some(err.to_string()),
                Some(err.code().as_str().to_string()),
            ),
        };
        EmailConnection {
            email: self.username.clone(),
            provider_name: self.config.name.clone(),
            is_connected,
            last_error,
            last_error_code,
        }
    }

    /// Newest `limit` messages of INBOX (1..=30), newest first. Messages are fetched with
    /// BODY.PEEK, so they are not marked as read.
    pub fn fetch_recent_emails(&self, limit: u32) -> Result<EmailFetchResult, EmailError> {
        let limit = limit.clamp(1, MAX_FETCH_LIMIT);
        self.with_session(|session| {
            let mailbox = session
                .select("INBOX")
                .map_err(|e| map_imap_error(e, "opening INBOX"))?;
            let exists = mailbox.exists;
            if exists == 0 {
                return Ok(EmailFetchResult {
                    messages: Vec::new(),
                    total_count: 0,
                    has_more: false,
                });
            }
            let first = exists.saturating_sub(limit) + 1;
            let query = format!("(UID INTERNALDATE RFC822.SIZE BODY.PEEK[]<0.{BODY_FETCH_CAP}>)");
            let fetches = session
                .fetch(format!("{first}:{exists}"), query)
                .map_err(|e| map_imap_error(e, "fetching messages"))?;

            // Servers may interleave unsolicited FETCH responses (flag changes) for other
            // messages; keep one response per requested sequence number, preferring one with a body.
            let mut picked: Vec<&imap::types::Fetch> = Vec::new();
            for fetch in fetches.iter() {
                if fetch.message < first || fetch.message > exists {
                    continue;
                }
                match picked.iter_mut().find(|f| f.message == fetch.message) {
                    Some(slot) if slot.body().is_none() && fetch.body().is_some() => *slot = fetch,
                    Some(_) => {}
                    None => picked.push(fetch),
                }
            }

            let mut messages: Vec<(u32, EmailMessage)> = picked
                .into_iter()
                .map(|fetch| {
                    let internal = fetch.internal_date();
                    let meta = FetchMeta {
                        uid: fetch.uid,
                        seq: fetch.message,
                        internal_date_ms: internal.map(|d| d.timestamp_millis()),
                        internal_date_text: internal.map(|d| d.to_rfc2822()),
                        truncated: match (fetch.size, fetch.body()) {
                            (Some(size), _) => size > BODY_FETCH_CAP,
                            (None, Some(body)) => body.len() >= BODY_FETCH_CAP as usize,
                            (None, None) => false,
                        },
                    };
                    (fetch.message, build_message(fetch.body(), &meta))
                })
                .collect();
            sort_newest_first(&mut messages);

            Ok(EmailFetchResult {
                messages: messages.into_iter().map(|(_, m)| m).collect(),
                total_count: exists,
                has_more: first > 1,
            })
        })
    }

    /// Logs in, runs `f`, and always sends LOGOUT afterwards unless the connection itself
    /// failed (then the socket is just dropped instead of waiting for another timeout).
    fn with_session<R>(
        &self,
        f: impl FnOnce(&mut ImapSession) -> Result<R, EmailError>,
    ) -> Result<R, EmailError> {
        let mut session = self.login()?;
        let result = f(&mut session);
        let connection_broken = matches!(
            result,
            Err(EmailError::Timeout(_) | EmailError::ConnectionError(_) | EmailError::TlsError(_))
        );
        if !connection_broken {
            if let Err(err) = session.logout() {
                log::debug!("IMAP logout from {} failed: {err}", self.config.imap_host);
            }
        }
        result
    }

    fn login(&self) -> Result<ImapSession, EmailError> {
        let client = self.connect()?;
        client
            .login(&self.username, self.password.as_str())
            .map_err(|(err, _client)| match err {
                imap::Error::No(msg) | imap::Error::Bad(msg) => {
                    let msg = msg.trim();
                    EmailError::AuthenticationError(if msg.is_empty() {
                        "the server rejected the email or password".to_string()
                    } else {
                        msg.to_string()
                    })
                }
                imap::Error::Validate(_) => EmailError::AuthenticationError(
                    "the email or password contains a line break, which IMAP does not allow"
                        .to_string(),
                ),
                other => map_imap_error(other, "logging in"),
            })
    }

    /// TCP connect with a timeout, socket timeouts, implicit TLS, then the server greeting.
    fn connect(&self) -> Result<ImapClient, EmailError> {
        let host = self.config.imap_host.as_str();
        let port = self.config.imap_port;
        let target = format!("{host}:{port}");

        let addrs: Vec<SocketAddr> = (host, port)
            .to_socket_addrs()
            .map_err(|e| EmailError::ConnectionError(format!("cannot resolve {host}: {e}")))?
            .take(MAX_CONNECT_ATTEMPTS)
            .collect();
        let tcp = connect_any(&addrs).map_err(|e| {
            if is_timeout(&e) {
                EmailError::Timeout(format!("no answer from {target}"))
            } else {
                EmailError::ConnectionError(format!("cannot connect to {target}: {e}"))
            }
        })?;
        tcp.set_read_timeout(Some(IO_TIMEOUT))
            .and_then(|_| tcp.set_write_timeout(Some(IO_TIMEOUT)))
            .map_err(|e| EmailError::ConnectionError(format!("{target}: {e}")))?;

        let connector = TlsConnector::new().map_err(|e| EmailError::TlsError(e.to_string()))?;
        let tls = match connector.connect(host, tcp) {
            Ok(stream) => stream,
            Err(HandshakeError::WouldBlock(_)) => {
                return Err(EmailError::Timeout(format!("TLS handshake with {target}")))
            }
            Err(HandshakeError::Failure(e)) => {
                let msg = e.to_string();
                return Err(if looks_like_timeout(&msg) {
                    EmailError::Timeout(format!("TLS handshake with {target}"))
                } else {
                    EmailError::TlsError(format!("{target}: {msg}"))
                });
            }
        };

        let mut client = imap::Client::new(tls);
        let greeting = client
            .read_greeting()
            .map_err(|e| map_imap_error(e, "waiting for the server greeting"))?;
        let greeting = String::from_utf8_lossy(&greeting);
        if greeting.starts_with("* BYE") {
            return Err(EmailError::ConnectionError(format!(
                "{target} refused the connection: {}",
                greeting.trim()
            )));
        }
        Ok(client)
    }
}

fn connect_any(addrs: &[SocketAddr]) -> io::Result<TcpStream> {
    let mut last_err = io::Error::new(io::ErrorKind::NotFound, "the host has no addresses");
    for addr in addrs {
        match TcpStream::connect_timeout(addr, IO_TIMEOUT) {
            Ok(stream) => return Ok(stream),
            Err(err) => last_err = err,
        }
    }
    Err(last_err)
}

/// A read/write that hit the socket timeout surfaces as WouldBlock (Unix) or TimedOut (Windows).
fn is_timeout(err: &io::Error) -> bool {
    matches!(err.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut)
        || looks_like_timeout(&err.to_string())
}

fn looks_like_timeout(msg: &str) -> bool {
    let msg = msg.to_ascii_lowercase();
    msg.contains("timed out")
        || msg.contains("timeout")
        || msg.contains("would block")
        || msg.contains("temporarily unavailable")
}

fn map_imap_error(err: imap::Error, context: &str) -> EmailError {
    match err {
        imap::Error::Io(e) if is_timeout(&e) => {
            EmailError::Timeout(format!("the server did not answer while {context}"))
        }
        imap::Error::Io(e) => EmailError::ConnectionError(format!("{context}: {e}")),
        imap::Error::ConnectionLost => {
            EmailError::ConnectionError(format!("the server closed the connection while {context}"))
        }
        imap::Error::Tls(e) if looks_like_timeout(&e.to_string()) => {
            EmailError::Timeout(format!("the server did not answer while {context}"))
        }
        imap::Error::Tls(e) => EmailError::TlsError(format!("{context}: {e}")),
        imap::Error::TlsHandshake(e) => EmailError::TlsError(format!("{context}: {e}")),
        imap::Error::No(msg) | imap::Error::Bad(msg) => {
            EmailError::ImapError(format!("{context}: {}", msg.trim()))
        }
        other => EmailError::ImapError(format!("{context}: {other}")),
    }
}

// ---------------------------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------------------------

/// Data of one FETCH response besides the raw message.
#[derive(Debug, Default, Clone)]
struct FetchMeta {
    uid: Option<u32>,
    seq: u32,
    internal_date_ms: Option<i64>,
    internal_date_text: Option<String>,
    /// The message is larger than the partial-fetch cap.
    truncated: bool,
}

fn build_message(raw: Option<&[u8]>, meta: &FetchMeta) -> EmailMessage {
    let id = meta
        .uid
        .map(|uid| uid.to_string())
        .unwrap_or_else(|| format!("seq-{}", meta.seq));
    let parsed = raw.and_then(|raw| MessageParser::default().parse(raw));

    let mut subject = String::new();
    let mut from = String::new();
    let mut header_date: Option<(i64, String)> = None;
    let mut text = String::new();
    let mut html: Option<String> = None;

    match &parsed {
        Some(message) => {
            subject = message.subject().unwrap_or_default().trim().to_string();
            from = format_from(message);
            header_date = message
                .date()
                .filter(|d| d.is_valid())
                .map(|d| (d.to_timestamp(), d.to_rfc822()));
            let (body_text, body_html) = message_bodies(message);
            text = body_text;
            html = body_html;
        }
        // mail-parser only gives up on empty input; show whatever bytes there are as plain text.
        None => {
            if let Some(raw) = raw {
                text = normalize_plain_text(&String::from_utf8_lossy(raw));
            }
        }
    }

    let timestamp = header_date
        .as_ref()
        .map(|(secs, _)| secs.saturating_mul(1000))
        .or(meta.internal_date_ms)
        .unwrap_or(0)
        .max(0) as u64;
    let date = header_date
        .map(|(_, text)| text)
        .or_else(|| meta.internal_date_text.clone())
        .unwrap_or_default();

    let mut verification_codes = extract_verification_codes(&format!("{subject}\n{text}"));
    if verification_codes.is_empty() {
        // Some senders put a useless stub in the text part and the code only in the HTML.
        if let Some(html) = &html {
            let rendered = html_to_text(html);
            if rendered != text {
                verification_codes = extract_verification_codes(&format!("{subject}\n{rendered}"));
            }
        }
    }

    let body_preview = if text.trim().is_empty() && meta.truncated {
        TOO_LARGE_PREVIEW.to_string()
    } else {
        make_preview(&text)
    };

    EmailMessage {
        id,
        subject,
        from,
        date,
        timestamp,
        body_preview,
        body_content: text,
        body_html: html,
        has_verification_code: !verification_codes.is_empty(),
        verification_codes,
    }
}

fn format_from(message: &Message) -> String {
    let Some(addr) = message.from().and_then(|a| a.first()) else {
        return String::new();
    };
    let name = addr.name().map(str::trim).filter(|n| !n.is_empty());
    let address = addr.address().map(str::trim).filter(|a| !a.is_empty());
    match (name, address) {
        (Some(name), Some(address)) => format!("{name} <{address}>"),
        (Some(name), None) => name.to_string(),
        (None, Some(address)) => address.to_string(),
        (None, None) => String::new(),
    }
}

/// (plain text, real HTML part). The text is the first non-empty text/plain part, otherwise a
/// text rendering of the HTML part.
fn message_bodies(message: &Message) -> (String, Option<String>) {
    let html = message.html_bodies().find_map(|part| match &part.body {
        PartType::Html(html) if !html.trim().is_empty() => Some(html.to_string()),
        _ => None,
    });
    let text = message
        .text_bodies()
        .find_map(|part| match &part.body {
            PartType::Text(text) if !text.trim().is_empty() => Some(normalize_plain_text(text)),
            _ => None,
        })
        .or_else(|| html.as_deref().map(html_to_text))
        .unwrap_or_default();
    (text, html)
}

/// Newest first by timestamp; equal or unknown timestamps fall back to the sequence number.
fn sort_newest_first(messages: &mut [(u32, EmailMessage)]) {
    messages.sort_by(|(seq_a, a), (seq_b, b)| {
        b.timestamp.cmp(&a.timestamp).then(seq_b.cmp(seq_a))
    });
}

fn make_preview(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > PREVIEW_CHARS {
        let cut: String = flat.chars().take(PREVIEW_CHARS).collect();
        format!("{}...", cut.trim_end())
    } else {
        flat
    }
}

fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}' | '\u{034F}' | '\u{00AD}'
            | '\u{200E}' | '\u{200F}'
    )
}

/// Trims every line, collapses runs of spaces, drops invisible characters (preheader padding)
/// and keeps at most one empty line between paragraphs.
fn tidy_lines(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank_pending = false;
    for line in text.split('\n') {
        let line: String = line.chars().filter(|c| !is_invisible(*c)).collect();
        let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            blank_pending = !out.is_empty();
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
            if blank_pending {
                out.push('\n');
            }
        }
        blank_pending = false;
        out.push_str(&line);
    }
    out
}

fn normalize_plain_text(text: &str) -> String {
    tidy_lines(&text.replace("\r\n", "\n").replace('\r', "\n"))
}

fn regex(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("invalid built-in regex"))
}

/// Text rendering of an HTML body: drops comments and script/style/head blocks, turns block
/// elements into line breaks, removes the remaining tags, decodes entities and collapses
/// whitespace. The result is only ever shown as text.
fn html_to_text(html: &str) -> String {
    static COMMENTS: OnceLock<Regex> = OnceLock::new();
    static HIDDEN: OnceLock<Regex> = OnceLock::new();
    static BREAKS: OnceLock<Regex> = OnceLock::new();
    static CELLS: OnceLock<Regex> = OnceLock::new();
    static TAGS: OnceLock<Regex> = OnceLock::new();

    let s = regex(&COMMENTS, r"(?s)<!--.*?(?:-->|\z)").replace_all(html, " ");
    let s = regex(
        &HIDDEN,
        r"(?is)<script\b[^>]*>.*?(?:</script\s*>|\z)|<style\b[^>]*>.*?(?:</style\s*>|\z)|<head\b[^>]*>.*?</head\s*>|<title\b[^>]*>.*?</title\s*>|<noscript\b[^>]*>.*?</noscript\s*>|<template\b[^>]*>.*?</template\s*>|<svg\b[^>]*>.*?</svg\s*>",
    )
    .replace_all(&s, " ");
    let s = regex(
        &BREAKS,
        r"(?i)<br\b[^>]*>|</?(?:p|div|tr|li|ul|ol|dl|dt|dd|h[1-6]|table|thead|tbody|tfoot|section|article|header|footer|nav|aside|main|blockquote|pre|hr|center|address|figure|figcaption|form|fieldset)\b[^>]*>",
    )
    .replace_all(&s, "\n");
    let s = regex(&CELLS, r"(?i)</?t[dh]\b[^>]*>").replace_all(&s, " ");
    let s = regex(&TAGS, r"<[A-Za-z/!?][^>]*>").replace_all(&s, "");
    tidy_lines(&decode_entities(&s))
}

fn decode_entities(text: &str) -> String {
    static ENTITY: OnceLock<Regex> = OnceLock::new();
    regex(
        &ENTITY,
        r"&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));",
    )
    .replace_all(text, |caps: &Captures| {
        let numeric = caps
            .get(1)
            .and_then(|m| m.as_str().parse::<u32>().ok())
            .or_else(|| caps.get(2).and_then(|m| u32::from_str_radix(m.as_str(), 16).ok()));
        if let Some(code) = numeric {
            return match char::from_u32(code) {
                Some(c) if is_invisible(c) || c == '\0' => String::new(),
                Some(c) if c.is_control() && c != '\n' && c != '\t' => " ".to_string(),
                Some(c) => c.to_string(),
                None => String::new(),
            };
        }
        let name = caps.get(3).map_or("", |m| m.as_str());
        match named_entity(name) {
            Some(value) => value.to_string(),
            None => caps[0].to_string(),
        }
    })
    .into_owned()
}

fn named_entity(name: &str) -> Option<&'static str> {
    Some(match name {
        "amp" | "AMP" => "&",
        "lt" | "LT" => "<",
        "gt" | "GT" => ">",
        "quot" | "QUOT" => "\"",
        "apos" => "'",
        "nbsp" | "ensp" | "emsp" | "thinsp" => " ",
        "zwnj" | "zwj" | "shy" | "lrm" | "rlm" => "",
        "ndash" => "\u{2013}",
        "mdash" => "\u{2014}",
        "hellip" => "\u{2026}",
        "copy" | "COPY" => "\u{00A9}",
        "reg" | "REG" => "\u{00AE}",
        "trade" => "\u{2122}",
        "laquo" => "\u{00AB}",
        "raquo" => "\u{00BB}",
        "lsquo" => "\u{2018}",
        "rsquo" => "\u{2019}",
        "sbquo" => "\u{201A}",
        "ldquo" => "\u{201C}",
        "rdquo" => "\u{201D}",
        "bdquo" => "\u{201E}",
        "bull" => "\u{2022}",
        "middot" => "\u{00B7}",
        "euro" => "\u{20AC}",
        "pound" => "\u{00A3}",
        "yen" => "\u{00A5}",
        "cent" => "\u{00A2}",
        "deg" => "\u{00B0}",
        "times" => "\u{00D7}",
        "divide" => "\u{00F7}",
        "rarr" => "\u{2192}",
        "larr" => "\u{2190}",
        _ => return None,
    })
}

// ---------------------------------------------------------------------------------------------
// Verification-code extraction
// ---------------------------------------------------------------------------------------------
//
// Candidates are 4–8 digit numbers and 5–8 character letter+digit tokens, matched as whole
// words (so digits inside longer runs never match). A candidate is scored by where the nearest
// keyword is, and noise (dates, phone numbers, prices, order numbers, URLs, copyright lines) is
// rejected. The `regex` crate has no look-around, so context checks are done in code; every
// check looks at a bounded window, so the work stays linear in the (capped) text size.
//
// Numbers in running text are the main source of false codes, so three rules hold throughout:
//   * Amounts are never codes: a currency or amount word on either side ("EUR 1250", "1250
//     UAH", "Total: 1250") makes the number noise, see `is_noise`.
//   * Counts are never codes: a number that runs on into an ordinary word ("2400 layoffs",
//     "3400 people", "1820 views") is a quantity unless a code-noun keyword phrase or an
//     announcement (":", "is") introduces it, see `runs_into_word`.
//   * Years (1900–2099) only count when announced ("Your code is 1987", "Code: 1987") or alone
//     on their line below the keyword; "confirm your 2026 elections" and "Advent of Code 2026"
//     are running text.
// When several candidates remain, the score decides, then a keyword phrase with a code noun
// ("code", "OTP", "PIN", "passcode", "код") beats a bare verb ("verify", "confirm").

/// The keyword is right before the code, separated only by punctuation and filler words.
const SCORE_DIRECT: u32 = 100;
/// The code stands alone on its line, with a keyword close by.
const SCORE_OWN_LINE: u32 = 90;
/// The keyword is earlier on the same line, in the same sentence.
const SCORE_SAME_LINE: u32 = 80;
/// The keyword ends its line and the code starts the next one, followed by more text:
/// "Your code is:\n482913 (expires in 10 minutes)".
const SCORE_NEXT_LINE: u32 = 75;
/// The code comes first: "123456 is your code", "Use 123456 to verify".
const SCORE_CODE_FIRST: u32 = 70;

/// Words allowed between a keyword and the code for a "direct" match.
const FILLER_WORDS: &[&str] = &[
    "is", "are", "was", "will", "be", "here", "s", "this", "your", "the", "a", "an", "below",
    "follows", "following", "of", "for", "you", "to", "use", "enter", "please", "with", "using",
    "it", "as", "number", "це", "є", "ваш", "ваша", "ваше", "вашого", "наступний", "нижче",
    "ось", "такий", "для", "введіть", "використовуйте", "вот", "следующий", "ниже", "введите",
    "это",
];

/// A keyword preceded by one of these words is not about verification ("promo code", "zip
/// code", "order confirmation", "anti-phishing code", "VAT code", "Registry code", "Reference
/// code").
const NON_VERIFICATION_QUALIFIERS: &[&str] = &[
    "promo", "promotional", "discount", "coupon", "gift", "voucher", "referral", "invite",
    "invitation", "postal", "zip", "area", "country", "dialing", "error", "status", "source",
    "qr", "bar", "dress", "order", "booking", "reservation", "payment", "purchase", "shipping",
    "delivery", "subscription", "tracking", "customer", "client", "member", "product", "item",
    "vat", "tax", "phishing", "antiphishing", "trip", "flight", "travel", "hotel", "ticket",
    "rental", "registry", "register", "reference", "ref", "sort", "номер", "замовлення", "заказа",
    "оплати", "оплаты",
    "промо", "знижковий", "скидочный", "подарунковий", "подарочный", "реферальний",
    "реферальный", "поштовий", "почтовый", "ідентифікаційний", "идентификационный",
    "податковий", "налоговый", "антифішинговий", "антифишинговый", "фішинговий", "фишинговый",
];

/// "<one of these> registration code" is a company registry number, while a bare
/// "Registration code: 482913" is a sign-up code.
const REGISTRY_OWNERS: &[&str] = &[
    "company", "business", "corporate", "legal", "state", "vehicle", "tax", "trade",
];

/// A keyword followed by one of these words is not about verification ("код ЄДРПОУ", "Код
/// товару", "Код отримувача" (payee), "Код банку", "Код бюджетної класифікації", "confirm your
/// subscription", "confirm delivery details").
const NON_VERIFICATION_FOLLOWERS: &[&str] = &[
    "єдрпоу", "едрпоу", "edrpou", "іпн", "инн", "кпп", "огрн", "мфо", "iban", "swift", "bic",
    "рнокпп", "дрфо", "отримувача", "получателя", "платника", "плательщика", "банку", "банка",
    "бюджетної", "бюджетной", "класифікації", "классификации", "платежу", "платежа",
    "товару", "товара", "продукту", "продукта", "клієнта", "клиента", "product", "item", "vat",
    "tax", "sort", "bank", "subscription", "newsletter", "delivery", "order", "address",
    "details", "booking", "reservation", "appointment", "attendance", "purchase", "payment",
    "підписку", "доставку", "замовлення", "адресу", "подписку", "заказ", "доставки",
];

/// What a confirm/verify keyword can still ask a code for ("Confirm payment: 482913", "Use
/// 482913 to confirm your purchase", "Код підтвердження платежу: 482913"). Such a keyword only
/// vouches for a code right next to it, see [`KeywordKind::Transaction`]; these words may stand
/// between it and the code.
const TRANSACTION_WORDS: &[&str] = &[
    "order", "purchase", "payment", "transaction", "замовлення", "заказ", "заказа", "платежу",
    "платежа", "оплати", "оплаты", "покупки", "транзакції", "транзакции",
];

/// "<one of these> code" always names a sign-in code ("login code", "security code", "sign-in
/// code", "one-time code"), whatever shop wording is around it. Two-word forms are joined with
/// a space.
const AUTH_QUALIFIERS: &[&str] = &[
    "login", "logon", "signin", "sign in", "log in", "log on", "access", "security",
    "authentication", "auth", "2fa", "mfa", "one time", "two factor", "guard", "входу", "входа",
    "доступу", "доступа", "безпеки", "безопасности",
];

/// "Confirmation <one of these>" is a booking or delivery reference ("Confirmation number:
/// 48291037"), not a code.
const REFERENCE_NOUNS: &[&str] = &["number", "no", "nr", "id"];

/// "Authorization code" / "Код авторизації" next to an amount is the approval code of a card
/// payment receipt. Without an amount nearby it stays a sign-in code.
const RECEIPT_CODE_WORDS: &[&str] = &[
    "authorization", "authorisation", "approval", "авторизації", "авторизации", "авторизація",
    "авторизация",
];

/// The usual call to action of a promo code ("Use code SAVE20", "Введите код SKIDKA25").
const PROMO_VERBS: &[&str] = &[
    "use", "enter", "apply", "redeem", "введите", "введіть", "используйте", "використовуйте",
    "примените", "застосуйте",
];

/// US state and territory abbreviations, for postal codes ("Austin, TX 78701").
const US_STATES: &[&str] = &[
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
    "VA", "WA", "WV", "WI", "WY", "DC", "PR",
];

/// Skipped when looking for the word after a keyword ("confirm your subscription",
/// "код за ЄДРПОУ").
const FOLLOWER_SKIP_WORDS: &[&str] = &[
    "your", "the", "a", "an", "our", "ваш", "вашу", "ваше", "вашої", "свою", "свій", "за", "по",
];

/// How far (in characters) the sentence around a keyword is inspected for marketing words.
const SENTENCE_CHARS: usize = 120;

/// A number right after one of these words is an identifier, not a code.
const IDENTIFIER_WORDS: &[&str] = &[
    "order", "invoice", "ticket", "booking", "reservation", "reference", "ref", "tracking", "id",
    "no", "nr", "account", "acct", "card", "phone", "tel", "fax", "call", "ending", "ext",
    "room", "suite", "unit", "customer", "client", "member", "box", "street", "st", "ave",
    "location", "case", "request", "application", "замовлення", "рахунок", "рахунку", "телефон", "тел",
    "картка", "карта", "заказ", "заказа", "счет", "счёт", "клієнта", "клиента", "звернення",
    "заявка", "заявки", "запит", "запиту", "обращение", "обращения", "запрос", "запроса",
];

/// The first word of a remark that may follow a code opening the line after its keyword:
/// "482913 (expires in 10 minutes)", "482913 - valid for 5 minutes", "482913 is your code".
/// Anything else makes the token the start of a new sentence ("9f2e7d3 Add tests" in a list
/// of commits under "Fix verification code parser").
const REMARK_WORDS: &[&str] = &[
    "expires", "expire", "expiring", "valid", "is", "will", "it", "this", "code", "use",
    "enter", "do", "дійсний", "дійсна", "діє", "спливає", "це", "действителен", "действует",
    "истекает", "это",
];

/// Verb forms that report something instead of asking for a code: past participles ("account
/// verified", "підтверджено") and the third person of news headlines ("Google confirms 2400
/// layoffs", "Apple verifies 1500 apps", "Мінфін підтверджує ...").
fn reports_state(keyword: &str) -> bool {
    let word = keyword.to_lowercase();
    if word.starts_with("verif") || word.starts_with("confirm") {
        return word.ends_with("ed") || word == "confirms" || word == "verifies";
    }
    matches!(
        word.as_str(),
        "підтверджено" | "підтверджений" | "підтверджена" | "підтверджені" | "подтверждено"
            | "подтвержден" | "подтверждена" | "подтверждены" | "подтвержденный" | "підтверджує"
            | "підтверджують" | "подтверждает" | "подтверждают"
    )
}

/// A number followed by one of these words is an amount (price, limit, reward), not a code:
/// "1499 UAH", "50000 USDT per day", "10000 bonus points", "2500 points".
const AMOUNT_WORDS: &[&str] = &[
    "usd", "eur", "uah", "gbp", "pln", "rub", "грн", "руб", "дол", "євро", "евро", "usdt",
    "usdc", "btc", "eth", "bnb", "points", "pts", "bonus", "coins", "credits", "miles", "tokens",
    "бонусів", "бонуси", "бонусов", "балів", "бали", "баллов",
];

/// A number right after one of these words is an amount: a currency code ("EUR 1250", "USD
/// 2500", "UAH 4250") or an amount label ("Total: 1250", "на суму 1250").
const AMOUNT_PREFIXES: &[&str] = &[
    "usd", "eur", "uah", "gbp", "pln", "rub", "chf", "cad", "aud", "jpy", "cny", "czk", "sek",
    "nok", "dkk", "huf", "inr", "грн", "руб", "usdt", "usdc", "btc", "eth", "amount", "total",
    "sum", "subtotal", "balance", "price", "сума", "суму", "сумма", "сумму", "разом", "итого",
];

/// Words that may follow a code inside its sentence, besides [`FILLER_WORDS`] and
/// [`REMARK_WORDS`]: "Use 482913 within 10 minutes", "482913 ist Ihr Code", "Введіть 482913 у
/// застосунку". Any other lowercase word after a number makes it a quantity, see
/// [`runs_into_word`].
const CODE_FOLLOWERS: &[&str] = &[
    "and", "or", "at", "on", "in", "into", "within", "before", "until", "when", "if", "by",
    "from", "now", "today", "then", "only", "once", "ist", "est", "і", "й", "та", "и", "або", "или",
    "на", "в", "у", "до", "не", "щоб", "чтобы", "протягом", "твій", "твой",
];

/// "ending in 4567", "закінчується на 4567": the tail of a card or phone number.
fn is_number_tail(connector: &str, verb: &str) -> bool {
    matches!(connector, "in" | "with" | "на")
        && ["end", "закінч", "заканч", "оканч"].iter().any(|stem| verb.starts_with(stem))
}

/// "в VK ID: 482913", "для Яндекс ID: 482019": "ID" after a capitalised brand name and a
/// preposition names the service the code is for, it does not label the number. "for Customer
/// ID 48291" still does: the word before "ID" must not be an identifier owner.
fn is_service_id(text: &str, id_start: usize) -> bool {
    let (brand, brand_start) = word_before_at(text, id_start);
    let (preposition, _) = word_before_at(text, brand_start);
    let owner = IDENTIFIER_WORDS.contains(&brand.as_str())
        || NON_VERIFICATION_QUALIFIERS.contains(&brand.as_str())
        || matches!(brand.as_str(), "user" | "transaction" | "meeting" | "session" | "terminal" | "merchant");
    text[brand_start..].chars().next().is_some_and(char::is_uppercase)
        && !owner
        && matches!(preposition.as_str(), "for" | "to" | "into" | "в" | "у" | "до" | "для")
}

// Promo-code wording. A bare "code" is a promo code when
//   (a) its sentence has sale wording: discount, coupon, promo, voucher, "% off", "$10 off", or
//   (b) its sentence has shop wording (shop, sale, checkout) together with a price or a promo
//       call to action ("use code", "введите код"), or
//   (c) sale wording is on one of the next two lines, with no blank line in between: the
//       usual coupon layout "Your code:\nGIFT2026\n15% off your next order", or
//   (d) sale wording is in the sentence right before or after it ("Your code SPRING25 expires
//       at midnight. Save 25% on everything.").
// (c) and (d) do not apply when the keyword's own sentence names a sign-in ("Use code 482913
// to sign in. Get 20% off later!", "Here's the code you need to log in:\n830215\n...20% off").
// Shop wording alone is not enough: "Your checkout code: 482913" and "Your code for Sales Hub
// sign-in: 482913" are ordinary verification mails.

fn sale_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(
        &RE,
        r"(?i)discounts?|coupons?|promo(?:tional|tions?)?|vouchers?|знижк\w*|скидк\w*|купон\w*|промокод\w*|% off|[$€£₴]\s?[0-9]+(?:[.,][0-9]+)? off|save (?:up to )?(?:[0-9]+%|[$€£₴][0-9]+)",
    )
}

/// Sign-in wording. In the sentence of a keyword it names what the code is for, which beats
/// booking context ("Use this passcode to sign in") and promo wording in the next sentence.
fn auth_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(
        &RE,
        r"(?i)sign(?:ing)?[- ]?in|log(?:ging)?[- ]?(?:in|on)|login|logon|увійти|вхід\w*|вход\w*|войти",
    )
}

/// Meeting invitations and reservations: their "Passcode: 582910" joins a call, their "PIN
/// code: 4821" manages a hotel booking and their "Confirmation code: GJ7K2P" is an airline
/// record locator. None of them is a sign-in code. A passcode or PIN introduced as a one-time
/// or login code, or one whose sentence names a sign-in, stays a sign-in code even in a travel
/// mail: "Your one-time passcode is 662091. Book flights with us."
fn reservation_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(
        &RE,
        r"(?i)meeting|webinar|conference|booking|booked|reservations?|check-in|hotels?|flights?|flying|airlines?|itinerary|boarding|зустріч\w*|конференц\w*|вебінар\w*|вебинар\w*|встреч\w*|бронюванн\w*|бронировани\w*|рейс\w*|готел\w*|гостиниц\w*",
    )
}

fn shop_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(&RE, r"(?i)checkout|sales?|shop(?:ping)?|при оформлен\w*")
}

fn price_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(&RE, r"(?i)[$€£₴]\s?[0-9]+|[0-9]+\s?(?:грн|uah|usd|eur)")
}

/// Spans (in order) of the wording that turns a code keyword into something else (promo
/// codes, receipt approval codes, meeting passcodes, booking PINs and record locators), and of
/// the sign-in wording that keeps it a sign-in code.
struct ContextSpans {
    sale: Vec<(usize, usize)>,
    shop: Vec<(usize, usize)>,
    price: Vec<(usize, usize)>,
    reservation: Vec<(usize, usize)>,
    auth: Vec<(usize, usize)>,
}

impl ContextSpans {
    fn find(text: &str) -> Self {
        ContextSpans {
            sale: whole_word_matches(sale_regex(), text),
            shop: whole_word_matches(shop_regex(), text),
            price: whole_word_matches(price_regex(), text),
            reservation: whole_word_matches(reservation_regex(), text),
            auth: whole_word_matches(auth_regex(), text),
        }
    }

    /// Whether the keyword at `start..end` has sign-in wording in its sentence.
    fn names_sign_in(&self, text: &str, start: usize, end: usize) -> bool {
        in_same_sentence(text, &self.auth, start, end)
    }

    /// Whether the bare "code" keyword at `start..end` is a promo code, see the rules above.
    fn is_promo(&self, text: &str, start: usize, end: usize, promo_call: bool) -> bool {
        let near = |spans: &[(usize, usize)]| in_same_sentence(text, spans, start, end);
        if near(&self.sale) || (near(&self.shop) && (promo_call || near(&self.price))) {
            return true;
        }
        // Sale wording outside its own sentence does not outweigh a sign-in named in it.
        (on_next_lines(text, &self.sale, end) || in_neighbour_sentence(text, &self.sale, start, end))
            && !self.names_sign_in(text, start, end)
    }
}

/// Whether one of `spans` (in order) is on one of the two lines after the line of `pos`, within
/// `SENTENCE_CHARS` characters and with no blank line in between.
fn on_next_lines(text: &str, spans: &[(usize, usize)], pos: usize) -> bool {
    let idx = spans.partition_point(|(s, _)| *s < pos);
    spans[idx..]
        .iter()
        .take_while(|(s, _)| chars_within(text, pos, *s, SENTENCE_CHARS))
        .any(|&(s, _)| {
            // The lines after the keyword's line; the last one is the start of the span's line.
            let lines: Vec<&str> = text[pos..s].split('\n').skip(1).collect();
            (1..=2).contains(&lines.len())
                && lines[..lines.len() - 1].iter().all(|l| !l.trim().is_empty())
        })
}

/// Whether one of `spans` (in order) is within `max` characters of `start..end`, on any line.
fn near_span(text: &str, spans: &[(usize, usize)], start: usize, end: usize, max: usize) -> bool {
    let idx = spans.partition_point(|(s, _)| *s < start);
    let before = idx
        .checked_sub(1)
        .is_some_and(|i| chars_within(text, spans[i].1.min(start), start, max));
    let after = spans[idx..]
        .iter()
        .find(|(s, _)| *s >= end)
        .is_some_and(|&(s, _)| chars_within(text, end, s, max));
    before || after
}

/// Matches of `re` that are whole words. Unicode `\b` in the pattern would force the regex
/// engine off its fast path on non-ASCII text, so word boundaries are checked here instead.
fn whole_word_matches(re: &Regex, text: &str) -> Vec<(usize, usize)> {
    let is_word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    re.find_iter(text)
        .filter(|m| {
            let first = m.as_str().chars().next();
            let last = m.as_str().chars().next_back();
            (!is_word(first) || !is_word(text[..m.start()].chars().next_back()))
                && (!is_word(last) || !is_word(text[m.end()..].chars().next()))
        })
        .map(|m| (m.start(), m.end()))
        .collect()
}

fn keyword_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // "verif[iy]" covers verify/verified/verification/Verifizierung but not the brand
    // "Veriff", whose footer address ("Veriff OÜ, Niine 11, Tallinn 10414") is no code.
    regex(
        &RE,
        r"(?i)verif[iy]\w*|confirm\w*|codes?|otp|pin|passcode|one[- ]time|код\w*|підтвердж\w*|подтвержд\w*|перевірк\w*|одноразов\w*|верифікац\w*|верификац\w*",
    )
}

fn candidate_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // ASCII word boundaries keep this on the fast DFA path; adjacency to non-ASCII letters is
    // checked in `is_noise`.
    regex(&RE, r"(?-u:\b)[0-9A-Za-z]{4,8}(?-u:\b)")
}

fn unit_suffix_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(
        &RE,
        r"(?i)^[0-9]+(?:st|nd|rd|th|px|pt|em|rem|ms|s|sec|secs|min|mins|h|hr|hrs|hour|hours|day|days|gb|mb|kb|tb|k|m|x|usd|eur|uah)$",
    )
}

/// Extracts likely verification codes from `text` (subject and text body): most likely first,
/// without duplicates, at most 5.
pub fn extract_verification_codes(text: &str) -> Vec<String> {
    let text = truncate_at_char_boundary(text, MAX_SCAN_BYTES);
    let keywords = keyword_spans(text);
    if keywords.iter().all(|k| k.kind == KeywordKind::Other) {
        return Vec::new();
    }

    // '_' is a word character for the regex, so "_482913_" (markdown emphasis) would never
    // match; scan a copy where it is a space. Same byte length, so offsets stay valid for `text`.
    let scan: std::borrow::Cow<str> = if text.contains('_') {
        std::borrow::Cow::Owned(text.replace('_', " "))
    } else {
        std::borrow::Cow::Borrowed(text)
    };
    let notices: Vec<(usize, usize)> = notice_regex()
        .find_iter(text)
        .map(|m| (m.start(), m.end()))
        .collect();
    let mut scored: Vec<(Vouch, usize, &str)> = Vec::new();
    for m in candidate_regex().find_iter(&scan) {
        let token = &text[m.start()..m.end()];
        let Some(shape) = TokenShape::of(token) else {
            continue;
        };
        // Scoring is cheap for candidates far from any keyword, so it runs before the noise
        // checks; both must pass.
        let Some(vouch) = score_candidate(text, &keywords, m.start(), m.end(), shape) else {
            continue;
        };
        if is_noise(text, &notices, m.start(), m.end()) {
            continue;
        }
        // A year alone on its line next to a copyright notice ("\u{00A9}\n2026") is a footer.
        if vouch.score == SCORE_OWN_LINE
            && is_year_like(token)
            && near_span(text, &notices, m.start(), m.end(), CONTEXT_CHARS)
        {
            continue;
        }
        scored.push((vouch, m.start(), token));
    }

    // Best layout first, then the code-noun phrase over a bare verb, then the earliest.
    scored.sort_by(|a, b| {
        b.0.score.cmp(&a.0.score).then(b.0.strong.cmp(&a.0.strong)).then(a.1.cmp(&b.1))
    });

    let mut codes: Vec<String> = Vec::new();
    for (_, _, token) in scored {
        if !codes.iter().any(|c| c == token) {
            codes.push(token.to_string());
            if codes.len() == MAX_CODES {
                break;
            }
        }
    }
    codes
}

fn truncate_at_char_boundary(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// What a keyword occurrence says about a number next to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeywordKind {
    /// Asks for a code: "verification code", "Your code is", "OTP".
    Verification,
    /// Confirm/verify a payment, purchase or order. In 3-D Secure and payment mails this asks
    /// for a code, but the same words fill order and shipping mails, so it only vouches for a
    /// code right next to it: "Confirm payment: 482913", "Use 482913 to confirm your payment".
    Transaction,
    /// Not about verification: "promo code", "zip code", "account verified". Kept so that a
    /// number next to it is attributed to it and not to a verification keyword further away.
    Other,
}

/// A keyword occurrence: byte span, kind, and whether its phrase names a code.
#[derive(Debug, Clone, Copy)]
struct Keyword {
    start: usize,
    end: usize,
    kind: KeywordKind,
    /// The keyword phrase it belongs to has a code noun ("verification code", "one-time
    /// passcode", "Код підтвердження"), not only a verb ("verify your", "confirm with").
    strong: bool,
}

/// Keywords that name the code itself rather than the act of verifying.
fn is_code_noun(keyword: &str) -> bool {
    let word = keyword.to_lowercase();
    matches!(word.as_str(), "code" | "codes" | "otp" | "pin" | "passcode")
        || word.starts_with("one")
        || word.starts_with("код")
        || word.starts_with("одноразов")
}

/// Keyword occurrences, in order.
///
/// Keywords separated only by spaces or a hyphen form one phrase ("verification code", "Код
/// підтвердження платежу"). Every keyword of a phrase with a code noun is `strong`, and in a
/// phrase whose code noun asks for a code, a confirm keyword about a payment is part of that
/// request: "Код підтвердження платежу" is a payment confirmation code (3-D Secure), not a
/// "confirm your payment" call to action.
fn keyword_spans(text: &str) -> Vec<Keyword> {
    let spans = whole_word_matches(keyword_regex(), text);
    if spans.is_empty() {
        return Vec::new();
    }
    let context = ContextSpans::find(text);
    let mut keywords: Vec<Keyword> = spans
        .into_iter()
        .map(|(start, end)| Keyword {
            start,
            end,
            kind: classify_keyword(text, &context, start, end),
            strong: is_code_noun(&text[start..end]),
        })
        .collect();
    let joined = |a: &Keyword, b: &Keyword| text[a.end..b.start].chars().all(|c| c == ' ' || c == '-');
    let mut first = 0;
    while first < keywords.len() {
        let mut last = first;
        while last + 1 < keywords.len() && joined(&keywords[last], &keywords[last + 1]) {
            last += 1;
        }
        let phrase = &mut keywords[first..=last];
        let strong = phrase.iter().any(|k| k.strong);
        let asks_code = phrase.iter().any(|k| k.strong && k.kind == KeywordKind::Verification);
        for k in phrase.iter_mut() {
            k.strong = strong;
            if asks_code && k.kind == KeywordKind::Transaction {
                k.kind = KeywordKind::Verification;
            }
        }
        first = last + 1;
    }
    keywords
}

/// Decides from the keyword's form and its context whether it asks for a code.
fn classify_keyword(text: &str, context: &ContextSpans, start: usize, end: usize) -> KeywordKind {
    use KeywordKind::*;
    let keyword = text[start..end].to_lowercase();
    if reports_state(&keyword) {
        return Other;
    }
    let (before, before_start) = word_before_at(text, start);
    if NON_VERIFICATION_QUALIFIERS.contains(&before.as_str()) {
        return Other;
    }
    let (two_before, _) = word_before_at(text, before_start);
    if before == "registration" && REGISTRY_OWNERS.contains(&two_before.as_str()) {
        return Other;
    }
    let after = word_after(text, end);
    let confirms = ["confirm", "підтвердж", "подтвержд"].iter().any(|stem| keyword.starts_with(stem));
    // "Confirmation number: 48291037" is a booking reference.
    if confirms && REFERENCE_NOUNS.contains(&after.as_str()) {
        return Other;
    }
    // "Authorization code: 482913" under "Amount: 59.99 EUR" is a card receipt.
    if (RECEIPT_CODE_WORDS.contains(&before.as_str()) || RECEIPT_CODE_WORDS.contains(&after.as_str()))
        && near_span(text, &context.price, start, end, CONTEXT_CHARS)
    {
        return Other;
    }
    // "login code", "sign-in code", "one-time passcode", "login PIN": always a sign-in code,
    // whatever surrounds it (booking, shop or meeting wording).
    if AUTH_QUALIFIERS.contains(&before.as_str())
        || AUTH_QUALIFIERS.contains(&format!("{two_before} {before}").as_str())
    {
        return Verification;
    }
    // Near meeting or booking wording, a passcode joins a call ("Meeting ID: 848 2913 0583\n
    // Passcode: 582910"), a PIN manages a booking ("Booking number: 4829130583\nPIN: 4821") and
    // a confirmation code is a record locator ("Thanks for flying with Delta.\nConfirmation
    // code: GJ7K2P"). Both words of "PIN code" / "Confirmation code" are classified the same,
    // so the number is not claimed by the other one. Sign-in wording in the keyword's own
    // sentence wins over the context ("Use this passcode to sign in").
    let codes_word = |w: &str| w == "code" || w == "codes";
    let reservation_word = matches!(keyword.as_str(), "passcode" | "pin")
        || (codes_word(&keyword) && matches!(before.as_str(), "pin" | "confirmation"))
        || (keyword == "confirmation" && codes_word(&after));
    if reservation_word
        && near_span(text, &context.reservation, start, end, CONTEXT_CHARS)
        && !context.names_sign_in(text, start, end)
    {
        return Other;
    }
    if NON_VERIFICATION_FOLLOWERS.contains(&after.as_str()) {
        let confirms_or_verifies = confirms || keyword.starts_with("verif");
        return if confirms_or_verifies && TRANSACTION_WORDS.contains(&after.as_str()) {
            Transaction
        } else {
            Other
        };
    }
    // Only a bare "code" can be a promo code; "verification code", "код підтвердження" or an
    // OTP keyword stay verification keywords next to shop wording ("При оформлении заказа
    // введите код подтверждения").
    let bare_code = matches!(keyword.as_str(), "code" | "codes" | "код" | "коду" | "кодом");
    let is_keyword = |word: &str| whole_word_matches(keyword_regex(), word).first() == Some(&(0, word.len()));
    if !bare_code || is_keyword(&before) || is_keyword(&after) {
        return Verification;
    }
    if context.is_promo(text, start, end, PROMO_VERBS.contains(&before.as_str())) {
        Other
    } else {
        Verification
    }
}

/// Spaces, '-' and ':' on the same line (what separates a keyword from its neighbour words).
fn is_word_separator(c: char) -> bool {
    c != '\n' && (c.is_whitespace() || c == '-' || c == ':')
}

/// The lowercased word after `pos` on the same line, skipping separators and up to two words
/// of [`FOLLOWER_SKIP_WORDS`].
fn word_after(text: &str, pos: usize) -> String {
    let mut rest = &text[pos..];
    for _ in 0..3 {
        rest = rest.trim_start_matches(is_word_separator);
        let len: usize = rest
            .chars()
            .take_while(|c| c.is_alphanumeric())
            .take(CONTEXT_CHARS)
            .map(char::len_utf8)
            .sum();
        let word = rest[..len].to_lowercase();
        if !FOLLOWER_SKIP_WORDS.contains(&word.as_str()) {
            return word;
        }
        rest = &rest[len..];
    }
    String::new()
}

/// Whether one of `spans` (in order) is in the same sentence as `start..end`, within
/// `SENTENCE_CHARS` characters. Only the nearest one on each side can qualify.
fn in_same_sentence(text: &str, spans: &[(usize, usize)], start: usize, end: usize) -> bool {
    let breaks = |gap: &str| gap.contains('\n') || has_sentence_break(gap) || gap.ends_with(['.', '!', '?']);
    let idx = spans.partition_point(|(s, _)| *s < start);
    let before = idx.checked_sub(1).map(|i| spans[i]).is_some_and(|(s, e)| {
        chars_within(text, s, start, SENTENCE_CHARS) && !breaks(&text[e.min(start)..start])
    });
    let after = spans[idx..]
        .iter()
        .find(|(s, _)| *s >= end)
        .is_some_and(|&(s, e)| chars_within(text, end, e, SENTENCE_CHARS) && !breaks(&text[end..s]));
    before || after
}

/// Sentence ends in `gap`: line breaks and '.', '!' or '?' before a space or at the end.
fn sentence_breaks(gap: &str) -> usize {
    let mut count = 0;
    let mut prev = ' ';
    for c in gap.chars() {
        if c == '\n' || (c == ' ' && matches!(prev, '.' | '!' | '?')) {
            count += 1;
        }
        prev = c;
    }
    count + usize::from(matches!(prev, '.' | '!' | '?'))
}

/// Whether one of `spans` (in order) is in the sentence right before or after the one of
/// `start..end`: within `SENTENCE_CHARS` characters, at most one sentence end in between and
/// no blank line. Only the nearest one on each side can qualify.
fn in_neighbour_sentence(text: &str, spans: &[(usize, usize)], start: usize, end: usize) -> bool {
    let close = |gap: &str| !gap.contains("\n\n") && sentence_breaks(gap) <= 1;
    let idx = spans.partition_point(|(s, _)| *s < start);
    let before = idx.checked_sub(1).map(|i| spans[i]).is_some_and(|(s, e)| {
        chars_within(text, s, start, SENTENCE_CHARS) && close(&text[e.min(start)..start])
    });
    let after = spans[idx..]
        .iter()
        .find(|(s, _)| *s >= end)
        .is_some_and(|&(s, e)| chars_within(text, end, e, SENTENCE_CHARS) && close(&text[end..s]));
    before || after
}

/// The lowercased word right before `pos` on the same line, skipping spaces, '-' and ':'.
fn word_before(text: &str, pos: usize) -> String {
    word_before_at(text, pos).0
}

/// [`word_before`] and the byte offset where that word starts (`pos` minus the skipped
/// separators when there is no word).
fn word_before_at(text: &str, pos: usize) -> (String, usize) {
    let trimmed = text[..pos].trim_end_matches(is_word_separator);
    let word_start = trimmed
        .char_indices()
        .rev()
        .take(CONTEXT_CHARS)
        .take_while(|(_, c)| c.is_alphanumeric())
        .last()
        .map_or(trimmed.len(), |(i, _)| i);
    (trimmed[word_start..].to_lowercase(), word_start)
}

/// What a candidate token is made of; it decides which positions can vouch for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenShape {
    /// "482913": any scoring rule.
    Digits,
    /// "7bpt5n9d", "XK9P2Q": only right after a keyword or alone on its line.
    Mixed,
    /// "KBRTW", "bqtzmkfa" (Steam Guard, X): random letters can be a code too, but so can any
    /// word, so only in the two strongest layouts, see [`score_candidate`].
    Letters,
}

impl TokenShape {
    fn of(token: &str) -> Option<Self> {
        let digits = token.bytes().filter(u8::is_ascii_digit).count();
        if digits == token.len() {
            Some(TokenShape::Digits)
        } else if token.len() < 5 {
            None
        } else if digits > 0 {
            (!unit_suffix_regex().is_match(token)).then_some(TokenShape::Mixed)
        } else {
            is_random_letters(token).then_some(TokenShape::Letters)
        }
    }
}

/// Letters that do not read as a word: a single case (not "Thanks", "Steam") and at most one
/// vowel in four characters ("KBRTW", "bqtzmkfa", but not "HELLO" or "valid"). Random letters
/// pass this most of the time (Steam Guard codes have no vowels at all).
fn is_random_letters(token: &str) -> bool {
    let single_case = token.bytes().all(|b| b.is_ascii_uppercase()) || token.bytes().all(|b| b.is_ascii_lowercase());
    let vowels = token
        .bytes()
        .filter(|b| matches!(b.to_ascii_lowercase(), b'a' | b'e' | b'i' | b'o' | b'u' | b'y'))
        .count();
    single_case && vowels * 4 <= token.len()
}

/// Four digits from 1900 to 2099.
fn is_year_like(token: &str) -> bool {
    token.len() == 4 && token.parse::<u32>().is_ok_and(|n| (1900..=2099).contains(&n))
}

fn is_currency_symbol(c: char) -> bool {
    matches!(c, '$' | '€' | '£' | '¥' | '₴' | '₽' | '¢' | '₿')
}

/// Rejects numbers that are part of dates, times, phone numbers, prices, identifiers, URLs,
/// email addresses or copyright lines.
fn is_noise(text: &str, notices: &[(usize, usize)], start: usize, end: usize) -> bool {
    // Markdown emphasis from html2text-style plain parts: *482913*, **482913**, _482913_. Judge
    // the token by what is around the emphasis instead.
    let is_emphasis = |b: &u8| matches!(b, b'*' | b'_');
    let lead = text[..start].bytes().rev().take(4).take_while(is_emphasis).count();
    let trail = text[end..].bytes().take(4).take_while(is_emphasis).count();
    if (1..=3).contains(&lead) && trail == lead && text[start - lead..start] == text[end..end + lead] {
        return is_noise(text, notices, start - lead, end + lead);
    }

    let mut before = text[..start].chars().rev();
    let (b1, b2, b3) = (before.next(), before.next(), before.next());
    let mut after = text[end..].chars();
    let (a1, a2) = (after.next(), after.next());
    let is_digit = |c: Option<char>| c.is_some_and(|c| c.is_ascii_digit());

    // Part of a longer word ("код123456", "1234мм").
    if b1.is_some_and(char::is_alphanumeric) || a1.is_some_and(char::is_alphanumeric) {
        return true;
    }
    let joiner = |c: Option<char>| matches!(c, Some('-' | '.' | ',' | ':' | '/' | ' '));

    // Identifiers, phone prefixes, prices, URL/query parts.
    if matches!(b1, Some('#' | '№' | '+' | '@' | '/' | '\\' | '=' | '&' | '?' | '%' | '_' | '*'))
        || b1.is_some_and(is_currency_symbol)
    {
        return true;
    }
    // Dates, times, decimals, grouped digits (phone numbers): 14.11.2025, 555-0199, 1 234 567.
    if (joiner(b1) && is_digit(b2)) || (joiner(a1) && is_digit(a2)) {
        return true;
    }
    // The visible tail of a masked phone or card number: ***-***-4567, xxx-xxx-4567. Only '-'
    // counts as the joiner: "**Your code is** 482913" is markdown emphasis.
    let is_mask = |c: Option<char>| matches!(c, Some('*' | '•' | 'x' | 'X'));
    if b1 == Some('-') && is_mask(b2) && is_mask(b3) {
        return true;
    }
    if b1 == Some(' ') && (b2.is_some_and(is_currency_symbol) || (b2 == Some(')') && is_digit(b3)))
    {
        return true;
    }
    if matches!(a1, Some('%' | '@' | '/' | '=' | '_' | '*')) || a1.is_some_and(is_currency_symbol)
    {
        return true;
    }
    if a1 == Some(' ') && a2.is_some_and(is_currency_symbol) {
        return true;
    }
    let rest: String = text[end..]
        .trim_start_matches(' ')
        .chars()
        .take(8)
        .collect::<String>()
        .to_lowercase();
    if AMOUNT_WORDS.iter().any(|w| {
        rest.starts_with(w) && !rest[w.len()..].chars().next().is_some_and(char::is_alphabetic)
    }) {
        return true;
    }

    // Whitespace-delimited chunk: URL, email address, path or query string. Prose has no
    // chunks this long, so a longer one counts as noise too (it also bounds the work).
    let chunk_start = match text[..start]
        .char_indices()
        .rev()
        .take(CONTEXT_CHARS)
        .find(|(_, c)| c.is_whitespace())
    {
        Some((i, c)) => i + c.len_utf8(),
        None if text[..start].chars().nth(CONTEXT_CHARS).is_none() => 0,
        None => return true,
    };
    let chunk_end = match text[end..]
        .char_indices()
        .take(CONTEXT_CHARS)
        .find(|(_, c)| c.is_whitespace())
    {
        Some((i, _)) => end + i,
        None if text[end..].chars().nth(CONTEXT_CHARS).is_none() => text.len(),
        None => return true,
    };
    let chunk = &text[chunk_start..chunk_end];
    if chunk.contains("://")
        || chunk.contains("www.")
        || chunk.contains('@')
        || chunk.contains('=')
        || chunk.contains('/')
        || chunk.contains('\\')
    {
        return true;
    }

    if is_us_postal_code(text, start, end) {
        return true;
    }

    if near_notice(text, notices, start, end) {
        return true;
    }

    let (word, word_start) = word_before_at(text, start);
    // "EUR 1250", "Total: 1250": an amount.
    if AMOUNT_PREFIXES.contains(&word.as_str()) {
        return true;
    }
    if IDENTIFIER_WORDS.contains(&word.as_str()) {
        return !(word == "id" && is_service_id(text, word_start)) && !is_purpose_object(text, &word, word_start, start);
    }
    let two_before = word_before(text, word_start);
    // "account number 48291037", "case number 04829137".
    if word == "number" && IDENTIFIER_WORDS.contains(&two_before.as_str()) {
        return true;
    }
    is_number_tail(&word, &two_before)
}

/// "Use this code to verify your account: 48291037", "Your code to sign in to your account:
/// 482913", "Код підтвердження замовлення: 482913": the identifier word before the number is
/// the object of what the code is for, and a colon introduces the code. "Account: 48291037",
/// "your account 48291037" and "Confirm order no 123456" still label it.
fn is_purpose_object(text: &str, word: &str, word_start: usize, start: usize) -> bool {
    let word_end = text[..start].trim_end_matches(is_word_separator).len();
    if !text[word_end..start].contains(':') {
        return false;
    }
    let (determiner, determiner_start) = word_before_at(text, word_start);
    // An order right after a confirm/verify keyword: "Код підтвердження замовлення:".
    if TRANSACTION_WORDS.contains(&word)
        && ["confirm", "verif", "підтвердж", "подтвержд"].iter().any(|stem| determiner.starts_with(stem))
    {
        return true;
    }
    if !matches!(determiner.as_str(), "your" | "the") {
        return false;
    }
    // "... to your account:", "to <verb> your account:" or "... in the app:".
    let (verb, verb_start) = word_before_at(text, determiner_start);
    matches!(verb.as_str(), "to" | "into" | "in") || word_before(text, verb_start) == "to"
}

/// A US postal code in an address: five digits after a state abbreviation, which itself follows
/// a comma or a capitalised city name ("San Francisco, CA 94107", "Austin TX 78701"). Shouting
/// mail text ("YOUR CODE IS 48291") is not an address: "IS" is no state and "CODE" no city.
fn is_us_postal_code(text: &str, start: usize, end: usize) -> bool {
    let token = &text[start..end];
    if token.len() != 5 || !token.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let Some(head) = text[..start].strip_suffix(' ') else {
        return false;
    };
    let bytes = head.as_bytes();
    if bytes.len() < 2 || !bytes[bytes.len() - 2..].iter().all(u8::is_ascii_uppercase) {
        return false;
    }
    let (head, state) = head.split_at(head.len() - 2);
    if !US_STATES.contains(&state) {
        return false;
    }
    let Some(head) = head.strip_suffix(' ') else {
        return false;
    };
    if head.ends_with(',') {
        return true;
    }
    // The city's last word: an uppercase letter followed by lowercase ones.
    let city: Vec<char> = head
        .chars()
        .rev()
        .take(CONTEXT_CHARS)
        .take_while(|c| c.is_alphabetic())
        .collect();
    city.last().is_some_and(|c| c.is_uppercase())
        && city.len() > 1
        && city[..city.len() - 1].iter().all(|c| c.is_lowercase())
}

/// Copyright notices ("© 2024", "All rights reserved"): numbers on their line are not codes.
fn notice_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    regex(
        &RE,
        r"(?i)\x{00A9}|copyright|\(c\)|all rights reserved|права захищені|права защищены",
    )
}

/// Whether a copyright notice is on the candidate's line within `CONTEXT_CHARS` characters.
/// `notices` are the notice spans in order; only the nearest one on each side can qualify.
fn near_notice(text: &str, notices: &[(usize, usize)], start: usize, end: usize) -> bool {
    let idx = notices.partition_point(|(s, _)| *s < start);
    let before = idx.checked_sub(1).map(|i| notices[i]).is_some_and(|(s, _)| {
        chars_within(text, s, start, CONTEXT_CHARS) && !text[s..start].contains('\n')
    });
    let after = notices[idx..]
        .iter()
        .find(|(s, _)| *s >= end)
        .is_some_and(|&(_, e)| chars_within(text, end, e, CONTEXT_CHARS) && !text[end..e].contains('\n'));
    before || after
}

/// Whether `chars` are only whitespace and punctuation.
fn only_trim(mut chars: impl Iterator<Item = char>) -> bool {
    chars.all(|c| c == '\n' || c.is_whitespace() || "*_:\"'«»()[]<>.,!-–—|".contains(c))
}

/// Whether only whitespace and punctuation follow `end` on its line (looking at most
/// `CONTEXT_CHARS` characters ahead).
fn ends_line(text: &str, end: usize) -> bool {
    only_trim(text[end..].chars().take(CONTEXT_CHARS).take_while(|c| *c != '\n'))
}

/// Whether only whitespace and punctuation stand between the candidate and the ends of its line
/// (looking at most `CONTEXT_CHARS` characters each way).
fn stands_alone_on_line(text: &str, start: usize, end: usize) -> bool {
    let line_before = text[..start].chars().rev().take(CONTEXT_CHARS).take_while(|c| *c != '\n');
    only_trim(line_before) && ends_line(text, end)
}

/// Whether the text between two byte offsets is at most `max` characters long.
fn chars_within(text: &str, from: usize, to: usize, max: usize) -> bool {
    to >= from && to - from <= max * 4 && text[from..to].chars().count() <= max
}

fn has_sentence_break(gap: &str) -> bool {
    [". ", ".\n", "! ", "!\n", "? ", "?\n"]
        .iter()
        .any(|p| gap.contains(p))
}

/// Whether only filler words (plus `extra` words) and punctuation separate a keyword from the
/// code that follows it, in the same sentence.
fn is_direct_gap(gap: &str, extra: &[&str]) -> bool {
    if !chars_within(gap, 0, gap.len(), 40)
        || gap.matches('\n').count() > 3
        || has_sentence_break(gap)
    {
        return false;
    }
    only_words(gap, extra)
}

/// Whether the gap between a keyword and the code announces the code: a colon, a dash, a line
/// break or a copula ("Your code is 1987", "Code: 1987", "Код — 1987").
fn announces(gap: &str) -> bool {
    gap.contains([':', '\n'])
        || gap.split_whitespace().any(|t| t.chars().all(|c| matches!(c, '-' | '–' | '—')))
        || gap
            .split(|c: char| !c.is_alphanumeric())
            .any(|w| matches!(w.to_lowercase().as_str(), "is" | "are" | "це" | "є" | "это"))
}

/// Whether the number ending at `end` runs on into an ordinary lowercase word, which makes it
/// a quantity in running text: "2400 layoffs", "3400 people have signed up", "1820 views".
/// Code-like followers ("482913 is your code", "Use 482913 to sign in") and anything after
/// punctuation or at the end of the line do not count.
fn runs_into_word(text: &str, end: usize) -> bool {
    let Some(rest) = text[end..].strip_prefix(' ') else {
        return false;
    };
    if !rest.chars().next().is_some_and(char::is_lowercase) {
        return false;
    }
    let word: String = rest.chars().take_while(|c| c.is_alphanumeric()).take(CONTEXT_CHARS).collect();
    let word = word.to_lowercase();
    ![FILLER_WORDS, REMARK_WORDS, CODE_FOLLOWERS].iter().any(|list| list.contains(&word.as_str()))
}

/// Whether every word of `text` is a filler word or one of `extra`.
fn only_words(text: &str, extra: &[&str]) -> bool {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .all(|w| {
            let w = w.to_lowercase();
            FILLER_WORDS.contains(&w.as_str()) || extra.contains(&w.as_str())
        })
}

/// The code starts the line right after the keyword's line (blank lines allowed), and the
/// keyword ends its line: only filler words follow it ("Your code is\n"), or the line ends
/// with ':' ("Enter this code on the sign-in page:\n").
fn starts_line_after_keyword(text: &str, kw_end: usize, start: usize) -> bool {
    if !chars_within(text, kw_end, start, 80) {
        return false;
    }
    let gap = &text[kw_end..start];
    let Some(line_end) = gap.find('\n') else {
        return false;
    };
    let (tail, rest) = gap.split_at(line_end);
    let tail = tail.trim_end();
    rest.chars().all(|c| c.is_whitespace() || "*\"'«([".contains(c))
        && !has_sentence_break(tail)
        && (tail.ends_with(':') || (!tail.ends_with(['.', '!', '?']) && only_words(tail, &[])))
}

/// Whether the rest of the code's line is empty or a remark about the code: a parenthesis
/// ("(expires in 10 minutes)") or a remark word after punctuation at most ("- valid for 5
/// minutes", ". It expires soon", "expires in 15 minutes."), see [`REMARK_WORDS`]. Looks at
/// most `CONTEXT_CHARS` characters ahead.
fn followed_by_remark(text: &str, end: usize) -> bool {
    let rest: String = text[end..].chars().take(CONTEXT_CHARS).take_while(|c| *c != '\n').collect();
    let rest = rest.trim_start();
    if only_trim(rest.chars()) || rest.starts_with(['(', '[']) {
        return true;
    }
    let first_word: String = rest
        .trim_start_matches(|c: char| c.is_whitespace() || "-–—.,;:!".contains(c))
        .chars()
        .take_while(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    REMARK_WORDS.contains(&first_word.as_str())
}

/// Whether the candidate opens its sentence, after filler words at most: "Use 482913 to ...",
/// "482913 - confirm ...". Looks back at most 40 characters on the line.
fn leads_sentence(text: &str, start: usize) -> bool {
    let from = text[..start]
        .char_indices()
        .rev()
        .take(40)
        .take_while(|(_, c)| *c != '\n')
        .last()
        .map_or(start, |(i, _)| i);
    let prefix = &text[from..start];
    let sentence_start = [". ", "! ", "? "]
        .iter()
        .filter_map(|p| prefix.rfind(p).map(|i| i + p.len()))
        .max();
    let sentence = match sentence_start {
        Some(i) => &prefix[i..],
        None if from == 0 || text[..from].ends_with('\n') => prefix,
        None => return false,
    };
    only_words(sentence, &[])
}

/// How a candidate is vouched for: the layout score, and whether the vouching keyword phrase
/// names a code (see [`Keyword::strong`]), which breaks ties between equal scores.
#[derive(Debug, Clone, Copy)]
struct Vouch {
    score: u32,
    strong: bool,
}

/// Confirm/verify keywords, which may ask for a code for a payment or an order.
fn is_confirm_or_verify(keyword: &str) -> bool {
    let word = keyword.to_lowercase();
    ["confirm", "verif", "підтвердж", "подтвержд"].iter().any(|stem| word.starts_with(stem))
}

fn score_candidate(
    text: &str,
    keywords: &[Keyword],
    start: usize,
    end: usize,
    shape: TokenShape,
) -> Option<Vouch> {
    use KeywordKind::*;
    // Nearest keyword on each side; a non-verification one ("zip code") claims the number.
    let idx = keywords.partition_point(|k| k.end <= start);
    let before = idx.checked_sub(1).map(|i| keywords[i]).filter(|k| k.kind != Other);
    let after = keywords[idx..].iter().find(|k| k.start >= end).copied().filter(|k| k.kind != Other);
    // A transaction keyword ("confirm your payment") only counts for a code right next to it:
    // DIRECT (its own words may sit in between) or a code that opens the sentence.
    let verifying = |k: &Keyword| k.kind == Verification;
    let vouch = |score: u32, k: &Keyword| Some(Vouch { score, strong: k.strong });
    let year = shape == TokenShape::Digits && is_year_like(&text[start..end]);

    // Letters-only tokens: only "<keyword> is|: KBRTW" ending its line, or alone on the line
    // after a line that a verification keyword ends ("...code ... player2024:\n\nKBRTW").
    if shape == TokenShape::Letters {
        let k = before.filter(verifying)?;
        let gap = &text[k.end..start];
        let announced = gap.contains(':')
            || gap.split(|c: char| !c.is_alphanumeric()).any(|w| matches!(w.to_lowercase().as_str(), "is" | "це" | "є"));
        let direct = announced && is_direct_gap(gap, &[]) && ends_line(text, end);
        let next_line = stands_alone_on_line(text, start, end) && starts_line_after_keyword(text, k.end, start);
        return (direct || next_line).then(|| Vouch {
            score: if direct { SCORE_DIRECT } else { SCORE_OWN_LINE },
            strong: k.strong,
        });
    }

    if let Some(k) = before {
        let confirms = k.kind == Transaction || is_confirm_or_verify(&text[k.start..k.end]);
        let extra = if confirms { TRANSACTION_WORDS } else { &[] };
        let gap = &text[k.end..start];
        // Across a line break the code must not open a new sentence ("...verification code\n
        // 9f2e7d3 Add tests" in a commit list).
        if is_direct_gap(gap, extra) && (!gap.contains('\n') || followed_by_remark(text, end)) {
            // Without an announcement (":", "is"), a year is running text ("Advent of Code
            // 2026", "confirm your 2026 benefit elections"), and so is a quantity after a bare
            // verb ("Verify your 2400 contacts").
            let announced = announces(gap);
            if announced || !(year || (!k.strong && runs_into_word(text, end))) {
                return vouch(SCORE_DIRECT, &k);
            }
        }
    }

    if stands_alone_on_line(text, start, end) {
        if let Some(k) = before.filter(|k| verifying(k) && chars_within(text, k.end, start, 200)) {
            return vouch(SCORE_OWN_LINE, &k);
        }
        // A year alone on its line only counts below the keyword that announces it.
        if let Some(k) = after.filter(|k| !year && verifying(k) && chars_within(text, end, k.start, 100)) {
            return vouch(SCORE_OWN_LINE, &k);
        }
    }

    // Letter+digit tokens only count when they directly follow a keyword or stand alone; years
    // and quantities in running text ("3400 people have signed up") never count.
    if shape != TokenShape::Digits || year || runs_into_word(text, end) {
        return None;
    }

    // The bounded length checks come first so long single-line texts stay linear.
    if let Some(k) = before.filter(verifying) {
        if chars_within(text, k.end, start, 60) {
            let gap = &text[k.end..start];
            if !gap.contains('\n') && !has_sentence_break(gap) {
                return vouch(SCORE_SAME_LINE, &k);
            }
        }
        if starts_line_after_keyword(text, k.end, start) && followed_by_remark(text, end) {
            return vouch(SCORE_NEXT_LINE, &k);
        }
    }
    if let Some(k) = after {
        if chars_within(text, end, k.start, 50) {
            let gap = &text[end..k.start];
            if !gap.contains('\n')
                && !has_sentence_break(gap)
                && !gap.chars().any(|c| c.is_ascii_digit())
                && (k.kind == Verification || leads_sentence(text, start))
            {
                return vouch(SCORE_CODE_FIRST, &k);
            }
        }
    }
    // A keyword somewhere further away is not enough: in mails without a code that only picks
    // up street numbers, postal codes and customer numbers.
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(text: &str) -> Vec<String> {
        extract_verification_codes(text)
    }

    #[test]
    fn test_verification_code_extraction() {
        let test_cases: Vec<(&str, Vec<&str>)> = vec![
            ("Your verification code is 123456", vec!["123456"]),
            ("Code: 4567", vec!["4567"]),
            ("Your OTP is 789012", vec!["789012"]),
            ("Confirm with ABC123", vec!["ABC123"]),
            ("No codes here", vec![]),
            ("Code: 12345678", vec!["12345678"]),
        ];
        for (body, expected) in test_cases {
            assert_eq!(codes(body), expected, "Failed for: {body}");
        }
    }

    #[test]
    fn code_first_and_subject() {
        assert_eq!(codes("482913 is your Instagram code"), vec!["482913"]);
        assert_eq!(codes("Use 482913 to verify your account"), vec!["482913"]);
        assert_eq!(
            codes("G-582931 is your Google verification code\nGoogle\nHi, enter it to continue."),
            vec!["582931"]
        );
        assert_eq!(codes("Your Instagram code: 482913\nHello"), vec!["482913"]);
    }

    #[test]
    fn discord_sample() {
        let mail = "Verify your login\n\
            Hey romirom,\n\n\
            Your Discord verification code is:\n\n\
            738291\n\n\
            If you didn't request this code, you can safely ignore this email.\n\
            Need help? Contact Discord Support.\n\
            Sent by Discord \u{2022} 444 De Haro Street, Suite 200, San Francisco, CA 94107\n\
            \u{00A9} 2024 Discord Inc.";
        assert_eq!(codes(mail), vec!["738291"]);
    }

    #[test]
    fn x_twitter_alphanumeric_sample() {
        let mail = "Your X confirmation code is 7bpt5n9d\n\
            Confirm your email address\n\
            There\u{2019}s one quick step you need to complete before creating your X account. \
            Let\u{2019}s make sure this is the right email address for you \u{2014} please confirm \
            this is the right address to use for your new account.\n\
            Please enter this verification code to get started on X:\n\n\
            7bpt5n9d\n\n\
            Verification codes expire after two hours.\n\
            Thanks,\nX\n\
            X Corp. 1355 Market Street, Suite 900 San Francisco, CA 94103";
        assert_eq!(codes(mail), vec!["7bpt5n9d"]);
    }

    #[test]
    fn microsoft_sample() {
        let mail = "Microsoft account security code\n\
            Microsoft account\n\
            Security code\n\
            Please use the following security code for the Microsoft account jo*****@example.com.\n\
            Security code: 4821\n\
            If you don't recognize the Microsoft account jo*****@example.com, you can click here \
            to remove your email address from that account.\n\
            Thanks,\nThe Microsoft account team";
        assert_eq!(codes(mail), vec!["4821"]);
    }

    #[test]
    fn steam_style_alphanumeric_sample() {
        let mail = "Your Steam account: Access from new web or mobile device\n\
            Dear player2024,\n\
            Here is the Steam Guard code you need to login to account player2024:\n\n\
            F7KQ2\n\n\
            This email was generated because of a login attempt from a web or mobile device \
            located at 203.0.113.7 (UA).\n\
            The Steam Team";
        assert_eq!(codes(mail), vec!["F7KQ2"]);
    }

    #[test]
    fn ukrainian_samples() {
        assert_eq!(
            codes("Ваш код підтвердження: 482913. Не повідомляйте його нікому."),
            vec!["482913"]
        );
        assert_eq!(
            codes("Підтвердження реєстрації\nКод для входу: 5521\nКод дійсний 10 хвилин."),
            vec!["5521"]
        );
        assert_eq!(
            codes("Вітаємо!\nВведіть цей код, щоб підтвердити адресу:\n\n904417\n\nЯкщо це були не ви, проігноруйте лист."),
            vec!["904417"]
        );
        assert_eq!(codes("Код подтверждения: 381920"), vec!["381920"]);
    }

    #[test]
    fn no_code_with_years_prices_and_phone_numbers() {
        let mail = "Your order #123456789 has shipped!\n\
            Order 98765432 confirmation\n\
            Total: $1,299.00 (1499 UAH incl. VAT, 2500 грн)\n\
            Delivery on 14.11.2025 between 10:00 and 18:00.\n\
            Questions? Call +1 (800) 555-0199 or +380 44 123 4567.\n\
            Confirm your delivery address at https://shop.example.com/confirm?id=448812\n\
            Black Friday 2025 deals \u{2014} confirm your subscription.\n\
            Use promo code SAVE2025 at checkout. ZIP code 90210.\n\
            \u{00A9} 2024 Shop Inc. All rights reserved.";
        assert_eq!(codes(mail), Vec::<String>::new());
    }

    #[test]
    fn rejects_digits_inside_longer_runs_and_identifiers() {
        assert!(codes("Your verification code is 1234567890").is_empty());
        assert!(codes("Confirm order no 123456").is_empty());
        assert!(codes("Verification for card ending 4242").is_empty());
        assert!(codes("Code sent to user123456@example.com").is_empty());
        assert!(codes("Verify your account. Call 0800 123456.").is_empty());
    }

    #[test]
    fn years_only_when_direct() {
        assert_eq!(codes("Your code is 2024"), vec!["2024"]);
        assert!(codes("Verify your email\nUpdated terms, March 2024").is_empty());
        assert!(codes("Your verification code expires 12 Nov 2025").is_empty());
    }

    #[test]
    fn alphanumeric_rules() {
        // Plain words and unit-like tokens are never codes.
        assert!(codes("Confirm account details").is_empty());
        assert!(codes("Your code expires in 10minutes").is_empty());
        // Only directly after a keyword (or alone on a line).
        assert!(codes("Verify the email for Team42 members").is_empty());
        assert_eq!(codes("Your login code: XK9P2Q"), vec!["XK9P2Q"]);
    }

    #[test]
    fn ranking_dedup_and_limit() {
        let mail = "Code: 111111\nYour code is 222222\ncode 333333\ncode 444444\n\
            code 555555\ncode 666666\nYour code is 222222";
        let result = codes(mail);
        assert_eq!(result.len(), 5);
        assert_eq!(result[0], "111111");
        assert_eq!(result.iter().filter(|c| *c == "222222").count(), 1);

        // A direct match wins over an earlier weak one.
        let mail = "Verify your sign-in from Kyiv\nRequest 4417 received\nYour code is 902211";
        assert_eq!(codes(mail)[0], "902211");
    }

    #[test]
    fn robust_on_large_and_multibyte_input() {
        let mut text = String::from("Ваш код підтвердження: 482913\n");
        text.push_str(&"Привіт світ 1234 ".repeat(5000));
        text.push_str(&"x".repeat(10_000));
        text.push_str(" code 555555");
        assert_eq!(codes(&text)[0], "482913");
        // A huge token without whitespace (base64, tracking blob) is noise.
        let blob = format!("Your code: {}+123456+{}", "A".repeat(300), "B".repeat(300));
        assert!(codes(&blob).is_empty());
        for cut in 0..40 {
            let s: String = "Код: 1234 — ваш 5678 код".chars().take(cut).collect();
            let _ = codes(&s);
        }
    }

    #[test]
    fn registry_and_product_numbers_after_code_are_not_codes() {
        assert_eq!(
            codes("Вхід у кабінет\n482913 — ваш код для входу. Він дійсний 10 хвилин.\nТОВ «Нова Пошта», код ЄДРПОУ 31316718"),
            vec!["482913"]
        );
        assert!(codes("Знижки тижня на смартфони!\nДякуємо, що ви з нами.\nТОВ «Розетка.УА», код ЄДРПОУ 37193071").is_empty());
        assert!(codes("ТОВ «Приклад», код за ЄДРПОУ 12345678").is_empty());
        assert!(codes("Ваше замовлення прийнято.\nКод товару: 38124567\nКількість: 1").is_empty());
        assert_eq!(
            codes("482913 is your sign-in code.\nCompany registration code 12345678, VAT code 87654321"),
            vec!["482913"]
        );
        assert!(codes("Your tracking code 48291377 is active.").is_empty());
        assert!(codes("Customer code: 582913").is_empty());
        assert!(codes("Код клієнта 582913").is_empty());
        // A bare "Registration code" is a sign-up code.
        assert_eq!(codes("Registration code: 482913"), vec!["482913"]);
    }

    #[test]
    fn anti_phishing_code_is_never_returned() {
        let binance = "[Binance] Withdrawal Verification\n\
            Anti-Phishing Code: romi2024\n\
            You are trying to withdraw. Your verification code:\n\
            394817\n\
            The verification code will be valid for 30 minutes.";
        assert_eq!(codes(binance), vec!["394817"]);
        assert_eq!(codes("Anti-Phishing Code: 7781\nYour verification code is 394817"), vec!["394817"]);
        let okx = "Your verification code is 603918. It expires in 10 minutes.\n\
            Anti-phishing code: Ab12Cd";
        assert_eq!(codes(okx), vec!["603918"]);
        assert_eq!(codes("Антифишинговый код: 7781\nКод подтверждения: 394817"), vec!["394817"]);
    }

    #[test]
    fn no_code_in_opt_in_welcome_and_alert_mails() {
        let samples = [
            "Please confirm your subscription\n\
             Thanks for signing up for the Acme newsletter. Click the button below to confirm.\n\
             Acme Inc., 1234 Main Street, Springfield, IL 62704",
            "Confirm your newsletter subscription\n\
             You are almost done. Tap the link to finish.\n\
             PO Box 4410, Austin TX 78701",
            "New sign-in to your account\n\
             If this was not you, please verify your account.\n\
             Location: Kyiv 01001, Ukraine",
            "Your account has been verified. Welcome aboard!\n\
             Your customer number 58213",
            "Confirm delivery details: Kyiv 04070",
            "Your email was confirmed.\nOffice: Kyiv 04070, 12 Main St",
            "Ваш акаунт підтверджено.\nНомер клієнта 58213",
        ];
        for mail in samples {
            assert_eq!(codes(mail), Vec::<String>::new(), "{mail}");
        }
    }

    #[test]
    fn promo_codes_are_not_verification_codes() {
        assert!(codes("Black Friday is here!\nGet 20% off everything in store. Use code SAVE20 at checkout.").is_empty());
        assert!(codes("Введите код SKIDKA25 при оформлении заказа и получите скидку 25%.").is_empty());
        assert!(codes("Введите код SKIDKA25 при оформлении заказа.").is_empty());
        // Verification wording next to shop wording is still a verification code.
        assert_eq!(codes("При оформлении заказа введите код подтверждения: 482913"), vec!["482913"]);
        assert_eq!(codes("Your verification code for checkout: 482913"), vec!["482913"]);
        assert!(codes("Use code 2024SALE for 20% off").is_empty());
        assert!(codes("Your promotional code: 482913").is_empty());
        assert!(codes("Shopping week: use code 482913 now").is_empty());
        assert_eq!(codes("Use code 482913 to sign in. Get 20% off later!"), vec!["482913"]);
        // A marketing footer does not hide the code above it.
        assert_eq!(
            codes("Your verification code is 482913\nShop the sale: 30% off with code SPRING30 at checkout."),
            vec!["482913"]
        );
    }

    /// Each rule with a mail it must accept next to a look-alike it must reject.
    #[test]
    fn rule_corpus_positive_and_negative_side_by_side() {
        const NONE: &[&str] = &[];
        let corpus: &[(&str, &str, &[&str])] = &[
            // Shop wording alone does not make a promo code; it needs sale wording, a price or a
            // "use code" call to action.
            ("shop name", "Your Shop login code is 482913", &["482913"]),
            ("shop name", "Acme Shop: your login code is 482913", &["482913"]),
            ("shop name", "Your code for Sales Hub sign-in: 482913", &["482913"]),
            ("shop name", "Your checkout code: 482913", &["482913"]),
            ("shop + price", "Big sale: code 482913 takes $20 off", NONE),
            ("shop + price", "Your checkout code SAVE20K gets 5 EUR back", NONE),
            ("shop + call", "Shop the sale and use code 482913 today", NONE),
            ("sale wording", "Your code 482913 gives a 10% off discount", NONE),
            // "<sign-in word> code" is always a sign-in code.
            ("auth qualifier", "Your sign-in code at Acme Shop is 482913", &["482913"]),
            ("auth qualifier", "Use your access code 482913 at checkout", &["482913"]),
            ("auth qualifier", "Your one-time code for the sale: 482913", &["482913"]),
            ("no qualifier", "Use code 482913 at checkout", NONE),
            // Confirm/verify + payment/purchase/order: only a code right next to it.
            ("transaction", "Use 482913 to confirm your payment", &["482913"]),
            ("transaction", "482913 - confirm your purchase", &["482913"]),
            ("transaction", "To verify your order, enter 482913", &["482913"]),
            ("transaction", "Confirm payment: 482913", &["482913"]),
            ("transaction", "We shipped 48291 parcels, confirm your purchase", NONE),
            ("transaction", "Please confirm your order.\n482913 is the parcel weight", NONE),
            ("transaction", "Confirm your order details at our store 48291", NONE),
            ("transaction", "Use 482913 to confirm your subscription", NONE),
            // The code starts the line after a line that the keyword ends.
            (
                "next line",
                "Enter this code on the sign-in page:\n482913 (expires in 10 minutes)",
                &["482913"],
            ),
            (
                "next line",
                "Use the code below to verify\u{2026}\n482913 expires in 15 minutes.",
                &["482913"],
            ),
            ("next line", "Your verification code is\n\n482913 - valid for 5 minutes", &["482913"]),
            ("next line", "Verify your email\n1355 Market Street", NONE),
            ("next line", "Your code is ready.\n4821 Main Street", NONE),
            ("next line", "Your verification code:\nSuite 4821, Main Street", NONE),
            // US postal codes: five digits after a state in an address only.
            ("postal code", "YOUR VERIFICATION CODE IS 48291", &["48291"]),
            ("postal code", "Your OTP IS 48291", &["48291"]),
            ("postal code", "YOUR CODE IS A1B2C", &["A1B2C"]),
            ("postal code", "Your code was sent from Austin TX 78701", NONE),
            ("postal code", "Your code was sent from Austin, TX 78701", NONE),
            ("postal code", "YOUR CODE WAS SENT FROM AUSTIN, TX 78701", NONE),
        ];
        for (rule, mail, expected) in corpus {
            assert_eq!(codes(mail), *expected, "rule {rule}: {mail:?}");
        }
    }

    /// Realistic mails from an independent corpus run, as "subject\nbody" (what
    /// `build_message` scans). Each group names the rule that decides it.
    #[test]
    fn tester_corpus_samples() {
        const NONE: &[&str] = &[];
        let corpus: &[(&str, &str, &[&str])] = &[
            // Letters-only codes (Steam Guard, X) right after a keyword line.
            (
                "letters-only code",
                "Your Steam account: Access from new web or mobile device\n\
                 Dear player2024,\n\
                 Here is the Steam Guard code you need to login to account player2024:\n\n\
                 KBRTW\n\n\
                 This email was generated because of a login attempt from a web or mobile device \
                 located at 203.0.113.7 (UA).\n\
                 The Steam Team",
                &["KBRTW"],
            ),
            (
                "letters-only code",
                "Your X confirmation code is bqtzmkfa\n\
                 Confirm your email address\n\
                 Please enter this verification code to get started on X:\n\n\
                 bqtzmkfa\n\n\
                 Verification codes expire after two hours.",
                &["bqtzmkfa"],
            ),
            // "<Brand> ID" after a preposition names the service, not an identifier.
            (
                "service id",
                "VK ID\n\
                 Код для входа в VK ID: 482913\n\
                 Если вы не запрашивали код, просто проигнорируйте это письмо.\n\
                 \u{00A9} 2006\u{2013}2026 VK",
                &["482913"],
            ),
            ("service id", "Вход\nКод подтверждения для Яндекс ID: 482019", &["482019"]),
            // Booking and delivery confirmation numbers.
            (
                "confirmation number",
                "Reservation confirmed\n\
                 Your reservation at Hotel Kyiv is confirmed.\n\
                 Confirmation number: 48291037\n\
                 Check-in: 14 Nov 2026 from 14:00\n\
                 Room 412",
                NONE,
            ),
            (
                "confirmation number",
                "Delivery confirmation\n\
                 Your parcel was delivered on 11/12/2026 at 2:31 PM.\n\
                 Confirmation number: 7720481\n\
                 Signed by: J. Doe",
                NONE,
            ),
            (
                "confirmation number",
                "Your trip confirmation - K7XP2Q\n\
                 Thanks for booking with United.\n\
                 Confirmation number: K7XP2Q\n\
                 Flight UA 924, Nov 20 2026\n\
                 Seat 14C",
                NONE,
            ),
            (
                "confirmation number",
                "Підтвердження доставки\n\
                 Ваше відправлення доставлено.\n\
                 Номер підтвердження: 7720481\n\
                 Дата: 12.11.2026",
                NONE,
            ),
            // Card payment receipts: the authorization (approval) code next to an amount.
            (
                "receipt",
                "Квитанція про оплату\n\
                 Оплата карткою *4242\n\
                 Сума: 1 299,00 грн\n\
                 Дата: 12.11.2026 14:32\n\
                 Код авторизації: 482913\n\
                 RRN: 631612345678",
                NONE,
            ),
            (
                "receipt",
                "Payment receipt\n\
                 Payment approved\n\
                 Amount: 59.99 EUR\n\
                 Merchant: AMAZON EU\n\
                 Authorization code: 482913\n\
                 Terminal ID: 48213057",
                NONE,
            ),
            // Amounts: limits, points and bonuses next to verify/confirm wording.
            (
                "amount",
                "Complete your verification\n\
                 Hi user,\n\
                 You're just one step away. Complete identity verification to unlock withdrawals \
                 of up to 50000 USDT per day.\n\
                 Binance, 2026",
                NONE,
            ),
            (
                "amount",
                "Verify your identity\n\
                 Verify your identity today and get up to 10000 bonus points!\n\
                 Complete verification in the app.",
                NONE,
            ),
            ("amount", "Confirm your email\nConfirm your email and earn 2500 points.\nAcme Rewards", NONE),
            // Coupons whose sale wording is on the following lines.
            (
                "promo on next lines",
                "Your exclusive code inside\n\
                 Your exclusive code: VIP4821\n\
                 Enjoy $10 off your next purchase of $50 or more. Expires 12/31/2026.",
                NONE,
            ),
            (
                "promo on next lines",
                "Подарунок для вас\nВаш код:\nGIFT2026\nЗнижка 15% на наступне замовлення.",
                NONE,
            ),
            // Phone number tails.
            (
                "phone tail",
                "Verify it's you\n\
                 We sent a verification code to your phone number ending in 4567. Enter it on the \
                 sign-in page to continue.\n\
                 Didn't get it? Try again in 60 seconds.",
                NONE,
            ),
            (
                "phone tail",
                "Verification code sent\nA verification code was sent to your phone ***-***-4567.",
                NONE,
            ),
            // Meeting passcodes.
            (
                "meeting passcode",
                "Zoom meeting invite\n\
                 Join Zoom Meeting\n\
                 https://us02web.zoom.us/j/84829130583?pwd=abc\n\
                 Meeting ID: 848 2913 0583\n\
                 Passcode: 582910\n\
                 One tap mobile +16465588656",
                NONE,
            ),
            (
                "meeting passcode",
                "Microsoft Teams meeting\n\
                 Join on your computer, mobile app or room device\n\
                 Click here to join the meeting\n\
                 Meeting ID: 248 291 305 123\n\
                 Passcode: Ab3xYz\n\
                 Download Teams | Join on the web",
                NONE,
            ),
            // Look-alikes the rules above must leave alone (positive next to negative).
            ("letters-only code", "Your login code is KBRTW", &["KBRTW"]),
            ("letters-only code", "Please verify first\nThanks", NONE),
            ("letters-only code", "Your code is valid for 10 minutes", NONE),
            ("letters-only code", "Your verification code:\nHELLO", NONE),
            ("letters-only code", "Your verification code is ready.\nSTRNG", NONE),
            ("letters-only code", "Verification codes expire after two hours.\nThanks,\nX", NONE),
            ("letters-only code", "Your code is KBRTW and more text", NONE),
            ("service id", "Your verification code for Customer ID 48291", NONE),
            ("service id", "Verify your account, Customer ID: 48291", NONE),
            ("confirmation number", "Your confirmation code is 482913", &["482913"]),
            ("confirmation number", "Номер підтвердження: 482913", NONE),
            ("receipt", "Your authorization code is 482913", &["482913"]),
            ("receipt", "Код авторизації: 482913\nНікому його не повідомляйте.", &["482913"]),
            ("amount", "Confirm your email with code 482913 and earn 2500 points.", &["482913"]),
            ("promo on next lines", "Your code:\n482913\n\nShop our sale: 20% off everything", &["482913"]),
            ("promo on next lines", "Your code: 482913\nIt expires in 10 minutes.", &["482913"]),
            ("phone tail", "Code sent to ***-***-4567. Your code: 482913", &["482913"]),
            ("phone tail", "**Your code is** 482913", &["482913"]),
            ("meeting passcode", "Your passcode is 582910. Do not share it.", &["582910"]),
        ];
        let failures: Vec<String> = corpus
            .iter()
            .filter_map(|(rule, mail, expected)| {
                let found = codes(mail);
                (found != *expected).then(|| format!("rule {rule}: got {found:?}, want {expected:?}: {mail:?}"))
            })
            .collect();
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    /// Second independent corpus run, as "subject\nbody": footers with company and payee
    /// codes, codes after "... your account:", commit lists, booking PINs, support tickets,
    /// payment references and airline record locators. Each sample comes with a look-alike
    /// that the same rule must still accept or reject.
    #[test]
    fn tester_corpus_samples_round_two() {
        const NONE: &[&str] = &[];
        let corpus: &[(&str, &str, &[&str])] = &[
            // Company registry numbers and city postal codes in footers.
            (
                "registry code",
                "Your Bolt login code\n\
                 Hi Roman,\n\
                 Here is your one-time login code. It expires in 10 minutes.\n\n\
                 4821\n\n\
                 Do not share it with anyone.\n\
                 Bolt Operations OÜ, Vana-Lõuna 15, Tallinn 10134, Estonia. Registry code: 14532901",
                &["4821"],
            ),
            (
                "registry code",
                "Veriff\n\
                 Enter the code below to continue your verification.\n\n\
                 482913\n\n\
                 Veriff OÜ, Niine 11, Tallinn 10414. Registry code 12932944",
                &["482913"],
            ),
            ("registry code", "Registry code: 14532901", NONE),
            ("registry code", "Commercial register code 14532901", NONE),
            ("registry code", "Your sign-in code is 482913.\nTallinn 10134, Estonia", &["482913"]),
            // "... your account: 482913": the account is what the code is for, not a number label.
            (
                "for your account",
                "Yahoo verification code\n\
                 Hi Roman,\n\
                 Use this code to verify your account: 48291037\n\
                 This code expires in 10 minutes.",
                &["48291037"],
            ),
            ("for your account", "Enter this code to activate your account: 482913", &["482913"]),
            ("for your account", "Here is the code to access your account: 482913", &["482913"]),
            ("for your account", "Enter this code to confirm your account: 482913", &["482913"]),
            ("for your account", "Your code to sign in to your account: 482913", &["482913"]),
            ("for your account", "Verify your account. Account 48291037", NONE),
            ("for your account", "Verify your account number 48291037", NONE),
            ("for your account", "Your verification code was sent. Account: 48291037", NONE),
            // Ukrainian payment details and tax notices: payee, bank and budget codes.
            (
                "payee code",
                "Квитанція\n\
                 Отримувач: ТОВ «Приклад»\n\
                 Код отримувача: 37193071\n\
                 IBAN: UA213223130000026007233566001",
                NONE,
            ),
            (
                "payee code",
                "Реквізити для оплати\nКод ЄДРПОУ отримувача: 37193071\nКод банку: 322313",
                NONE,
            ),
            (
                "payee code",
                "Код для входу: 482913\nАТ «Універсал Банк», код ЄДРПОУ 21133352, код банку: 322001",
                &["482913"],
            ),
            (
                "budget code",
                "Податкове повідомлення\n\
                 Платник: Кудін Роман, РНОКПП 3482910372\n\
                 Сума податку: 4 829 грн\n\
                 Код бюджетної класифікації 18010900\n\
                 Термін сплати: 01.12.2026",
                NONE,
            ),
            ("budget code", "КБК 18010900, код платежу 101", NONE),
            ("payee code", "Ваш код для входу в банк: 482913", &["482913"]),
            // A keyword at the end of a line only vouches for a code that is alone on the next
            // line or followed by a short remark, not for the first word of a commit subject.
            (
                "commit list",
                "[romirom11/AccMan] Fix verification code parser (#482)\n\
                 @romirom11 pushed 3 commits.\n\
                 4a8b2c1 Fix code extraction for 8-digit codes\n\
                 9f2e7d3 Add tests\n\
                 View it on GitHub: https://github.com/romirom11/AccMan/pull/482",
                NONE,
            ),
            ("commit list", "Commit 4a8b2c1d by Roman: Refactor OTP code\n9f2e7d31 Update README", NONE),
            ("commit list", "- Clean up verification code\n- 4a8b2c1 bump version", NONE),
            ("commit list", "Your verification code\n482913", &["482913"]),
            ("commit list", "Your verification code\n482913 (valid for 10 minutes)", &["482913"]),
            ("commit list", "Your verification code:\n482913 expires in 15 minutes.", &["482913"]),
            ("commit list", "Your verification code is:\n482913. It expires in 10 minutes.", &["482913"]),
            ("commit list", "Your code:\n482913 Do not share it", &["482913"]),
            // Booking-management PINs.
            (
                "booking pin",
                "Booking confirmation\n\
                 Your booking is confirmed!\n\
                 Confirmation number: 4829.130.583\n\
                 PIN code: 4821\n\
                 Check-in: Thursday, November 14, 2026 (from 14:00)\n\
                 Hotel Kyiv, Khreshchatyk St 22, Kyiv 01001\n\
                 Total price: UAH 4,250",
                NONE,
            ),
            ("booking pin", "Booking number: 4829130583\nPIN: 4821", NONE),
            ("booking pin", "Your PIN is 4821. Do not share it.", &["4821"]),
            ("booking pin", "Your Booking.com verification code is 482913", &["482913"]),
            ("booking pin", "Sign in to manage your booking\nYour login code: 482913", &["482913"]),
            // Support case and request numbers.
            (
                "ticket",
                "Case 04829137 has been created\n\
                 Your support case 04829137 regarding login verification has been created.\n\
                 Priority: Normal\n\
                 We'll be in touch soon.",
                NONE,
            ),
            ("ticket", "Case 04829137: Login verification problem", NONE),
            (
                "ticket",
                "Re: Your request 58291 - account verification\n\
                 Hello Roman,\n\
                 Thank you for contacting us about verification of your account.\n\
                 We have escalated your request 58291 to our compliance team. You will hear from \
                 us within 3 business days.\n\
                 Kind regards,\n\
                 Support team",
                NONE,
            ),
            ("ticket", "Your request 58291 regarding account verification has been received.", NONE),
            ("ticket", "We received your request. 482913 is your verification code.", &["482913"]),
            // Payment references.
            (
                "reference code",
                "Bank transfer received\nYou received a transfer of 250.00 EUR.\nReference code: 48291037",
                NONE,
            ),
            ("reference code", "Payment reference code 48291037", NONE),
            ("reference code", "Your code: 48291037", &["48291037"]),
            // Airline record locators labelled "Confirmation code".
            (
                "record locator",
                "Your trip is booked\n\
                 Thanks for flying with Delta.\n\
                 Confirmation code: GJ7K2P\n\
                 Flight DL 123, Nov 20 2026 09:15",
                NONE,
            ),
            ("record locator", "Your confirmation code is 482913", &["482913"]),
            ("record locator", "Confirmation code: GJ7K2P\nEnter it to finish signing up.", &["GJ7K2P"]),
        ];
        let failures: Vec<String> = corpus
            .iter()
            .filter_map(|(rule, mail, expected)| {
                let found = codes(mail);
                (found != *expected).then(|| format!("rule {rule}: got {found:?}, want {expected:?}: {mail:?}"))
            })
            .collect();
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    /// Third independent corpus run, as "subject\nbody": amounts, counts and years in running
    /// text, news verbs, one-time passcodes in travel mails, Ukrainian/Russian payment codes and
    /// promo wording in the next sentence. The first code is what the app copies, so the whole
    /// result is compared. Each group pairs the tester's sample with look-alikes.
    #[test]
    fn tester_corpus_samples_round_three() {
        const NONE: &[&str] = &[];
        let corpus: &[(&str, &str, &[&str])] = &[
            // Amounts: a currency code or amount word on either side is never a code.
            (
                "amount",
                "One-time password for your purchase\n\
                 Dear customer,\n\
                 Your one-time password for the payment of EUR 1250 at AMAZON EU is 604411.\n\
                 Do not disclose this password to anyone.",
                &["604411"],
            ),
            (
                "amount",
                "Transaction verification\n\
                 Your OTP for the transaction of USD 2500 at APPLE STORE is 815503. Valid for 5 \
                 minutes. Do not share it.",
                &["815503"],
            ),
            (
                "amount",
                "Transaction verification\n\
                 Your OTP for the transaction of USD 2,500.00 at APPLE STORE is 815503. Valid for \
                 5 minutes.",
                &["815503"],
            ),
            ("amount", "Your OTP for the transaction of 2500 USD at APPLE is 815503.", &["815503"]),
            ("amount", "Your OTP for the transaction of \u{20AC}2,500 at APPLE is 815503.", &["815503"]),
            ("amount", "Your OTP: 815503. Amount: 2500 UAH", &["815503"]),
            ("amount", "Verify your payment of EUR 1250", NONE),
            ("amount", "Your verification code for the order total: 4250", NONE),
            // Ukrainian and Russian payment confirmation codes ("Код підтвердження платежу").
            (
                "payment code",
                "Підтвердження платежу\n\
                 Код підтвердження платежу на суму 1250 грн у ROZETKA: 815503. Нікому не \
                 повідомляйте.",
                &["815503"],
            ),
            ("payment code", "Код підтвердження платежу: 482913", &["482913"]),
            ("payment code", "Код подтверждения платежа: 482913", &["482913"]),
            ("payment code", "Код для підтвердження платежу: 482913", &["482913"]),
            ("payment code", "Код підтвердження платежу 482913. Нікому не повідомляйте.", &["482913"]),
            ("payment code", "Код підтвердження замовлення: 482913", &["482913"]),
            ("payment code", "Payment confirmation code: 482913", &["482913"]),
            ("payment code", "КБК 18010900, код платежу 101", NONE),
            ("payment code", "Ваше замовлення 48291037 підтверджено. Сума: 1250 грн", NONE),
            ("payment code", "Confirm order no 123456", NONE),
            // A one-time passcode or login PIN stays a sign-in code in travel and booking mails.
            (
                "travel passcode",
                "Your one-time passcode\n\
                 Expedia\n\
                 Use this one-time passcode to sign in:\n\
                 330412\n\
                 This passcode expires in 15 minutes.\n\
                 Find deals on hotels, flights and car rentals.",
                &["330412"],
            ),
            (
                "travel passcode",
                "Your AAdvantage one-time passcode\n\
                 Your one-time passcode is 662091. Enter it to finish logging in to aa.com.\n\
                 Book flights and manage your trips with the American Airlines app.",
                &["662091"],
            ),
            (
                "travel passcode",
                "Your one-time passcode\n\
                 Your one-time passcode for your purchase at Booking.com is 771205. It is valid \
                 for 5 minutes. Never share it with anyone.",
                &["771205"],
            ),
            (
                "travel passcode",
                "Your myRyanair login PIN\n\
                 Hi Roman,\n\
                 Your login PIN is 5821. Enter it to finish signing in to myRyanair.\n\
                 Book your next flights at the lowest fares.\n\
                 Ryanair DAC, Airside Business Park, Swords, Co. Dublin, Ireland",
                &["5821"],
            ),
            ("travel passcode", "Thanks for flying with us\nUse this passcode to sign in: 582910", &["582910"]),
            ("travel passcode", "Join Zoom Meeting\nMeeting ID: 848 2913 0583\nPasscode: 582910", NONE),
            ("travel passcode", "Your hotel booking\nBooking number 4829130583\nYour PIN is 4821", NONE),
            // News verbs ("confirms", "verifies") report; counts after a keyword are no codes.
            (
                "news verb",
                "Tech Daily: Google confirms 2400 layoffs\n\
                 Good morning!\n\
                 Google confirms 2400 layoffs in its cloud division, the second round this year.\n\
                 Apple verifies 1500 new apps for Vision Pro ahead of the holiday season.\n\
                 Read more on our website. Unsubscribe | Manage preferences",
                NONE,
            ),
            (
                "news verb",
                "Morning digest\n\
                 Microsoft confirms 1900 job cuts at Activision Blizzard and Xbox.\n\
                 Valve confirms Steam Deck 2 is not coming in 2026.",
                NONE,
            ),
            ("news verb", "Please confirm 482913 is your code", &["482913"]),
            ("news verb", "Use 482913 to confirm your email", &["482913"]),
            // Counts: a number running on into an ordinary word is a quantity.
            (
                "count",
                "Spots are filling up\n\
                 Verify your registration now \u{2014} 3400 people have already signed up for the \
                 summit.",
                NONE,
            ),
            (
                "count",
                "Confirm your seat for DevFest Kyiv\n\
                 Hi Roman,\n\
                 Confirm your seat today: more than 2500 developers have already registered.\n\
                 DevFest Kyiv 2026, November 28, UNIT.City, Kyiv.",
                NONE,
            ),
            (
                "count",
                "Weekly digest\n\
                 Top topics this week:\n\
                 \"Verification code never arrives\" \u{2014} 2341 views\n\
                 \"Code signing on macOS\" \u{2014} 1820 views\n\
                 \"PIN reset\" \u{2014} 1044 views",
                NONE,
            ),
            ("count", "Verify your 2400 contacts today", NONE),
            ("count", "Your code is 482913 and it expires in 10 minutes.", &["482913"]),
            ("count", "Your login code for Telegram: 58142 do not share", &["58142"]),
            ("count", "482913 ist Ihr Code", &["482913"]),
            ("count", "482913 ваш код для входу", &["482913"]),
            ("count", "Verify with 482913 today", &["482913"]),
            // Years in running text; announced or alone below the keyword they are codes.
            (
                "year",
                "Action needed: open enrollment\n\
                 Hi Roman,\n\
                 Open enrollment closes November 30.\n\
                 Please confirm your 2026 benefit elections in the HR portal.",
                NONE,
            ),
            (
                "year",
                "Update your tax details\n\
                 Please verify your 2026 tax information to avoid withholding on payouts.\n\
                 Stripe, 354 Oyster Point Blvd, South San Francisco, CA 94080",
                NONE,
            ),
            (
                "year",
                "This week in dev: Advent of Code 2026, Rust 1.92 and more\n\
                 Hi Roman,\n\
                 Advent of Code 2026 starts December 1 \u{2014} here are 10 tips to get ready.\n\
                 Rust 1.92 is out with faster compile times.\n\
                 VS Code 1.106 adds agent mode improvements.\n\
                 You're receiving this because you subscribed to Dev Weekly. Unsubscribe.",
                NONE,
            ),
            (
                "year",
                "Join Hour of Code 2026!\n\
                 Hi teachers,\n\
                 Hour of Code 2026 takes place December 8-14. Sign up your class today.",
                NONE,
            ),
            (
                "year",
                "You appeared in 48 searches this week\n\
                 Hi Roman, you appeared in 48 searches this week.\n\
                 Your profile was verified by 12 connections. Confirm your 2026 goals.\n\
                 Roman, you have 1250 new connections suggestions.",
                NONE,
            ),
            (
                "year",
                "Your sign-in code\n\
                 Hi Roman,\n\
                 Enter this code in the app to finish signing in.\n\n\
                 1987\n\n\
                 The code expires in 10 minutes.",
                &["1987"],
            ),
            ("year", "Your code is 1987", &["1987"]),
            ("year", "Code: 2026", &["2026"]),
            ("year", "Your verification code:\n\n\u{00A9} 2026\n", NONE),
            ("year", "Your verification code:\n\nCopyright\n2026", NONE),
            // Promo wording in the next sentence, unless the code's own sentence names a sign-in.
            (
                "promo",
                "Last chance: 25% off ends tonight\n\
                 Hi Roman,\n\
                 Your code SPRING25 expires at midnight. Save 25% on everything sitewide.\n\
                 Shop now",
                NONE,
            ),
            ("promo", "Use code 482913 to log in. Save 20% today!", &["482913"]),
            (
                "promo",
                "Your code to log in to Allbirds\n\
                 Log in to Allbirds\n\
                 Here's the code you need to log in to your account:\n\
                 830215\n\
                 This code expires in 10 minutes. Shop new arrivals with 20% off this week.",
                &["830215"],
            ),
            // Application numbers and UK sort codes.
            (
                "identifier",
                "Identity verification in progress\n\
                 Hi Roman,\n\
                 Thank you for submitting your documents.\n\
                 Your verification application 4829103 is under review. It usually takes 1-3 \
                 business days.\n\
                 We'll email you once it's done.",
                NONE,
            ),
            (
                "identifier",
                "Invoice 2026/117 from Pixel Studio Ltd\n\
                 Hello,\n\
                 Attached is invoice 2026/117 for October design work.\n\
                 Total: \u{00A3}2,400.00\n\
                 Payment details:\n\
                 Sort code 404784\n\
                 Account 71234567\n\
                 Thank you for your business.",
                NONE,
            ),
            ("identifier", "Enter this code in the application: 482913", &["482913"]),
            ("identifier", "Your security code: 404784", &["404784"]),
        ];
        let failures: Vec<String> = corpus
            .iter()
            .filter_map(|(rule, mail, expected)| {
                let found = codes(mail);
                (found != *expected).then(|| format!("rule {rule}: got {found:?}, want {expected:?}: {mail:?}"))
            })
            .collect();
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn codes_in_markdown_emphasis_are_found() {
        assert_eq!(codes("Your verification code is *482913*"), vec!["482913"]);
        assert_eq!(codes("Your verification code is:\n\n**482913**"), vec!["482913"]);
        assert_eq!(codes("Your verification code is:\n\n__482913__"), vec!["482913"]);
        assert_eq!(codes("Your login code: _XK9P2Q_"), vec!["XK9P2Q"]);
        // One-sided or masked forms stay noise.
        assert!(codes("Verification for card ending ****4242").is_empty());
        assert!(codes("Your code is user_482913").is_empty());
        assert!(codes("Your code is *482913").is_empty());
        assert!(codes("Your code is AB_482913_CD").is_empty());
    }

    #[test]
    fn long_single_line_bodies_stay_fast() {
        // 1 MiB without a line break; the scan is capped and every check is bounded, so the work
        // is linear in the capped size.
        let one_line = |head: &str, unit: &str| {
            let mut text = String::from(head);
            while text.len() < 1024 * 1024 {
                text.push_str(unit);
            }
            text
        };
        let inputs = [
            one_line("Your code is here ", "x 4821 "),
            one_line("Ваш код тут ", "слово 4821 "),
            one_line("Your verification code is 482913 ", "ab 1234 cd "),
            // Every candidate directly follows a keyword, so all checks run for each one.
            one_line("Verify: ", "code 4821 "),
        ];
        for (i, text) in inputs.iter().enumerate() {
            let started = std::time::Instant::now();
            let result = codes(text);
            let elapsed = started.elapsed();
            // Measured at 60-300 ms per input in a debug build.
            assert!(elapsed < std::time::Duration::from_secs(1), "input {i} took {elapsed:?}");
            match i {
                2 => assert_eq!(result[0], "482913"),
                3 => assert_eq!(result, vec!["4821"]),
                _ => {}
            }
        }
    }

    #[test]
    fn html_rendering_drops_css_and_hex_colours() {
        let html = r#"<html><head><title>Verify</title><style>.a{color:#123456;font-size:14px}
            @media (max-width:600px){.b{width:100%}}</style></head>
            <body><!-- 999999 --><script>var code = 777777;</script>
            <div style="color:#654321">Your verification code</div>
            <table><tr><td><b>384712</b></td></tr></table>
            <p>Expires in 10&nbsp;minutes. &copy; 2024 Example&amp;Co</p></body></html>"#;
        let text = html_to_text(html);
        assert!(!text.contains("color"), "{text}");
        assert!(!text.contains("777777"), "{text}");
        assert!(!text.contains("999999"), "{text}");
        assert!(text.contains("Expires in 10 minutes."), "{text}");
        assert!(text.contains("\u{00A9} 2024 Example&Co"), "{text}");
        assert_eq!(codes(&text), vec!["384712"]);
    }

    #[test]
    fn html_entities_and_whitespace() {
        assert_eq!(decode_entities("a &lt;b&gt; &amp;amp; &#8212; &#x41; &unknown;"), "a <b> &amp; \u{2014} A &unknown;");
        assert_eq!(html_to_text("<p>Hello&nbsp;&nbsp; world</p>\n\n\n<p>Bye</p>"), "Hello world\n\nBye");
        assert_eq!(html_to_text("a < b and c > d"), "a < b and c > d");
        assert_eq!(html_to_text("Line<br>next<br/>last"), "Line\nnext\nlast");
        assert_eq!(html_to_text("x&zwnj;&#8203;y"), "xy");
    }

    fn meta(uid: u32) -> FetchMeta {
        FetchMeta {
            uid: Some(uid),
            seq: uid,
            ..FetchMeta::default()
        }
    }

    #[test]
    fn parses_multipart_alternative() {
        let raw = "From: Discord <noreply@discord.com>\r\n\
            To: user@example.com\r\n\
            Subject: =?UTF-8?B?VmVyaWZ5IHlvdXIgbG9naW4=?=\r\n\
            Date: Fri, 14 Nov 2025 09:00:00 +0000\r\n\
            MIME-Version: 1.0\r\n\
            Content-Type: multipart/alternative; boundary=\"b1\"\r\n\r\n\
            --b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n\
            Your Discord verification code is: 738291\r\n\
            --b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
            <p>Your Discord verification code is: <b>738291</b></p>\r\n\
            --b1--\r\n";
        let msg = build_message(Some(raw.as_bytes()), &meta(42));
        assert_eq!(msg.id, "42");
        assert_eq!(msg.subject, "Verify your login");
        assert_eq!(msg.from, "Discord <noreply@discord.com>");
        assert_eq!(msg.timestamp, 1_763_110_800_000);
        assert!(msg.date.contains("14 Nov 2025"), "{}", msg.date);
        assert_eq!(msg.body_content, "Your Discord verification code is: 738291");
        assert!(msg.body_html.as_deref().unwrap().contains("<b>738291</b>"));
        assert!(msg.has_verification_code);
        assert_eq!(msg.verification_codes, vec!["738291"]);
    }

    #[test]
    fn plain_text_mail_has_no_html() {
        let raw = "From: a@example.com\r\nSubject: Hi\r\nDate: 14 Nov 2025 10:00:00 +0200\r\n\r\n<b>not html</b> 1 < 2\r\n";
        let msg = build_message(Some(raw.as_bytes()), &meta(1));
        assert_eq!(msg.body_html, None);
        assert_eq!(msg.body_content, "<b>not html</b> 1 < 2");
        assert_eq!(msg.from, "a@example.com");
        assert_eq!(msg.timestamp, 1_763_107_200_000);
        assert!(!msg.has_verification_code);
    }

    #[test]
    fn html_only_mail_gets_text_rendering() {
        let raw = "From: X <info@x.com>\r\nSubject: Confirm your email\r\n\
            Content-Type: text/html; charset=utf-8\r\n\r\n\
            <html><head><style>.c{color:#a1b2c3}</style></head><body>\
            <p>Please enter this verification code to get started on X:</p>\
            <p style=\"font-size:32px\">7bpt5n9d</p></body></html>\r\n";
        let mut m = meta(7);
        m.internal_date_ms = Some(1_700_000_000_000);
        m.internal_date_text = Some("Tue, 14 Nov 2023 22:13:20 +0000".into());
        let msg = build_message(Some(raw.as_bytes()), &m);
        assert!(msg.body_html.is_some());
        assert_eq!(
            msg.body_content,
            "Please enter this verification code to get started on X:\n\n7bpt5n9d"
        );
        assert_eq!(msg.verification_codes, vec!["7bpt5n9d"]);
        // No Date header: INTERNALDATE is used.
        assert_eq!(msg.timestamp, 1_700_000_000_000);
        assert_eq!(msg.date, "Tue, 14 Nov 2023 22:13:20 +0000");
    }

    #[test]
    fn code_only_in_html_part_is_found() {
        let raw = "Subject: Sign in\r\nContent-Type: multipart/alternative; boundary=\"z\"\r\n\r\n\
            --z\r\nContent-Type: text/plain\r\n\r\nYour mail client does not support HTML.\r\n\
            --z\r\nContent-Type: text/html\r\n\r\n<p>Your security code:</p><p>551234</p>\r\n--z--\r\n";
        let msg = build_message(Some(raw.as_bytes()), &meta(3));
        assert_eq!(msg.body_content, "Your mail client does not support HTML.");
        assert_eq!(msg.verification_codes, vec!["551234"]);
    }

    #[test]
    fn preview_and_missing_body() {
        let long = "word ".repeat(100);
        let raw = format!("Subject: Long\r\n\r\n{long}\r\n");
        let msg = build_message(Some(raw.as_bytes()), &meta(1));
        assert!(msg.body_preview.chars().count() <= 203);
        assert!(msg.body_preview.starts_with("word word"));
        assert!(msg.body_preview.ends_with("word..."));

        let mut m = meta(9);
        m.truncated = true;
        let msg = build_message(None, &m);
        assert_eq!(msg.id, "9");
        assert_eq!(msg.body_preview, TOO_LARGE_PREVIEW);
        assert_eq!(msg.timestamp, 0);
        assert_eq!(msg.date, "");

        let msg = build_message(None, &FetchMeta { seq: 5, ..FetchMeta::default() });
        assert_eq!(msg.id, "seq-5");
        assert_eq!(msg.body_preview, "");
    }

    #[test]
    fn sorts_newest_first_by_timestamp() {
        let make = |ts: u64| EmailMessage {
            id: ts.to_string(),
            subject: String::new(),
            from: String::new(),
            date: String::new(),
            timestamp: ts,
            body_preview: String::new(),
            body_content: String::new(),
            body_html: None,
            has_verification_code: false,
            verification_codes: Vec::new(),
        };
        // Thursday mail (older) arrives with a higher sequence number than Friday mail.
        let mut list = vec![(1, make(200)), (2, make(100)), (3, make(0)), (4, make(200))];
        sort_newest_first(&mut list);
        let order: Vec<u32> = list.iter().map(|(seq, _)| *seq).collect();
        assert_eq!(order, vec![4, 1, 2, 3]);
    }

    #[test]
    fn client_validates_input() {
        assert!(matches!(
            EmailClient::new("  ", "pw", None, None),
            Err(EmailError::InvalidConfig(_))
        ));
        assert!(matches!(
            EmailClient::new("a@gmail.com", " \r\n", None, None),
            Err(EmailError::InvalidConfig(_))
        ));
        assert!(matches!(
            EmailClient::new("a@unknown.example", "pw", None, None),
            Err(EmailError::UnsupportedProvider(_))
        ));
        assert!(matches!(
            EmailClient::new("a@x.org", "pw", Some("https://imap.x.org"), None),
            Err(EmailError::InvalidConfig(_))
        ));
        let client = EmailClient::new(" a@Gmail.com\r\n", "secret\r\n", None, None).unwrap();
        assert_eq!(client.username, "a@Gmail.com");
        assert_eq!(client.password.as_str(), "secret");
        assert_eq!(client.config.imap_host, "imap.gmail.com");
        let client = EmailClient::new("login", "pw", Some("mail.x.org"), Some(1993)).unwrap();
        assert_eq!(client.config.imap_port, 1993);
    }

    #[test]
    fn fetch_limit_is_clamped() {
        assert_eq!(clamp_fetch_limit(None), 5);
        assert_eq!(clamp_fetch_limit(Some(0)), 1);
        assert_eq!(clamp_fetch_limit(Some(12)), 12);
        assert_eq!(clamp_fetch_limit(Some(100_000)), 30);
    }
}
