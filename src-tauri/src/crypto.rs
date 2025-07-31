//! `crypto.rs`: Handles all cryptographic operations for the application.

use base64::{engine::general_purpose, Engine as _};
use lazy_static::lazy_static;
use rand::rngs::OsRng;
use rand::RngCore;
use ring::aead::{
    self, BoundKey, Nonce as RingNonce, NonceSequence, OpeningKey, SealingKey, UnboundKey,
};
use scrypt::{scrypt, Params};
use zeroize::{Zeroize, ZeroizeOnDrop};

// --- Constants & Static ---

const SCRYPT_LOG_N: u8 = 14;
const SCRYPT_R: u32 = 8;
const SCRYPT_P: u32 = 1;
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const SALT_LEN: usize = 16;

lazy_static! {
    static ref SCRYPT_PARAMS: Params =
        Params::new(SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, KEY_LEN).unwrap();
}

// --- Structs ---

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct DerivedKey {
    pub key: [u8; KEY_LEN],
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct MasterPassword(pub String);

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct EncryptedVault {
    pub salt: String,
    pub ciphertext: Vec<u8>,
}

// --- Nonce Sequence ---

struct OneNonceSequence(Option<RingNonce>);

impl NonceSequence for OneNonceSequence {
    fn advance(&mut self) -> Result<RingNonce, ring::error::Unspecified> {
        self.0.take().ok_or(ring::error::Unspecified)
    }
}

// --- Errors ---

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("Scrypt failed: {0}")]
    Scrypt(#[from] scrypt::errors::InvalidParams),
    #[error("Scrypt failed during key derivation")]
    ScryptDerivation,
    #[error("Encryption/Decryption failed: Ring error")]
    Ring,
    #[error("Base64 decoding failed: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("Slice conversion failed")]
    Slice,
}

// --- Public Functions ---

pub fn derive_key(
    password: &MasterPassword,
    salt: &[u8; SALT_LEN],
) -> Result<DerivedKey, CryptoError> {
    let mut key = [0u8; KEY_LEN];
    scrypt(password.0.as_bytes(), salt, &SCRYPT_PARAMS, &mut key)
        .map_err(|_| CryptoError::ScryptDerivation)?;
    Ok(DerivedKey { key })
}

pub fn encrypt_vault(
    data: &[u8],
    password: &MasterPassword,
) -> Result<EncryptedVault, CryptoError> {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);

    let derived_key = derive_key(password, &salt)?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = RingNonce::assume_unique_for_key(nonce_bytes);

    let unbound_key =
        UnboundKey::new(&aead::AES_256_GCM, &derived_key.key).map_err(|_| CryptoError::Ring)?;

    let mut sealing_key = SealingKey::new(unbound_key, OneNonceSequence(Some(nonce)));

    let mut in_out = data.to_vec();
    sealing_key
        .seal_in_place_append_tag(aead::Aad::empty(), &mut in_out)
        .map_err(|_| CryptoError::Ring)?;

    // We need to prepend the nonce to the ciphertext to use it for decryption
    let mut ciphertext_with_nonce = nonce_bytes.to_vec();
    ciphertext_with_nonce.extend_from_slice(&in_out);

    Ok(EncryptedVault {
        salt: general_purpose::STANDARD.encode(salt),
        ciphertext: ciphertext_with_nonce,
    })
}

pub fn decrypt_vault(
    encrypted_vault: EncryptedVault,
    password: &MasterPassword,
) -> Result<Vec<u8>, CryptoError> {
    let salt: [u8; SALT_LEN] = general_purpose::STANDARD
        .decode(&encrypted_vault.salt)?
        .try_into()
        .map_err(|_| CryptoError::Slice)?;

    let derived_key = derive_key(password, &salt)?;

    let (nonce_bytes_slice, ciphertext_slice) = encrypted_vault.ciphertext.split_at(NONCE_LEN);
    let nonce_bytes: [u8; NONCE_LEN] = nonce_bytes_slice
        .try_into()
        .map_err(|_| CryptoError::Slice)?;
    let nonce = RingNonce::assume_unique_for_key(nonce_bytes);

    let unbound_key =
        UnboundKey::new(&aead::AES_256_GCM, &derived_key.key).map_err(|_| CryptoError::Ring)?;
    let mut opening_key = OpeningKey::new(unbound_key, OneNonceSequence(Some(nonce)));

    let mut in_out = ciphertext_slice.to_vec();
    let decrypted_data = opening_key
        .open_in_place(aead::Aad::empty(), &mut in_out)
        .map_err(|_| CryptoError::Ring)?;

    Ok(decrypted_data.to_vec())
}
