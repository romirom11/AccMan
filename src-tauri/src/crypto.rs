//! `crypto.rs`: key derivation and the encrypted file envelope.
//!
//! Current format (v2):
//! ```json
//! { "format": 2,
//!   "kdf": { "alg": "scrypt", "logN": 17, "r": 8, "p": 1 },
//!   "salt": "<base64>", "nonce": "<base64>", "ciphertext": "<base64, includes GCM tag>" }
//! ```
//! The header fields (format, KDF parameters, salt) are bound to the ciphertext as AES-GCM
//! associated data, so they cannot be altered without the decryption failing.
//!
//! Legacy format (v1, still readable): `{ "salt": "<base64>", "ciphertext": [n, n, ...] }` where
//! the number array is `nonce(12) || AES-256-GCM output`, scrypt logN=14 r=8 p=1, empty AAD.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ring::aead::{self, Aad, LessSafeKey, Nonce, UnboundKey};
use serde_json::{Map, Value};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::error::{CommandError, ErrorCode};

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;
pub const SALT_LEN: usize = 16;
pub const TAG_LEN: usize = 16;
pub const FORMAT_V2: u64 = 2;
pub const MIN_PASSWORD_CHARS: usize = 8;

const AAD_PREFIX: &[u8] = b"AccMan vault v2\0scrypt\0";

/// scrypt cost parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    pub log_n: u8,
    pub r: u32,
    pub p: u32,
}

impl KdfParams {
    /// Parameters used for every newly written vault.
    pub const CURRENT: KdfParams = KdfParams { log_n: 17, r: 8, p: 1 };
    /// Parameters implied by a legacy (v1) file.
    pub const LEGACY_V1: KdfParams = KdfParams { log_n: 14, r: 8, p: 1 };

    const MAX_LOG_N: u64 = 22;
    const MAX_R: u64 = 32;
    const MAX_P: u64 = 16;
    /// Upper bound for the memory scrypt would allocate (128 * r * N bytes).
    const MAX_MEMORY_BYTES: u128 = 2 * 1024 * 1024 * 1024;

    /// Validates parameters read from an untrusted file.
    pub fn checked(log_n: u64, r: u64, p: u64) -> Result<KdfParams, CryptoError> {
        if !(1..=Self::MAX_LOG_N).contains(&log_n)
            || !(1..=Self::MAX_R).contains(&r)
            || !(1..=Self::MAX_P).contains(&p)
        {
            return Err(CryptoError::Corrupted("KDF parameters out of range"));
        }
        let params = KdfParams {
            log_n: log_n as u8,
            r: r as u32,
            p: p as u32,
        };
        if params.memory_bytes() > Self::MAX_MEMORY_BYTES {
            return Err(CryptoError::Corrupted("KDF parameters out of range"));
        }
        scrypt::Params::new(params.log_n, params.r, params.p, KEY_LEN)
            .map_err(|_| CryptoError::Corrupted("KDF parameters out of range"))?;
        Ok(params)
    }

    fn memory_bytes(&self) -> u128 {
        128u128 * self.r as u128 * (1u128 << self.log_n)
    }

    /// Relative work factor, used to decide whether a file should be upgraded.
    pub fn cost(&self) -> u128 {
        (1u128 << self.log_n) * self.r as u128 * self.p as u128
    }

    pub fn is_weaker_than(&self, other: &KdfParams) -> bool {
        self.cost() < other.cost()
    }
}

/// A derived vault key together with the salt and parameters it was derived with.
/// The master password itself is never stored.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SessionKey {
    key: [u8; KEY_LEN],
    salt: [u8; SALT_LEN],
    #[zeroize(skip)]
    params: KdfParams,
}

impl SessionKey {
    /// Derives a key with a fresh random salt.
    pub fn derive(password: &[u8], params: KdfParams) -> Result<SessionKey, CryptoError> {
        let mut salt = [0u8; SALT_LEN];
        getrandom::getrandom(&mut salt).map_err(|_| CryptoError::Internal("random source failed"))?;
        Self::derive_with_salt(password, salt, params)
    }

    pub fn derive_with_salt(
        password: &[u8],
        salt: [u8; SALT_LEN],
        params: KdfParams,
    ) -> Result<SessionKey, CryptoError> {
        let scrypt_params = scrypt::Params::new(params.log_n, params.r, params.p, KEY_LEN)
            .map_err(|_| CryptoError::Internal("invalid scrypt parameters"))?;
        let mut key = [0u8; KEY_LEN];
        scrypt::scrypt(password, &salt, &scrypt_params, &mut key)
            .map_err(|_| CryptoError::Internal("scrypt failed"))?;
        Ok(SessionKey { key, salt, params })
    }

    /// Re-derives a key from `password` with this key's salt and parameters.
    pub fn rederive(&self, password: &[u8]) -> Result<SessionKey, CryptoError> {
        Self::derive_with_salt(password, self.salt, self.params)
    }

    pub fn params(&self) -> KdfParams {
        self.params
    }

    pub fn salt(&self) -> &[u8; SALT_LEN] {
        &self.salt
    }

    /// Constant-time comparison of two derived keys (and their salts).
    pub fn same_key_as(&self, other: &SessionKey) -> bool {
        let mut diff = 0u8;
        for (a, b) in self.key.iter().zip(other.key.iter()) {
            diff |= a ^ b;
        }
        for (a, b) in self.salt.iter().zip(other.salt.iter()) {
            diff |= a ^ b;
        }
        std::hint::black_box(diff) == 0 && self.params == other.params
    }

    fn aead_key(&self) -> Result<LessSafeKey, CryptoError> {
        let unbound = UnboundKey::new(&aead::AES_256_GCM, &self.key)
            .map_err(|_| CryptoError::Internal("AES key setup failed"))?;
        Ok(LessSafeKey::new(unbound))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CryptoError {
    /// Authentication failed: wrong password or a modified file.
    #[error("invalid password")]
    InvalidPassword,
    #[error("corrupted vault: {0}")]
    Corrupted(&'static str),
    #[error("unsupported vault format {0}")]
    UnsupportedVersion(String),
    #[error("internal crypto error: {0}")]
    Internal(&'static str),
}

impl From<CryptoError> for CommandError {
    fn from(err: CryptoError) -> Self {
        match err {
            CryptoError::InvalidPassword => CommandError::invalid_password(),
            CryptoError::Corrupted(detail) => CommandError::corrupted(detail),
            CryptoError::UnsupportedVersion(v) => CommandError::new(
                ErrorCode::UnsupportedVaultVersion,
                format!(
                    "This vault was written in format {v}, which this version of AccMan cannot read. Please update the app."
                ),
            ),
            CryptoError::Internal(detail) => {
                CommandError::internal(format!("Cryptography error: {detail}"))
            }
        }
    }
}

/// A parsed (but not yet decrypted) envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Envelope {
    pub format: u64,
    pub params: KdfParams,
    pub salt: [u8; SALT_LEN],
    nonce: [u8; NONCE_LEN],
    ciphertext: Vec<u8>,
}

impl Envelope {
    /// Parses an encrypted file without running the KDF. Never panics on malformed input.
    pub fn parse(bytes: &[u8]) -> Result<Envelope, CryptoError> {
        let root: Value = serde_json::from_slice(bytes)
            .map_err(|_| CryptoError::Corrupted("not valid JSON"))?;
        let obj = root
            .as_object()
            .ok_or(CryptoError::Corrupted("not a JSON object"))?;
        match obj.get("format") {
            None => Self::parse_v1(obj),
            Some(Value::Number(n)) => match n.as_u64() {
                Some(FORMAT_V2) => Self::parse_v2(obj),
                _ => Err(CryptoError::UnsupportedVersion(n.to_string())),
            },
            Some(_) => Err(CryptoError::Corrupted("invalid format field")),
        }
    }

    fn parse_v1(obj: &Map<String, Value>) -> Result<Envelope, CryptoError> {
        let salt = decode_salt(obj.get("salt"))?;
        let raw = obj
            .get("ciphertext")
            .and_then(Value::as_array)
            .ok_or(CryptoError::Corrupted("missing ciphertext"))?;
        let mut bytes = Vec::with_capacity(raw.len());
        for item in raw {
            let byte = item
                .as_u64()
                .filter(|b| *b <= u8::MAX as u64)
                .ok_or(CryptoError::Corrupted("invalid ciphertext"))?;
            bytes.push(byte as u8);
        }
        let (nonce, rest) = bytes
            .split_first_chunk::<NONCE_LEN>()
            .ok_or(CryptoError::Corrupted("ciphertext too short"))?;
        if rest.len() < TAG_LEN {
            return Err(CryptoError::Corrupted("ciphertext too short"));
        }
        Ok(Envelope {
            format: 1,
            params: KdfParams::LEGACY_V1,
            salt,
            nonce: *nonce,
            ciphertext: rest.to_vec(),
        })
    }

    fn parse_v2(obj: &Map<String, Value>) -> Result<Envelope, CryptoError> {
        let kdf = obj
            .get("kdf")
            .and_then(Value::as_object)
            .ok_or(CryptoError::Corrupted("missing KDF parameters"))?;
        match kdf.get("alg").and_then(Value::as_str) {
            Some("scrypt") => {}
            Some(other) => return Err(CryptoError::UnsupportedVersion(format!("2 (KDF '{other}')"))),
            None => return Err(CryptoError::Corrupted("missing KDF algorithm")),
        }
        let num = |name: &str| -> Result<u64, CryptoError> {
            kdf.get(name)
                .and_then(Value::as_u64)
                .ok_or(CryptoError::Corrupted("invalid KDF parameters"))
        };
        let params = KdfParams::checked(num("logN")?, num("r")?, num("p")?)?;
        let salt = decode_salt(obj.get("salt"))?;
        let nonce: [u8; NONCE_LEN] = decode_b64(obj.get("nonce"))?
            .try_into()
            .map_err(|_| CryptoError::Corrupted("invalid nonce"))?;
        let ciphertext = decode_b64(obj.get("ciphertext"))?;
        if ciphertext.len() < TAG_LEN {
            return Err(CryptoError::Corrupted("ciphertext too short"));
        }
        Ok(Envelope {
            format: FORMAT_V2,
            params,
            salt,
            nonce,
            ciphertext,
        })
    }

    fn aad(&self) -> Vec<u8> {
        if self.format == 1 {
            Vec::new()
        } else {
            header_aad(&self.params, &self.salt)
        }
    }

    /// Decrypts with an already derived key (salt and parameters must match the envelope).
    pub fn open_with_key(&self, key: &SessionKey) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
        if key.salt != self.salt || key.params != self.params {
            return Err(CryptoError::InvalidPassword);
        }
        let aead_key = key.aead_key()?;
        let mut in_out = Zeroizing::new(self.ciphertext.clone());
        let plain_len = aead_key
            .open_in_place(
                Nonce::assume_unique_for_key(self.nonce),
                Aad::from(self.aad()),
                &mut in_out,
            )
            .map_err(|_| CryptoError::InvalidPassword)?
            .len();
        in_out.truncate(plain_len);
        Ok(in_out)
    }
}

/// Result of decrypting a file with a password.
pub struct Decrypted {
    pub plaintext: Zeroizing<Vec<u8>>,
    pub key: SessionKey,
    pub format: u64,
}

/// Parses `bytes`, derives the key from `password` and decrypts.
pub fn decrypt(bytes: &[u8], password: &[u8]) -> Result<Decrypted, CryptoError> {
    let envelope = Envelope::parse(bytes)?;
    let key = SessionKey::derive_with_salt(password, envelope.salt, envelope.params)?;
    let plaintext = envelope.open_with_key(&key)?;
    Ok(Decrypted {
        plaintext,
        key,
        format: envelope.format,
    })
}

/// Encrypts `plaintext` into a v2 envelope (serialised JSON bytes) with a fresh random nonce.
pub fn encrypt(plaintext: &[u8], key: &SessionKey) -> Result<Vec<u8>, CryptoError> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce).map_err(|_| CryptoError::Internal("random source failed"))?;
    let aead_key = key.aead_key()?;
    let mut in_out = plaintext.to_vec();
    aead_key
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(header_aad(&key.params, &key.salt)),
            &mut in_out,
        )
        .map_err(|_| CryptoError::Internal("encryption failed"))?;
    let envelope = serde_json::json!({
        "format": FORMAT_V2,
        "kdf": {
            "alg": "scrypt",
            "logN": key.params.log_n,
            "r": key.params.r,
            "p": key.params.p,
        },
        "salt": B64.encode(key.salt),
        "nonce": B64.encode(nonce),
        "ciphertext": B64.encode(&in_out),
    });
    serde_json::to_vec_pretty(&envelope).map_err(|_| CryptoError::Internal("serialisation failed"))
}

fn header_aad(params: &KdfParams, salt: &[u8; SALT_LEN]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(AAD_PREFIX.len() + 9 + SALT_LEN);
    aad.extend_from_slice(AAD_PREFIX);
    aad.push(params.log_n);
    aad.extend_from_slice(&params.r.to_be_bytes());
    aad.extend_from_slice(&params.p.to_be_bytes());
    aad.extend_from_slice(salt);
    aad
}

fn decode_b64(value: Option<&Value>) -> Result<Vec<u8>, CryptoError> {
    let text = value
        .and_then(Value::as_str)
        .ok_or(CryptoError::Corrupted("missing field"))?;
    B64.decode(text)
        .map_err(|_| CryptoError::Corrupted("invalid base64"))
}

fn decode_salt(value: Option<&Value>) -> Result<[u8; SALT_LEN], CryptoError> {
    decode_b64(value)?
        .try_into()
        .map_err(|_| CryptoError::Corrupted("invalid salt"))
}

/// True when the password satisfies the minimum length policy.
pub fn password_long_enough(password: &str) -> bool {
    password.chars().count() >= MIN_PASSWORD_CHARS
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Cheap parameters so tests do not spend time in scrypt.
    pub const TEST_PARAMS: KdfParams = KdfParams { log_n: 4, r: 8, p: 1 };

    /// Builds a legacy v1 file exactly like the pre-v2 app did.
    pub fn legacy_v1_file(plaintext: &[u8], password: &str) -> Vec<u8> {
        let salt = [7u8; SALT_LEN];
        let params = scrypt::Params::new(14, 8, 1, KEY_LEN).unwrap();
        let mut key = [0u8; KEY_LEN];
        scrypt::scrypt(password.as_bytes(), &salt, &params, &mut key).unwrap();
        let nonce = [3u8; NONCE_LEN];
        let sealing = LessSafeKey::new(UnboundKey::new(&aead::AES_256_GCM, &key).unwrap());
        let mut in_out = plaintext.to_vec();
        sealing
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::empty(), &mut in_out)
            .unwrap();
        let mut ciphertext = nonce.to_vec();
        ciphertext.extend_from_slice(&in_out);
        serde_json::to_vec_pretty(&serde_json::json!({
            "salt": B64.encode(salt),
            "ciphertext": ciphertext,
        }))
        .unwrap()
    }

    #[test]
    fn v2_round_trip() {
        let key = SessionKey::derive(b"correct horse", TEST_PARAMS).unwrap();
        let file = encrypt(b"{\"hello\":1}", &key).unwrap();
        let text = String::from_utf8(file.clone()).unwrap();
        assert!(text.contains("\"format\": 2"));
        assert!(text.contains("\"logN\": 4"));
        let out = decrypt(&file, b"correct horse").unwrap();
        assert_eq!(out.plaintext.as_slice(), b"{\"hello\":1}");
        assert_eq!(out.format, 2);
        assert!(out.key.same_key_as(&key));
    }

    #[test]
    fn fresh_nonce_per_encryption() {
        let key = SessionKey::derive(b"pw", TEST_PARAMS).unwrap();
        let a = Envelope::parse(&encrypt(b"same", &key).unwrap()).unwrap();
        let b = Envelope::parse(&encrypt(b"same", &key).unwrap()).unwrap();
        assert_ne!(a.nonce, b.nonce);
        assert_eq!(a.salt, b.salt);
    }

    #[test]
    fn wrong_password_is_invalid_password() {
        let key = SessionKey::derive(b"right", TEST_PARAMS).unwrap();
        let file = encrypt(b"data", &key).unwrap();
        assert_eq!(decrypt(&file, b"wrong").err(), Some(CryptoError::InvalidPassword));
        let err: CommandError = CryptoError::InvalidPassword.into();
        assert_eq!(err.code, ErrorCode::InvalidPassword);
    }

    #[test]
    fn tampered_header_or_body_fails_authentication() {
        let key = SessionKey::derive(b"pw", TEST_PARAMS).unwrap();
        let file = encrypt(b"secret data", &key).unwrap();
        let mut value: Value = serde_json::from_slice(&file).unwrap();

        // Flip a ciphertext byte.
        let mut ct = B64.decode(value["ciphertext"].as_str().unwrap()).unwrap();
        ct[0] ^= 1;
        let mut tampered = value.clone();
        tampered["ciphertext"] = Value::String(B64.encode(&ct));
        let bytes = serde_json::to_vec(&tampered).unwrap();
        assert_eq!(decrypt(&bytes, b"pw").err(), Some(CryptoError::InvalidPassword));

        // Change a header parameter: authenticated as AAD, so it must fail too.
        value["kdf"]["r"] = Value::from(9);
        let bytes = serde_json::to_vec(&value).unwrap();
        assert_eq!(decrypt(&bytes, b"pw").err(), Some(CryptoError::InvalidPassword));
    }

    #[test]
    fn malformed_input_never_panics() {
        let key = SessionKey::derive(b"pw", TEST_PARAMS).unwrap();
        let good = encrypt(b"payload", &key).unwrap();
        let mut inputs: Vec<Vec<u8>> = vec![
            b"".to_vec(),
            b"null".to_vec(),
            b"[]".to_vec(),
            b"{}".to_vec(),
            b"not json".to_vec(),
            br#"{"salt":"AAAAAAAAAAAAAAAAAAAAAA==","ciphertext":[]}"#.to_vec(),
            br#"{"salt":"AAAAAAAAAAAAAAAAAAAAAA==","ciphertext":[1,2,3]}"#.to_vec(),
            br#"{"salt":"AAAAAAAAAAAAAAAAAAAAAA==","ciphertext":[1,2,3,4,5,6,7,8,9,10,11,12,13]}"#.to_vec(),
            br#"{"salt":"AAAAAAAAAAAAAAAAAAAAAA==","ciphertext":[300]}"#.to_vec(),
            br#"{"salt":"!!","ciphertext":[1]}"#.to_vec(),
            br#"{"salt":"AAAA","ciphertext":[1]}"#.to_vec(),
            br#"{"format":"2"}"#.to_vec(),
            br#"{"format":2}"#.to_vec(),
            br#"{"format":2,"kdf":{"alg":"scrypt","logN":40,"r":8,"p":1}}"#.to_vec(),
            br#"{"format":2,"kdf":{"alg":"scrypt","logN":4,"r":8,"p":1},"salt":"AAAAAAAAAAAAAAAAAAAAAA==","nonce":"AAAA","ciphertext":"AAAA"}"#.to_vec(),
            br#"{"format":2,"kdf":{"alg":"scrypt","logN":4,"r":8,"p":1},"salt":"AAAAAAAAAAAAAAAAAAAAAA==","nonce":"AAAAAAAAAAAAAAAA","ciphertext":""}"#.to_vec(),
            br#"{"format":2,"kdf":{"alg":"scrypt","logN":4,"r":0,"p":1}}"#.to_vec(),
        ];
        for cut in [1, 10, good.len() / 2, good.len() - 1] {
            inputs.push(good[..cut].to_vec());
        }
        for input in inputs {
            let result = decrypt(&input, b"pw");
            assert!(
                matches!(result, Err(CryptoError::Corrupted(_)) | Err(CryptoError::InvalidPassword)),
                "unexpected result for {:?}",
                String::from_utf8_lossy(&input)
            );
        }
    }

    #[test]
    fn absurd_kdf_params_are_rejected_before_derivation() {
        let file = br#"{"format":2,"kdf":{"alg":"scrypt","logN":22,"r":32,"p":16},"salt":"AAAAAAAAAAAAAAAAAAAAAA==","nonce":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAA=="}"#;
        assert!(matches!(Envelope::parse(file), Err(CryptoError::Corrupted(_))));
        let err: CommandError = Envelope::parse(file).unwrap_err().into();
        assert_eq!(err.code, ErrorCode::VaultCorrupted);
    }

    #[test]
    fn unknown_format_is_unsupported() {
        let err = decrypt(br#"{"format":3,"whatever":true}"#, b"pw").err().unwrap();
        assert!(matches!(err, CryptoError::UnsupportedVersion(_)));
        let cmd: CommandError = err.into();
        assert_eq!(cmd.code, ErrorCode::UnsupportedVaultVersion);
    }

    #[test]
    fn legacy_v1_file_decrypts() {
        let file = legacy_v1_file(b"{\"legacy\":true}", "old-password");
        let out = decrypt(&file, b"old-password").unwrap();
        assert_eq!(out.plaintext.as_slice(), b"{\"legacy\":true}");
        assert_eq!(out.format, 1);
        assert_eq!(out.key.params(), KdfParams::LEGACY_V1);
        assert!(out.key.params().is_weaker_than(&KdfParams::CURRENT));
        assert_eq!(decrypt(&file, b"nope").err(), Some(CryptoError::InvalidPassword));

        // Re-encrypting with the legacy-derived key yields a readable v2 file.
        let v2 = encrypt(b"again", &out.key).unwrap();
        let again = decrypt(&v2, b"old-password").unwrap();
        assert_eq!(again.format, 2);
        assert_eq!(again.plaintext.as_slice(), b"again");
    }

    #[test]
    fn rederive_matches_only_with_same_password() {
        let key = SessionKey::derive(b"alpha", TEST_PARAMS).unwrap();
        assert!(key.rederive(b"alpha").unwrap().same_key_as(&key));
        assert!(!key.rederive(b"beta").unwrap().same_key_as(&key));
    }

    #[test]
    fn password_policy_counts_characters() {
        assert!(!password_long_enough("1234567"));
        assert!(password_long_enough("12345678"));
        assert!(password_long_enough("пароль12"));
    }
}
