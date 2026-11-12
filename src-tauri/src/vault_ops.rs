//! `vault_ops.rs`: pure vault logic. Every function works on `&mut Vault` and either applies
//! the whole change or returns an error; callers run them on a clone and only commit on success.
//! Timestamps are passed in (`now`, Unix ms) so the functions stay deterministic in tests.

use std::collections::{HashMap, HashSet};

use crate::defaults;
use crate::error::{CommandError, CommandResult, ErrorCode};
use crate::models::{
    Account, BulkCreateRequest, BulkCreateSummary, ImportSummary, Service, ServiceField,
    ServiceType, Settings, Vault, FIELD_TYPES, VAULT_VERSION,
};

pub const MAX_BULK_COUNT: u32 = 1000;
const NUMBER_PLACEHOLDER: &str = "%n%";
const TWO_FA_KEYS: &[&str] = &["2fa_key", "totp", "totp_secret"];
const MAX_AUTO_LOCK_MINUTES: u32 = 24 * 60;
const MAX_CLIPBOARD_CLEAR_SECONDS: u32 = 60 * 60;

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// --- Creation ---

/// A fresh vault with the selected default service types (unknown ids are ignored).
pub fn new_vault(settings: Settings, selected_service_type_ids: &[String]) -> CommandResult<Vault> {
    validate_settings(&settings)?;
    let service_types = defaults::get_default_service_types()
        .into_iter()
        .filter(|st| selected_service_type_ids.contains(&st.id))
        .collect();
    Ok(Vault {
        version: VAULT_VERSION.to_string(),
        service_types,
        services: Vec::new(),
        accounts: Vec::new(),
        settings,
    })
}

// --- Normalisation ---

/// Repairs legacy data and enforces the invariants the other operations rely on.
/// Returns true when anything changed.
pub fn normalize(vault: &mut Vault) -> bool {
    let before = vault.clone();

    // Ids must be non-empty and unique within their collection; later duplicates are re-keyed
    // (references keep pointing at the first record with that id).
    {
        let mut seen = HashSet::new();
        for st in &mut vault.service_types {
            if st.id.trim().is_empty() || !seen.insert(st.id.clone()) {
                st.id = new_id();
                seen.insert(st.id.clone());
            }
        }
        let mut seen = HashSet::new();
        for s in &mut vault.services {
            if s.id.trim().is_empty() || !seen.insert(s.id.clone()) {
                s.id = new_id();
                seen.insert(s.id.clone());
            }
        }
        let mut seen = HashSet::new();
        for a in &mut vault.accounts {
            if a.id.trim().is_empty() || !seen.insert(a.id.clone()) {
                a.id = new_id();
                seen.insert(a.id.clone());
            }
        }
    }

    for st in &mut vault.service_types {
        for field in &mut st.fields {
            normalize_field(field);
        }
    }
    remove_dangling_linked_fields(vault);
    add_missing_imap_fields(vault);

    let service_ids: HashSet<String> = vault.services.iter().map(|s| s.id.clone()).collect();
    for account in &mut vault.accounts {
        account.linked_services = sanitize_links(&account.linked_services, &service_ids);
        account.tags = normalize_tags(&account.tags);
    }

    let linked_keys = linked_field_keys(&vault.service_types);
    for service in &mut vault.services {
        service.tags = normalize_tags(&service.tags);
        if let Some(keys) = linked_keys.get(&service.service_type_id) {
            for key in keys {
                if let Some(value) = service.data.get(key) {
                    if !value.is_empty() && !service_ids.contains(value) {
                        service.data.remove(key);
                    }
                }
            }
        }
    }

    vault.version = VAULT_VERSION.to_string();
    *vault != before
}

/// Legacy data (the old app deleted types without cleaning up, and allowed linked fields without
/// a target): `linked_service` fields whose target type is missing are removed together with
/// their stored values, as `delete_service_type` does.
fn remove_dangling_linked_fields(vault: &mut Vault) {
    let type_ids: HashSet<String> = vault.service_types.iter().map(|t| t.id.clone()).collect();
    let mut removed_by_type: HashMap<String, Vec<String>> = HashMap::new();
    for st in &mut vault.service_types {
        let mut removed = Vec::new();
        st.fields.retain_mut(|field| {
            if field.field_type != "linked_service" {
                return true;
            }
            let target = field
                .linked_service_type_id
                .as_deref()
                .map(str::trim)
                .filter(|t| type_ids.contains(*t))
                .map(str::to_string);
            match target {
                Some(target) => {
                    field.linked_service_type_id = Some(target);
                    true
                }
                None => {
                    removed.push(field.key.clone());
                    false
                }
            }
        });
        // A remaining field may (in broken legacy data) share the key; its values stay.
        removed.retain(|key| st.fields.iter().all(|f| &f.key != key));
        if !removed.is_empty() {
            removed_by_type.insert(st.id.clone(), removed);
        }
    }
    for service in &mut vault.services {
        if let Some(keys) = removed_by_type.get(&service.service_type_id) {
            for key in keys {
                service.data.remove(key);
            }
        }
    }
}

/// Vaults created before IMAP support have a built-in Email type without the optional
/// `imap_host`/`imap_port` fields that let any IMAP server be used; add the missing ones.
fn add_missing_imap_fields(vault: &mut Vault) {
    let Some(st) = vault.service_types.iter_mut().find(|t| t.id == "email") else {
        return;
    };
    let has_key = |st: &ServiceType, key: &str| st.fields.iter().any(|f| f.key == key);
    if !has_key(st, "email") || !has_key(st, "password") {
        return;
    }
    let Some(defaults) = defaults::get_default_service_types()
        .into_iter()
        .find(|t| t.id == "email")
    else {
        return;
    };
    for key in ["imap_host", "imap_port"] {
        if has_key(st, key) {
            continue;
        }
        let Some(mut field) = defaults.fields.iter().find(|f| f.key == key).cloned() else {
            continue;
        };
        if st.fields.iter().any(|f| f.id == field.id) {
            field.id = new_id();
        }
        st.fields.push(field);
    }
}

fn normalize_field(field: &mut ServiceField) {
    if field.field_type == "secret" && TWO_FA_KEYS.contains(&field.key.as_str()) {
        field.field_type = "2fa".to_string();
    }
    if field.field_type == "2fa" {
        field.masked = true;
    }
}

/// Trims tags, drops empty ones and duplicates (first occurrence wins).
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    tags.iter()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .filter(|t| seen.insert(t.to_string()))
        .map(str::to_string)
        .collect()
}

/// Keeps ids that exist, de-duplicated, in their original order.
fn sanitize_links(ids: &[String], existing: &HashSet<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.iter()
        .filter(|id| existing.contains(*id) && seen.insert((*id).clone()))
        .cloned()
        .collect()
}

/// Service type id -> keys of its `linked_service` fields.
fn linked_field_keys(types: &[ServiceType]) -> HashMap<String, Vec<String>> {
    types
        .iter()
        .map(|st| {
            let keys = st
                .fields
                .iter()
                .filter(|f| f.field_type == "linked_service")
                .map(|f| f.key.clone())
                .collect();
            (st.id.clone(), keys)
        })
        .collect()
}

/// Safety net run before every save: ids must be non-empty and unique.
pub fn check_integrity(vault: &Vault) -> CommandResult<()> {
    fn unique<'a>(kind: &str, ids: impl Iterator<Item = &'a String>) -> CommandResult<()> {
        let mut seen = HashSet::new();
        for id in ids {
            if id.trim().is_empty() {
                return Err(CommandError::validation(format!("A {kind} has an empty ID.")));
            }
            if !seen.insert(id) {
                return Err(CommandError::duplicate_id(kind, id));
            }
        }
        Ok(())
    }
    unique("service type", vault.service_types.iter().map(|t| &t.id))?;
    unique("service", vault.services.iter().map(|s| &s.id))?;
    unique("account", vault.accounts.iter().map(|a| &a.id))?;
    Ok(())
}

// --- Validation helpers ---

fn require_id(kind: &str, id: &str) -> CommandResult<()> {
    if id.trim().is_empty() {
        return Err(CommandError::validation(format!("The {kind} ID must not be empty.")));
    }
    Ok(())
}

fn require_label(what: &str, label: &str) -> CommandResult<String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Err(CommandError::validation(format!("The {what} must not be empty.")));
    }
    Ok(trimmed.to_string())
}

fn is_valid_field_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

fn type_exists(vault: &Vault, id: &str) -> bool {
    vault.service_types.iter().any(|t| t.id == id)
}

fn require_type<'a>(vault: &'a Vault, id: &str) -> CommandResult<&'a ServiceType> {
    vault
        .service_types
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| CommandError::service_type_not_found(id))
}

pub fn validate_settings(settings: &Settings) -> CommandResult<()> {
    if settings.auto_lock_minutes > MAX_AUTO_LOCK_MINUTES {
        return Err(CommandError::validation(format!(
            "Auto-lock must be at most {MAX_AUTO_LOCK_MINUTES} minutes."
        )));
    }
    if settings.clipboard_clear_seconds > MAX_CLIPBOARD_CLEAR_SECONDS {
        return Err(CommandError::validation(format!(
            "Clipboard clearing must be at most {MAX_CLIPBOARD_CLEAR_SECONDS} seconds."
        )));
    }
    Ok(())
}

/// Validates and cleans a service type definition. `vault` is the state the type will live in
/// (used to check `linked_service` targets; the type itself is a valid target).
fn prepare_service_type(vault: &Vault, service_type: &mut ServiceType) -> CommandResult<()> {
    require_id("service type", &service_type.id)?;
    service_type.name = require_label("service type name", &service_type.name)?;
    service_type.icon = service_type.icon.trim().to_string();

    let mut ids = HashSet::new();
    let mut keys = HashSet::new();
    for field in &mut service_type.fields {
        if field.id.trim().is_empty() {
            return Err(CommandError::validation("Every field needs an ID."));
        }
        if !ids.insert(field.id.clone()) {
            return Err(CommandError::validation(format!(
                "Field ID '{}' is used more than once.",
                field.id
            )));
        }
        field.label = require_label("field label", &field.label)?;
        if !is_valid_field_key(&field.key) {
            return Err(CommandError::validation(format!(
                "Field key '{}' is invalid: use lowercase letters, digits and '_' only.",
                field.key
            )));
        }
        if !keys.insert(field.key.clone()) {
            return Err(CommandError::validation(format!(
                "Field key '{}' is used more than once.",
                field.key
            )));
        }
        if !FIELD_TYPES.contains(&field.field_type.as_str()) {
            return Err(CommandError::validation(format!(
                "Unknown field type '{}'.",
                field.field_type
            )));
        }
        if field.field_type == "linked_service" {
            let target = field
                .linked_service_type_id
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .ok_or_else(|| {
                    CommandError::validation(format!(
                        "Linked field '{}' must name the service type it links to.",
                        field.label
                    ))
                })?
                .to_string();
            if target != service_type.id && !type_exists(vault, &target) {
                return Err(CommandError::service_type_not_found(&target));
            }
            field.linked_service_type_id = Some(target);
        } else {
            field.linked_service_type_id = None;
        }
        normalize_field(field);
    }
    Ok(())
}

/// Validates and cleans a service before it is stored (label, type, tags, link values).
fn prepare_service(vault: &Vault, service: &mut Service) -> CommandResult<()> {
    require_id("service", &service.id)?;
    service.label = require_label("service name", &service.label)?;
    let service_type = require_type(vault, &service.service_type_id)?;
    service.tags = normalize_tags(&service.tags);
    for field in service_type
        .fields
        .iter()
        .filter(|f| f.field_type == "linked_service")
    {
        if let Some(value) = service.data.get(&field.key) {
            if !value.is_empty()
                && *value != service.id
                && !vault.services.iter().any(|s| &s.id == value)
            {
                return Err(CommandError::service_not_found(value));
            }
        }
    }
    Ok(())
}

fn prepare_account(vault: &Vault, account: &mut Account) -> CommandResult<()> {
    require_id("account", &account.id)?;
    account.label = require_label("account name", &account.label)?;
    account.tags = normalize_tags(&account.tags);
    let existing: HashSet<String> = vault.services.iter().map(|s| s.id.clone()).collect();
    account.linked_services = sanitize_links(&account.linked_services, &existing);
    Ok(())
}

// --- Settings ---

pub fn update_settings(vault: &mut Vault, settings: Settings) -> CommandResult<()> {
    validate_settings(&settings)?;
    vault.settings = settings;
    Ok(())
}

// --- Service types ---

pub fn add_service_type(vault: &mut Vault, mut service_type: ServiceType) -> CommandResult<()> {
    if type_exists(vault, &service_type.id) {
        return Err(CommandError::new(
            ErrorCode::ServiceTypeExists,
            format!("A service type with ID '{}' already exists.", service_type.id),
        ));
    }
    prepare_service_type(vault, &mut service_type)?;
    vault.service_types.push(service_type);
    Ok(())
}

pub fn update_service_type(vault: &mut Vault, mut service_type: ServiceType) -> CommandResult<()> {
    let index = vault
        .service_types
        .iter()
        .position(|t| t.id == service_type.id)
        .ok_or_else(|| CommandError::service_type_not_found(&service_type.id))?;
    prepare_service_type(vault, &mut service_type)?;

    let old_fields = vault.service_types[index].fields.clone();
    let old_by_id: HashMap<&str, &ServiceField> =
        old_fields.iter().map(|f| (f.id.as_str(), f)).collect();
    let old_keys: HashSet<&str> = old_fields.iter().map(|f| f.key.as_str()).collect();
    let new_keys: HashSet<&str> = service_type.fields.iter().map(|f| f.key.as_str()).collect();

    // Field identity is the field id. A field that keeps its id keeps its values (also when its
    // key changes). A new id never inherits values of a field that was removed or renamed in this
    // update, even when it reuses that field's key; it only picks up data under a key that never
    // belonged to any field of this type.
    struct Migration<'a> {
        key: &'a str,
        source: Option<&'a str>,
        /// Set when the field is now `linked_service` but was not linked to this target before:
        /// only ids of existing services of the target type survive.
        link_target: Option<&'a str>,
    }
    let migrations: Vec<Migration> = service_type
        .fields
        .iter()
        .map(|field| {
            let old = old_by_id.get(field.id.as_str()).copied();
            let source = match old {
                Some(old) => Some(old.key.as_str()),
                None if !old_keys.contains(field.key.as_str()) => Some(field.key.as_str()),
                None => None,
            };
            let link_target = (field.field_type == "linked_service")
                .then_some(field.linked_service_type_id.as_deref())
                .flatten()
                .filter(|target| match old {
                    Some(old) => {
                        old.field_type != "linked_service"
                            || old.linked_service_type_id.as_deref() != Some(*target)
                    }
                    None => true,
                });
            Migration { key: field.key.as_str(), source, link_target }
        })
        .collect();

    let services_of_type = |type_id: &str| -> HashSet<String> {
        vault
            .services
            .iter()
            .filter(|s| s.service_type_id == type_id)
            .map(|s| s.id.clone())
            .collect()
    };
    let link_targets: HashMap<&str, HashSet<String>> = migrations
        .iter()
        .filter_map(|m| m.link_target)
        .map(|target| (target, services_of_type(target)))
        .collect();

    for service in vault
        .services
        .iter_mut()
        .filter(|s| s.service_type_id == service_type.id)
    {
        let mut old_data = std::mem::take(&mut service.data);
        let mut new_data: HashMap<String, String> = HashMap::new();
        for migration in &migrations {
            let Some(value) = migration.source.and_then(|key| old_data.get(key)) else {
                continue;
            };
            if let Some(target) = migration.link_target {
                if !link_targets.get(target).is_some_and(|ids| ids.contains(value)) {
                    continue;
                }
            }
            new_data.insert(migration.key.to_string(), value.clone());
        }
        // Data under keys that never belonged to a field of this type is left alone; values of
        // fields that disappeared are removed.
        for (key, value) in old_data.drain() {
            if !old_keys.contains(key.as_str()) && !new_keys.contains(key.as_str()) {
                new_data.insert(key, value);
            }
        }
        service.data = new_data;
    }

    vault.service_types[index] = service_type;
    Ok(())
}

pub fn delete_service_type(vault: &mut Vault, service_type_id: &str, cascade: bool) -> CommandResult<()> {
    require_type(vault, service_type_id)?;
    let dependent: Vec<String> = vault
        .services
        .iter()
        .filter(|s| s.service_type_id == service_type_id)
        .map(|s| s.id.clone())
        .collect();
    if !dependent.is_empty() {
        if !cascade {
            return Err(CommandError::new(
                ErrorCode::ServiceTypeInUse,
                format!(
                    "{} service(s) still use the service type '{service_type_id}'.",
                    dependent.len()
                ),
            ));
        }
        remove_services(vault, &dependent.into_iter().collect());
    }
    vault.service_types.retain(|t| t.id != service_type_id);

    // Linked fields in other types that targeted the deleted type go away with their values.
    for st in &mut vault.service_types {
        let removed_keys: Vec<String> = st
            .fields
            .iter()
            .filter(|f| {
                f.field_type == "linked_service"
                    && f.linked_service_type_id.as_deref() == Some(service_type_id)
            })
            .map(|f| f.key.clone())
            .collect();
        if removed_keys.is_empty() {
            continue;
        }
        st.fields.retain(|f| !removed_keys.contains(&f.key));
        for service in vault.services.iter_mut().filter(|s| s.service_type_id == st.id) {
            for key in &removed_keys {
                service.data.remove(key);
            }
        }
    }
    Ok(())
}

// --- Services ---

pub fn add_service(
    vault: &mut Vault,
    mut service: Service,
    account_id: Option<&str>,
    now: u64,
) -> CommandResult<()> {
    if let Some(account_id) = account_id {
        if !vault.accounts.iter().any(|a| a.id == account_id) {
            return Err(CommandError::account_not_found(account_id));
        }
    }
    if vault.services.iter().any(|s| s.id == service.id) {
        return Err(CommandError::duplicate_id("service", &service.id));
    }
    prepare_service(vault, &mut service)?;
    service.created_at = now;
    service.updated_at = now;
    let service_id = service.id.clone();
    vault.services.push(service);

    if let Some(account_id) = account_id {
        if let Some(account) = vault.accounts.iter_mut().find(|a| a.id == account_id) {
            if !account.linked_services.contains(&service_id) {
                account.linked_services.push(service_id);
                account.updated_at = now;
            }
        }
    }
    Ok(())
}

/// Adds several services; all-or-nothing.
pub fn add_services(vault: &mut Vault, services: Vec<Service>, now: u64) -> CommandResult<()> {
    let mut batch_ids = HashSet::new();
    for service in &services {
        if vault.services.iter().any(|s| s.id == service.id) || !batch_ids.insert(service.id.clone()) {
            return Err(CommandError::duplicate_id("service", &service.id));
        }
    }
    // Validate against the vault including the whole batch, so services may link to each other;
    // roll the batch back on the first error.
    let original_len = vault.services.len();
    vault.services.extend(services);
    for index in original_len..vault.services.len() {
        let mut service = vault.services[index].clone();
        if let Err(e) = prepare_service(vault, &mut service) {
            vault.services.truncate(original_len);
            return Err(e);
        }
        service.created_at = now;
        service.updated_at = now;
        vault.services[index] = service;
    }
    Ok(())
}

pub fn update_service(vault: &mut Vault, mut service: Service, now: u64) -> CommandResult<()> {
    let index = vault
        .services
        .iter()
        .position(|s| s.id == service.id)
        .ok_or_else(|| CommandError::service_not_found(&service.id))?;
    prepare_service(vault, &mut service)?;
    let existing = &vault.services[index];
    service.created_at = existing.created_at;
    service.pinned = existing.pinned;
    service.updated_at = now;
    vault.services[index] = service;
    Ok(())
}

/// Removes services and every reference to them (account links, linked_service values).
fn remove_services(vault: &mut Vault, ids: &HashSet<String>) {
    vault.services.retain(|s| !ids.contains(&s.id));
    for account in &mut vault.accounts {
        account.linked_services.retain(|id| !ids.contains(id));
    }
    let linked_keys = linked_field_keys(&vault.service_types);
    for service in &mut vault.services {
        if let Some(keys) = linked_keys.get(&service.service_type_id) {
            for key in keys {
                if service.data.get(key).is_some_and(|v| ids.contains(v)) {
                    service.data.remove(key);
                }
            }
        }
    }
}

pub fn delete_service(vault: &mut Vault, service_id: &str) -> CommandResult<()> {
    delete_services(vault, &[service_id.to_string()])
}

pub fn delete_services(vault: &mut Vault, service_ids: &[String]) -> CommandResult<()> {
    for id in service_ids {
        if !vault.services.iter().any(|s| &s.id == id) {
            return Err(CommandError::service_not_found(id));
        }
    }
    remove_services(vault, &service_ids.iter().cloned().collect());
    Ok(())
}

// --- Accounts ---

pub fn add_account(vault: &mut Vault, mut account: Account, now: u64) -> CommandResult<()> {
    if vault.accounts.iter().any(|a| a.id == account.id) {
        return Err(CommandError::duplicate_id("account", &account.id));
    }
    prepare_account(vault, &mut account)?;
    account.created_at = now;
    account.updated_at = now;
    vault.accounts.push(account);
    Ok(())
}

pub fn update_account(vault: &mut Vault, mut account: Account, now: u64) -> CommandResult<()> {
    let index = vault
        .accounts
        .iter()
        .position(|a| a.id == account.id)
        .ok_or_else(|| CommandError::account_not_found(&account.id))?;
    prepare_account(vault, &mut account)?;
    let existing = &vault.accounts[index];
    account.created_at = existing.created_at;
    account.pinned = existing.pinned;
    account.updated_at = now;
    vault.accounts[index] = account;
    Ok(())
}

/// Deletes accounts; their services are kept (only the grouping goes away).
pub fn delete_accounts(vault: &mut Vault, account_ids: &[String]) -> CommandResult<()> {
    for id in account_ids {
        if !vault.accounts.iter().any(|a| &a.id == id) {
            return Err(CommandError::account_not_found(id));
        }
    }
    vault.accounts.retain(|a| !account_ids.contains(&a.id));
    Ok(())
}

pub fn delete_account(vault: &mut Vault, account_id: &str) -> CommandResult<()> {
    delete_accounts(vault, &[account_id.to_string()])
}

/// Appends services that are not linked yet, in the given order.
pub fn link_services_to_account(
    vault: &mut Vault,
    account_id: &str,
    service_ids: &[String],
    now: u64,
) -> CommandResult<()> {
    for id in service_ids {
        if !vault.services.iter().any(|s| &s.id == id) {
            return Err(CommandError::service_not_found(id));
        }
    }
    let account = vault
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .ok_or_else(|| CommandError::account_not_found(account_id))?;
    let mut changed = false;
    for id in service_ids {
        if !account.linked_services.contains(id) {
            account.linked_services.push(id.clone());
            changed = true;
        }
    }
    if changed {
        account.updated_at = now;
    }
    Ok(())
}

pub fn unlink_services_from_account(
    vault: &mut Vault,
    account_id: &str,
    service_ids: &[String],
    now: u64,
) -> CommandResult<()> {
    let account = vault
        .accounts
        .iter_mut()
        .find(|a| a.id == account_id)
        .ok_or_else(|| CommandError::account_not_found(account_id))?;
    let before = account.linked_services.len();
    account.linked_services.retain(|id| !service_ids.contains(id));
    if account.linked_services.len() != before {
        account.updated_at = now;
    }
    Ok(())
}

/// Pins or unpins an account or service. Does not touch `updated_at`.
pub fn set_pinned(vault: &mut Vault, kind: &str, id: &str, pinned: bool) -> CommandResult<()> {
    match kind {
        "account" => {
            let account = vault
                .accounts
                .iter_mut()
                .find(|a| a.id == id)
                .ok_or_else(|| CommandError::account_not_found(id))?;
            account.pinned = pinned;
        }
        "service" => {
            let service = vault
                .services
                .iter_mut()
                .find(|s| s.id == id)
                .ok_or_else(|| CommandError::service_not_found(id))?;
            service.pinned = pinned;
        }
        other => {
            return Err(CommandError::validation(format!(
                "Unknown item kind '{other}': expected 'account' or 'service'."
            )))
        }
    }
    Ok(())
}

// --- Bulk creation ---

fn with_placeholder(template: &str) -> String {
    let trimmed = template.trim();
    if trimmed.contains(NUMBER_PLACEHOLDER) {
        trimmed.to_string()
    } else {
        format!("{trimmed} {NUMBER_PLACEHOLDER}")
    }
}

/// Creates `count` accounts numbered `startNumber + index` and optionally links existing
/// services whose label is the service template rendered with the SAME number. All-or-nothing.
pub fn bulk_create_accounts(
    vault: &mut Vault,
    request: &BulkCreateRequest,
    now: u64,
) -> CommandResult<BulkCreateSummary> {
    let config = &request.account_config;
    if config.count == 0 || config.count > MAX_BULK_COUNT {
        return Err(CommandError::validation(format!(
            "The number of accounts must be between 1 and {MAX_BULK_COUNT}."
        )));
    }
    if config.name_template.trim().is_empty() {
        return Err(CommandError::validation("The account name template must not be empty."));
    }
    config
        .start_number
        .checked_add(config.count - 1)
        .ok_or_else(|| CommandError::validation("The start number is too large."))?;
    let account_template = with_placeholder(&config.name_template);

    let service_templates: Vec<(String, String)> = if request.link_services {
        let mut list = Vec::new();
        for sc in &request.service_configs {
            require_type(vault, &sc.service_type_id)?;
            if sc.name_template.trim().is_empty() {
                return Err(CommandError::validation(
                    "A service name template must not be empty.",
                ));
            }
            list.push((sc.service_type_id.clone(), with_placeholder(&sc.name_template)));
        }
        list
    } else {
        Vec::new()
    };

    let tags = normalize_tags(&config.tags);
    let mut summary = BulkCreateSummary::default();
    for index in 0..config.count {
        // Cannot overflow: checked above.
        let number = config.start_number + index;
        let number_text = number.to_string();
        let mut account = Account {
            id: new_id(),
            label: account_template.replace(NUMBER_PLACEHOLDER, &number_text),
            notes: config.notes.clone(),
            tags: tags.clone(),
            linked_services: Vec::new(),
            pinned: false,
            created_at: now,
            updated_at: now,
        };
        for (type_id, template) in &service_templates {
            let wanted = template.replace(NUMBER_PLACEHOLDER, &number_text);
            match vault
                .services
                .iter()
                .find(|s| &s.service_type_id == type_id && s.label == wanted)
            {
                Some(service) => {
                    if !account.linked_services.contains(&service.id) {
                        account.linked_services.push(service.id.clone());
                        summary.linked += 1;
                    }
                }
                None => summary.unmatched += 1,
            }
        }
        vault.accounts.push(account);
        summary.created += 1;
    }
    Ok(summary)
}

// --- Import ---

/// Applies an imported vault. "replace" swaps types/services/accounts but keeps the current
/// settings; "merge" adds new ids, skips existing ones and extends existing types with
/// imported fields whose key is missing. The result is normalised.
pub fn import_vault(vault: &mut Vault, imported: Vault, strategy: &str) -> CommandResult<ImportSummary> {
    let mut summary = ImportSummary::default();
    match strategy {
        "replace" => {
            summary.service_types_added = imported.service_types.len() as u32;
            summary.services_added = imported.services.len() as u32;
            summary.accounts_added = imported.accounts.len() as u32;
            vault.service_types = imported.service_types;
            vault.services = imported.services;
            vault.accounts = imported.accounts;
        }
        "merge" => {
            for imported_type in imported.service_types {
                match vault.service_types.iter_mut().find(|t| t.id == imported_type.id) {
                    None => {
                        vault.service_types.push(imported_type);
                        summary.service_types_added += 1;
                    }
                    Some(current) => {
                        let mut added_any = false;
                        for mut field in imported_type.fields {
                            if current.fields.iter().any(|f| f.key == field.key) {
                                continue;
                            }
                            if current.fields.iter().any(|f| f.id == field.id) {
                                field.id = new_id();
                            }
                            current.fields.push(field);
                            added_any = true;
                        }
                        if added_any {
                            summary.service_types_merged += 1;
                        }
                    }
                }
            }
            for service in imported.services {
                if vault.services.iter().any(|s| s.id == service.id) {
                    summary.services_skipped += 1;
                } else {
                    vault.services.push(service);
                    summary.services_added += 1;
                }
            }
            for account in imported.accounts {
                if vault.accounts.iter().any(|a| a.id == account.id) {
                    summary.accounts_skipped += 1;
                } else {
                    vault.accounts.push(account);
                    summary.accounts_added += 1;
                }
            }
        }
        other => {
            return Err(CommandError::validation(format!(
                "Unknown import strategy '{other}': expected 'merge' or 'replace'."
            )))
        }
    }
    normalize(vault);
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{BulkAccountConfig, ServiceLinkConfig};

    fn field(id: &str, key: &str, ty: &str) -> ServiceField {
        ServiceField {
            id: id.into(),
            key: key.into(),
            label: key.to_uppercase(),
            field_type: ty.into(),
            masked: false,
            required: false,
            linked_service_type_id: None,
        }
    }

    fn linked_field(id: &str, key: &str, target: &str) -> ServiceField {
        ServiceField {
            linked_service_type_id: Some(target.into()),
            ..field(id, key, "linked_service")
        }
    }

    fn stype(id: &str, fields: Vec<ServiceField>) -> ServiceType {
        ServiceType {
            id: id.into(),
            name: id.to_uppercase(),
            icon: "Icon".into(),
            fields,
        }
    }

    fn service(id: &str, type_id: &str, label: &str, data: &[(&str, &str)]) -> Service {
        Service {
            id: id.into(),
            service_type_id: type_id.into(),
            label: label.into(),
            data: data.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            ..Default::default()
        }
    }

    fn account(id: &str, label: &str, links: &[&str]) -> Account {
        Account {
            id: id.into(),
            label: label.into(),
            linked_services: links.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    /// email type, discord type with a linked email field, two emails, one discord, one account.
    fn fixture() -> Vault {
        let mut v = Vault::default();
        v.service_types.push(stype("email", vec![field("e1", "email", "text"), field("e2", "password", "secret")]));
        v.service_types.push(stype(
            "discord",
            vec![field("d1", "username", "text"), linked_field("d2", "email_ref", "email")],
        ));
        v.services.push(service("m1", "email", "Mail 1", &[("email", "a@x.io")]));
        v.services.push(service("m2", "email", "Mail 2", &[("email", "b@x.io")]));
        v.services.push(service("dc1", "discord", "Discord 1", &[("username", "u1"), ("email_ref", "m1")]));
        v.accounts.push(account("acc1", "Persona 1", &["m1", "dc1"]));
        v
    }

    fn ids(list: &[String]) -> Vec<&str> {
        list.iter().map(String::as_str).collect()
    }

    // --- normalisation ---

    #[test]
    fn normalize_repairs_legacy_data() {
        let mut v = fixture();
        v.version = "0.2.0".into();
        v.service_types[0].fields.push(field("e3", "2fa_key", "secret"));
        v.service_types[0].fields.push(field("e4", "totp", "2fa"));
        v.accounts[0].linked_services = vec!["dc1".into(), "gone".into(), "m1".into(), "dc1".into()];
        v.accounts[0].tags = vec![" a ".into(), "".into(), "b".into(), "a".into(), "  ".into()];
        v.services[2].data.insert("email_ref".into(), "deleted".into());
        v.services[0].tags = vec!["x".into(), " x".into()];

        assert!(normalize(&mut v));
        assert_eq!(v.version, VAULT_VERSION);
        let f = &v.service_types[0].fields[2];
        assert_eq!((f.field_type.as_str(), f.masked), ("2fa", true));
        assert!(v.service_types[0].fields[3].masked);
        assert_eq!(ids(&v.accounts[0].linked_services), vec!["dc1", "m1"]);
        assert_eq!(ids(&v.accounts[0].tags), vec!["a", "b"]);
        assert!(!v.services[2].data.contains_key("email_ref"));
        assert_eq!(v.services[2].data["username"], "u1");
        assert_eq!(ids(&v.services[0].tags), vec!["x"]);

        // Idempotent.
        assert!(!normalize(&mut v));
    }

    #[test]
    fn normalize_drops_linked_fields_without_a_target_type() {
        let mut v = fixture();
        // Legacy: the old app deleted types without cleaning up and allowed linked fields
        // without a target.
        let discord = &mut v.service_types[1];
        discord.fields.push(linked_field("d3", "wallet_ref", "deleted-type"));
        discord.fields.push(field("d4", "no_target", "linked_service"));
        discord.fields.push(linked_field("d5", "empty_target", "  "));
        discord.fields.push(linked_field("d6", "self_ref", " discord "));
        v.services[2].data.insert("wallet_ref".into(), "w1".into());
        v.services[2].data.insert("no_target".into(), "".into());
        v.services[2].data.insert("empty_target".into(), "x".into());
        v.services[2].data.insert("self_ref".into(), "dc1".into());

        assert!(normalize(&mut v));
        let keys: Vec<&str> = v.service_types[1].fields.iter().map(|f| f.key.as_str()).collect();
        assert_eq!(keys, vec!["username", "email_ref", "self_ref"]);
        assert_eq!(v.service_types[1].fields[2].linked_service_type_id.as_deref(), Some("discord"));
        let dc1 = &v.services[2].data;
        assert!(!dc1.contains_key("wallet_ref"));
        assert!(!dc1.contains_key("no_target"));
        assert!(!dc1.contains_key("empty_target"));
        assert_eq!(dc1["email_ref"], "m1");
        assert_eq!(dc1["self_ref"], "dc1");
        assert!(!normalize(&mut v));
    }

    #[test]
    fn normalize_adds_imap_fields_to_a_legacy_email_type() {
        let mut v = fixture();
        // A user field already uses the id the default definition would take.
        v.service_types[0].fields.push(field("g-8", "notes", "textarea"));
        v.services[0].data.insert("imap_host".into(), "imap.x.io".into());
        assert!(normalize(&mut v));

        let email = &v.service_types[0];
        let keys: Vec<&str> = email.fields.iter().map(|f| f.key.as_str()).collect();
        assert_eq!(keys, vec!["email", "password", "notes", "imap_host", "imap_port"]);
        let host = &email.fields[3];
        assert_ne!(host.id, "g-8");
        assert_eq!((host.label.as_str(), host.field_type.as_str(), host.required), ("IMAP Host", "text", false));
        assert_eq!(email.fields[4].id, "g-9");
        let ids: HashSet<&str> = email.fields.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids.len(), email.fields.len());
        // Existing data under the key shows up in the new field.
        assert_eq!(v.services[0].data["imap_host"], "imap.x.io");
        // Idempotent.
        assert!(!normalize(&mut v));

        // Only one of the two is missing: only that one is added.
        let mut v = fixture();
        v.service_types[0].fields.push(field("e5", "imap_port", "text"));
        normalize(&mut v);
        let keys: Vec<&str> = v.service_types[0].fields.iter().map(|f| f.key.as_str()).collect();
        assert_eq!(keys, vec!["email", "password", "imap_port", "imap_host"]);

        // A type with id "email" that is not the built-in Email type is left alone.
        let mut v = fixture();
        v.service_types[0].fields.retain(|f| f.key != "password");
        normalize(&mut v);
        assert_eq!(v.service_types[0].fields.len(), 1);
    }

    #[test]
    fn normalize_rekeys_duplicate_and_empty_ids() {
        let mut v = fixture();
        v.services.push(service("m1", "email", "Dup", &[]));
        v.accounts.push(account("", "Empty", &[]));
        assert!(normalize(&mut v));
        assert!(check_integrity(&v).is_ok());
        assert_eq!(v.services[0].id, "m1");
        assert_ne!(v.services[3].id, "m1");
        assert!(!v.accounts[1].id.is_empty());
    }

    #[test]
    fn check_integrity_rejects_duplicates() {
        let mut v = fixture();
        v.accounts.push(account("acc1", "Again", &[]));
        assert_eq!(check_integrity(&v).unwrap_err().code, ErrorCode::DuplicateId);
    }

    // --- services ---

    #[test]
    fn add_service_validates_before_mutating() {
        let mut v = fixture();
        let before = v.clone();
        let err = add_service(&mut v, service("n1", "email", "New", &[]), Some("nope"), 5).unwrap_err();
        assert_eq!(err.code, ErrorCode::AccountNotFound);
        assert_eq!(v, before);

        assert_eq!(
            add_service(&mut v, service("m1", "email", "Dup", &[]), None, 5).unwrap_err().code,
            ErrorCode::DuplicateId
        );
        assert_eq!(
            add_service(&mut v, service("n1", "nope", "X", &[]), None, 5).unwrap_err().code,
            ErrorCode::ServiceTypeNotFound
        );
        assert_eq!(
            add_service(&mut v, service("n1", "email", "   ", &[]), None, 5).unwrap_err().code,
            ErrorCode::Validation
        );
        assert_eq!(
            add_service(&mut v, service("", "email", "X", &[]), None, 5).unwrap_err().code,
            ErrorCode::Validation
        );
        assert_eq!(
            add_service(&mut v, service("n1", "discord", "D", &[("email_ref", "ghost")]), None, 5)
                .unwrap_err()
                .code,
            ErrorCode::ServiceNotFound
        );
        assert_eq!(v, before);
    }

    #[test]
    fn add_service_sets_timestamps_and_links_in_order() {
        let mut v = fixture();
        let mut s = service("n1", "email", "  New  ", &[]);
        s.created_at = 1;
        s.updated_at = 2;
        s.tags = vec!["t".into(), "t".into()];
        add_service(&mut v, s, Some("acc1"), 99).unwrap();
        let added = v.services.iter().find(|s| s.id == "n1").unwrap();
        assert_eq!((added.created_at, added.updated_at), (99, 99));
        assert_eq!(added.label, "New");
        assert_eq!(ids(&added.tags), vec!["t"]);
        assert_eq!(ids(&v.accounts[0].linked_services), vec!["m1", "dc1", "n1"]);
        assert_eq!(v.accounts[0].updated_at, 99);
    }

    #[test]
    fn add_services_is_all_or_nothing() {
        let mut v = fixture();
        let before = v.clone();
        let batch = vec![service("n1", "email", "A", &[]), service("n2", "nope", "B", &[])];
        assert_eq!(add_services(&mut v, batch, 1).unwrap_err().code, ErrorCode::ServiceTypeNotFound);
        assert_eq!(v, before);
        let batch = vec![service("n1", "email", "A", &[]), service("n1", "email", "B", &[])];
        assert_eq!(add_services(&mut v, batch, 1).unwrap_err().code, ErrorCode::DuplicateId);
        assert_eq!(v, before);
        let batch = vec![
            service("n1", "email", "A", &[]),
            service("n2", "discord", "B", &[("email_ref", "n1")]),
        ];
        add_services(&mut v, batch, 7).unwrap();
        assert_eq!(v.services.len(), 5);
    }

    #[test]
    fn update_service_preserves_created_at_and_pin() {
        let mut v = fixture();
        v.services[0].created_at = 10;
        v.services[0].pinned = true;
        let mut s = v.services[0].clone();
        s.label = "Renamed".into();
        s.created_at = 0;
        s.pinned = false;
        update_service(&mut v, s, 50).unwrap();
        assert_eq!(v.services[0].label, "Renamed");
        assert_eq!((v.services[0].created_at, v.services[0].updated_at), (10, 50));
        assert!(v.services[0].pinned);
        assert_eq!(
            update_service(&mut v, service("zz", "email", "X", &[]), 1).unwrap_err().code,
            ErrorCode::ServiceNotFound
        );
    }

    #[test]
    fn delete_service_cascades_to_links_and_linked_fields() {
        let mut v = fixture();
        v.accounts.push(account("acc2", "Persona 2", &["m1", "m2"]));
        delete_service(&mut v, "m1").unwrap();
        assert!(v.services.iter().all(|s| s.id != "m1"));
        assert_eq!(ids(&v.accounts[0].linked_services), vec!["dc1"]);
        assert_eq!(ids(&v.accounts[1].linked_services), vec!["m2"]);
        let dc = v.services.iter().find(|s| s.id == "dc1").unwrap();
        assert!(!dc.data.contains_key("email_ref"));
        assert_eq!(dc.data["username"], "u1");
        assert_eq!(delete_service(&mut v, "m1").unwrap_err().code, ErrorCode::ServiceNotFound);
    }

    #[test]
    fn delete_services_requires_existing_ids() {
        let mut v = fixture();
        let before = v.clone();
        let err = delete_services(&mut v, &["m1".into(), "ghost".into()]).unwrap_err();
        assert_eq!(err.code, ErrorCode::ServiceNotFound);
        assert_eq!(v, before);
        delete_services(&mut v, &["m1".into(), "dc1".into()]).unwrap();
        assert!(v.accounts[0].linked_services.is_empty());
        assert_eq!(v.services.len(), 1);
    }

    // --- accounts ---

    #[test]
    fn add_and_update_account_sanitize_links() {
        let mut v = fixture();
        let mut a = account("acc2", " Two ", &["dc1", "ghost", "m2", "dc1"]);
        a.created_at = 5;
        add_account(&mut v, a, 20).unwrap();
        let added = &v.accounts[1];
        assert_eq!(added.label, "Two");
        assert_eq!(ids(&added.linked_services), vec!["dc1", "m2"]);
        assert_eq!(added.created_at, 20);

        let mut upd = v.accounts[1].clone();
        upd.linked_services = vec!["m2".into(), "deleted-earlier".into(), "m1".into()];
        upd.notes = "notes".into();
        upd.created_at = 0;
        update_account(&mut v, upd, 30).unwrap();
        assert_eq!(ids(&v.accounts[1].linked_services), vec!["m2", "m1"]);
        assert_eq!((v.accounts[1].created_at, v.accounts[1].updated_at), (20, 30));

        assert_eq!(add_account(&mut v, account("acc1", "X", &[]), 1).unwrap_err().code, ErrorCode::DuplicateId);
        assert_eq!(add_account(&mut v, account("acc9", "", &[]), 1).unwrap_err().code, ErrorCode::Validation);
        assert_eq!(
            update_account(&mut v, account("nope", "X", &[]), 1).unwrap_err().code,
            ErrorCode::AccountNotFound
        );
    }

    #[test]
    fn delete_accounts_keeps_services() {
        let mut v = fixture();
        v.accounts.push(account("acc2", "Two", &["m2"]));
        let before = v.clone();
        assert_eq!(
            delete_accounts(&mut v, &["acc1".into(), "ghost".into()]).unwrap_err().code,
            ErrorCode::AccountNotFound
        );
        assert_eq!(v, before);
        delete_accounts(&mut v, &["acc1".into(), "acc2".into()]).unwrap();
        assert!(v.accounts.is_empty());
        assert_eq!(v.services.len(), 3);
        assert_eq!(delete_account(&mut v, "acc1").unwrap_err().code, ErrorCode::AccountNotFound);
    }

    #[test]
    fn link_preserves_order_and_rejects_unknown() {
        let mut v = fixture();
        v.services.push(service("m3", "email", "Mail 3", &[]));
        link_services_to_account(&mut v, "acc1", &["m3".into(), "m2".into(), "m1".into(), "m3".into()], 9).unwrap();
        assert_eq!(ids(&v.accounts[0].linked_services), vec!["m1", "dc1", "m3", "m2"]);
        assert_eq!(v.accounts[0].updated_at, 9);

        let before = v.clone();
        assert_eq!(
            link_services_to_account(&mut v, "acc1", &["m1".into(), "ghost".into()], 1).unwrap_err().code,
            ErrorCode::ServiceNotFound
        );
        assert_eq!(
            link_services_to_account(&mut v, "ghost", &["m1".into()], 1).unwrap_err().code,
            ErrorCode::AccountNotFound
        );
        assert_eq!(v, before);

        unlink_services_from_account(&mut v, "acc1", &["dc1".into(), "m2".into()], 11).unwrap();
        assert_eq!(ids(&v.accounts[0].linked_services), vec!["m1", "m3"]);
        assert_eq!(v.services.len(), 4);
    }

    #[test]
    fn set_pinned_kinds() {
        let mut v = fixture();
        set_pinned(&mut v, "account", "acc1", true).unwrap();
        set_pinned(&mut v, "service", "m2", true).unwrap();
        assert!(v.accounts[0].pinned && v.services[1].pinned);
        assert_eq!(v.accounts[0].updated_at, 0);
        assert_eq!(set_pinned(&mut v, "folder", "x", true).unwrap_err().code, ErrorCode::Validation);
        assert_eq!(set_pinned(&mut v, "service", "x", true).unwrap_err().code, ErrorCode::ServiceNotFound);
        assert_eq!(set_pinned(&mut v, "account", "x", true).unwrap_err().code, ErrorCode::AccountNotFound);
    }

    // --- service types ---

    #[test]
    fn add_service_type_validation() {
        let mut v = fixture();
        let before = v.clone();
        let cases = vec![
            (stype("email", vec![]), ErrorCode::ServiceTypeExists),
            (stype("", vec![]), ErrorCode::Validation),
            (stype("t", vec![field("f1", "", "text")]), ErrorCode::Validation),
            (stype("t", vec![field("f1", "Bad Key", "text")]), ErrorCode::Validation),
            (stype("t", vec![field("f1", "ключ", "text")]), ErrorCode::Validation),
            (stype("t", vec![field("f1", "a", "text"), field("f2", "a", "text")]), ErrorCode::Validation),
            (stype("t", vec![field("f1", "a", "text"), field("f1", "b", "text")]), ErrorCode::Validation),
            (stype("t", vec![field("f1", "a", "weird")]), ErrorCode::Validation),
            (stype("t", vec![linked_field("f1", "a", "nope")]), ErrorCode::ServiceTypeNotFound),
            (stype("t", vec![field("f1", "a", "linked_service")]), ErrorCode::Validation),
        ];
        for (st, code) in cases {
            assert_eq!(add_service_type(&mut v, st.clone()).unwrap_err().code, code, "{st:?}");
        }
        let mut nameless = stype("t", vec![]);
        nameless.name = "  ".into();
        assert_eq!(add_service_type(&mut v, nameless).unwrap_err().code, ErrorCode::Validation);
        assert_eq!(v, before);

        let mut ok = stype("t", vec![linked_field("f1", "self_ref", "t"), field("f2", "otp", "2fa")]);
        ok.fields[1].masked = false;
        add_service_type(&mut v, ok).unwrap();
        assert!(v.service_types[2].fields[1].masked);
    }

    #[test]
    fn update_service_type_migrates_keys_and_drops_removed_fields() {
        let mut v = fixture();
        v.services[0].data.insert("password".into(), "pw1".into());
        v.services[0].data.insert("legacy_extra".into(), "keep".into());
        // Rename email -> address (same id e1), drop password (e2), add a new field.
        let st = stype("email", vec![field("e1", "address", "text"), field("e9", "phone", "text")]);
        update_service_type(&mut v, st).unwrap();
        let m1 = &v.services[0];
        assert_eq!(m1.data.get("address").map(String::as_str), Some("a@x.io"));
        assert!(!m1.data.contains_key("email"));
        assert!(!m1.data.contains_key("password"));
        assert_eq!(m1.data.get("legacy_extra").map(String::as_str), Some("keep"));
        assert_eq!(v.services[1].data.get("address").map(String::as_str), Some("b@x.io"));
        // Services of other types are untouched.
        assert_eq!(v.services[2].data["username"], "u1");

        assert_eq!(
            update_service_type(&mut v, stype("nope", vec![])).unwrap_err().code,
            ErrorCode::ServiceTypeNotFound
        );
    }

    #[test]
    fn update_service_type_handles_key_swap() {
        let mut v = fixture();
        v.services[0].data.insert("password".into(), "secret".into());
        let st = stype("email", vec![field("e1", "password", "text"), field("e2", "email", "secret")]);
        update_service_type(&mut v, st).unwrap();
        assert_eq!(v.services[0].data["password"], "a@x.io");
        assert_eq!(v.services[0].data["email"], "secret");
    }

    fn discord_type(fields: Vec<ServiceField>) -> ServiceType {
        stype("discord", fields)
    }

    #[test]
    fn update_service_type_text_to_linked_keeps_only_valid_links() {
        let mut v = fixture();
        v.service_types[1].fields.push(field("d3", "backup", "text"));
        v.services[2].data.insert("backup".into(), "a@x.io".into());
        v.services.push(service("dc2", "discord", "Discord 2", &[("backup", "m2")]));
        // An id of an existing service of the wrong type is not a valid link either.
        v.services.push(service("dc3", "discord", "Discord 3", &[("backup", "dc1")]));

        let st = discord_type(vec![
            field("d1", "username", "text"),
            linked_field("d2", "email_ref", "email"),
            linked_field("d3", "backup", "email"),
        ]);
        update_service_type(&mut v, st).unwrap();
        let data = |id: &str| v.services.iter().find(|s| s.id == id).unwrap().data.clone();
        assert!(!data("dc1").contains_key("backup"));
        assert_eq!(data("dc1")["email_ref"], "m1");
        assert_eq!(data("dc2")["backup"], "m2");
        assert!(!data("dc3").contains_key("backup"));
        // The result satisfies the link invariant, so normalisation has nothing left to remove.
        let mut normalized = v.clone();
        normalize(&mut normalized);
        assert_eq!(normalized.services, v.services);
    }

    #[test]
    fn update_service_type_link_target_change_drops_links_of_the_old_type() {
        let mut v = fixture();
        v.service_types.push(stype("wallet", vec![field("w1", "address", "text")]));
        v.services.push(service("wl1", "wallet", "Wallet 1", &[]));
        v.services.push(service("dc2", "discord", "Discord 2", &[("email_ref", "wl1")]));

        let st = discord_type(vec![field("d1", "username", "text"), linked_field("d2", "email_ref", "wallet")]);
        update_service_type(&mut v, st).unwrap();
        let data = |id: &str| v.services.iter().find(|s| s.id == id).unwrap().data.clone();
        assert!(!data("dc1").contains_key("email_ref"));
        assert_eq!(data("dc2")["email_ref"], "wl1");
    }

    #[test]
    fn update_service_type_keeps_values_of_unchanged_and_unlinked_fields() {
        let mut v = fixture();
        // Unchanged linked field (also renamed): kept.
        let st = discord_type(vec![field("d1", "username", "text"), linked_field("d2", "mail", "email")]);
        update_service_type(&mut v, st).unwrap();
        assert_eq!(v.services[2].data["mail"], "m1");
        // linked -> text: the stored id stays as text.
        let st = discord_type(vec![field("d1", "username", "text"), field("d2", "mail", "text")]);
        update_service_type(&mut v, st).unwrap();
        assert_eq!(v.services[2].data["mail"], "m1");
    }

    #[test]
    fn update_service_type_new_field_never_inherits_removed_values() {
        let mut v = fixture();
        v.services[0].data.insert("password".into(), "secret".into());
        v.services[0].data.insert("legacy_extra".into(), "orphan".into());
        // Remove e2 "password", add a new field with the same key, and adopt orphan data.
        let st = stype(
            "email",
            vec![
                field("e1", "email", "text"),
                field("e7", "password", "text"),
                field("e8", "legacy_extra", "text"),
            ],
        );
        update_service_type(&mut v, st).unwrap();
        assert!(!v.services[0].data.contains_key("password"));
        assert_eq!(v.services[0].data["legacy_extra"], "orphan");
        assert_eq!(v.services[0].data["email"], "a@x.io");

        // Rename e1 email -> address and add a new field "email": the value is only under the
        // new key of e1.
        let st = stype(
            "email",
            vec![field("e1", "address", "text"), field("e9", "email", "text")],
        );
        update_service_type(&mut v, st).unwrap();
        assert_eq!(v.services[0].data["address"], "a@x.io");
        assert!(!v.services[0].data.contains_key("email"));
        assert!(!v.services[0].data.contains_key("password"));
    }

    #[test]
    fn update_service_type_new_linked_field_validates_orphan_data() {
        let mut v = fixture();
        v.services[2].data.insert("other_ref".into(), "not-an-id".into());
        v.services.push(service("dc2", "discord", "Discord 2", &[("other_ref", "m2")]));
        let st = discord_type(vec![
            field("d1", "username", "text"),
            linked_field("d2", "email_ref", "email"),
            linked_field("d9", "other_ref", "email"),
        ]);
        update_service_type(&mut v, st).unwrap();
        assert!(!v.services[2].data.contains_key("other_ref"));
        assert_eq!(v.services[3].data["other_ref"], "m2");
    }

    #[test]
    fn delete_service_type_in_use_and_cascade() {
        let mut v = fixture();
        let before = v.clone();
        let err = delete_service_type(&mut v, "email", false).unwrap_err();
        assert_eq!(err.code, ErrorCode::ServiceTypeInUse);
        assert!(err.message.contains('2'));
        assert_eq!(v, before);
        assert_eq!(
            delete_service_type(&mut v, "ghost", true).unwrap_err().code,
            ErrorCode::ServiceTypeNotFound
        );

        delete_service_type(&mut v, "email", true).unwrap();
        assert!(v.service_types.iter().all(|t| t.id != "email"));
        assert!(v.services.iter().all(|s| s.service_type_id != "email"));
        assert_eq!(ids(&v.accounts[0].linked_services), vec!["dc1"]);
        // The linked field in "discord" that targeted "email" is gone with its values.
        let discord = v.service_types.iter().find(|t| t.id == "discord").unwrap();
        assert_eq!(discord.fields.len(), 1);
        assert!(!v.services[0].data.contains_key("email_ref"));
    }

    #[test]
    fn delete_unused_service_type_removes_linked_fields_elsewhere() {
        let mut v = fixture();
        v.service_types.push(stype("wallet", vec![field("w1", "address", "text")]));
        v.service_types[1].fields.push(linked_field("d3", "wallet_ref", "wallet"));
        v.services[2].data.insert("wallet_ref".into(), "".into());
        delete_service_type(&mut v, "wallet", false).unwrap();
        assert!(v.service_types[1].fields.iter().all(|f| f.key != "wallet_ref"));
        assert!(!v.services[2].data.contains_key("wallet_ref"));
    }

    // --- settings ---

    #[test]
    fn settings_validation() {
        let mut v = fixture();
        update_settings(&mut v, Settings { auto_lock_minutes: 5, clipboard_clear_seconds: 0 }).unwrap();
        assert_eq!(v.settings.auto_lock_minutes, 5);
        assert_eq!(
            update_settings(&mut v, Settings { auto_lock_minutes: 100_000, clipboard_clear_seconds: 0 })
                .unwrap_err()
                .code,
            ErrorCode::Validation
        );
    }

    // --- bulk creation ---

    fn bulk(count: u32, template: &str, start: u32, services: &[(&str, &str)]) -> BulkCreateRequest {
        BulkCreateRequest {
            account_config: BulkAccountConfig {
                count,
                name_template: template.into(),
                start_number: start,
                tags: vec!["bulk".into(), " bulk ".into()],
                notes: "n".into(),
            },
            link_services: !services.is_empty(),
            service_configs: services
                .iter()
                .map(|(t, n)| ServiceLinkConfig { service_type_id: t.to_string(), name_template: n.to_string() })
                .collect(),
        }
    }

    #[test]
    fn bulk_create_uses_the_real_number_for_templates_with_digits() {
        let mut v = fixture();
        for n in 5..=7 {
            v.services.push(service(&format!("tw{n}"), "email", &format!("Tw{n}"), &[]));
        }
        let req = bulk(3, "Farm2024-%n%", 5, &[("email", "Tw%n%")]);
        let summary = bulk_create_accounts(&mut v, &req, 77).unwrap();
        assert_eq!(summary, BulkCreateSummary { created: 3, linked: 3, unmatched: 0 });
        let created: Vec<&Account> = v.accounts.iter().skip(1).collect();
        assert_eq!(created.iter().map(|a| a.label.as_str()).collect::<Vec<_>>(), vec!["Farm2024-5", "Farm2024-6", "Farm2024-7"]);
        for (account, n) in created.iter().zip(5..) {
            assert_eq!(ids(&account.linked_services), vec![format!("tw{n}").as_str()]);
            assert_eq!(ids(&account.tags), vec!["bulk"]);
            assert_eq!(account.created_at, 77);
        }
    }

    #[test]
    fn bulk_create_appends_placeholder_and_counts_unmatched() {
        let mut v = fixture();
        v.services.push(service("x1", "email", "Mail 1", &[]));
        // "Mail" -> "Mail %n%": "Mail 1" exists twice (m1 first), "Mail 2" once, "Mail 3" none.
        let req = bulk(3, "W1_", 1, &[("email", "Mail")]);
        let summary = bulk_create_accounts(&mut v, &req, 1).unwrap();
        assert_eq!(summary, BulkCreateSummary { created: 3, linked: 2, unmatched: 1 });
        assert_eq!(v.accounts[1].label, "W1_ 1");
        assert_eq!(ids(&v.accounts[1].linked_services), vec!["m1"]);
        assert_eq!(ids(&v.accounts[2].linked_services), vec!["m2"]);
        assert!(v.accounts[3].linked_services.is_empty());
    }

    #[test]
    fn bulk_create_validation_is_all_or_nothing() {
        let mut v = fixture();
        let before = v.clone();
        for req in [
            bulk(0, "A%n%", 1, &[]),
            bulk(1001, "A%n%", 1, &[]),
            bulk(2, "A%n%", u32::MAX, &[]),
            bulk(2, "   ", 1, &[]),
            bulk(2, "A%n%", 1, &[("ghost", "X%n%")]),
        ] {
            assert!(bulk_create_accounts(&mut v, &req, 1).is_err());
        }
        assert_eq!(v, before);
        // The last valid number is accepted.
        bulk_create_accounts(&mut v, &bulk(1, "A%n%", u32::MAX, &[]), 1).unwrap();
        assert_eq!(v.accounts[1].label, format!("A{}", u32::MAX));
    }

    // --- import ---

    #[test]
    fn merge_import_adds_new_skips_existing_and_merges_fields() {
        let mut v = fixture();
        v.settings.auto_lock_minutes = 5;
        let mut imported = fixture();
        imported.settings.auto_lock_minutes = 0;
        // Existing type gains a field with a new key (its id collides with an existing one).
        imported.service_types[0].fields.push(field("e1", "phone", "text"));
        imported.service_types.push(stype("proxy", vec![field("p1", "proxy", "secret")]));
        imported.services[0].label = "Changed elsewhere".into();
        imported.services.push(service("px1", "proxy", "Proxy 1", &[]));
        imported.accounts[0].label = "Changed".into();
        imported.accounts.push(account("acc2", "Imported", &["px1", "m1", "missing"]));

        let summary = import_vault(&mut v, imported, "merge").unwrap();
        assert_eq!(
            summary,
            ImportSummary {
                service_types_added: 1,
                service_types_merged: 1,
                services_added: 1,
                services_skipped: 3,
                accounts_added: 1,
                accounts_skipped: 1,
            }
        );
        assert_eq!(v.settings.auto_lock_minutes, 5);
        assert_eq!(v.services[0].label, "Mail 1");
        assert_eq!(v.accounts[0].label, "Persona 1");
        let email = &v.service_types[0];
        let phone = email.fields.iter().find(|f| f.key == "phone").unwrap();
        assert_ne!(phone.id, "e1");
        // email, password, phone + the IMAP fields normalisation adds to the Email type.
        let keys: Vec<&str> = email.fields.iter().map(|f| f.key.as_str()).collect();
        assert_eq!(keys, vec!["email", "password", "phone", "imap_host", "imap_port"]);
        // Imported account links were sanitised by normalisation.
        assert_eq!(ids(&v.accounts[1].linked_services), vec!["px1", "m1"]);
        assert!(check_integrity(&v).is_ok());
    }

    #[test]
    fn replace_import_keeps_current_settings() {
        let mut v = fixture();
        v.settings.auto_lock_minutes = 5;
        let mut imported = Vault::default();
        imported.settings.auto_lock_minutes = 0;
        imported.service_types.push(stype("x", vec![field("k1", "2fa_key", "secret")]));
        imported.services.push(service("s1", "x", "S", &[]));
        let summary = import_vault(&mut v, imported, "replace").unwrap();
        assert_eq!(summary.service_types_added, 1);
        assert_eq!(summary.services_added, 1);
        assert_eq!(summary.accounts_added, 0);
        assert_eq!(v.settings.auto_lock_minutes, 5);
        assert_eq!(v.services.len(), 1);
        assert_eq!(v.service_types[0].fields[0].field_type, "2fa");

        assert_eq!(
            import_vault(&mut v, Vault::default(), "overwrite").unwrap_err().code,
            ErrorCode::Validation
        );
    }

    #[test]
    fn new_vault_uses_selected_defaults() {
        let v = new_vault(Settings::default(), &["email".into(), "ghost".into()]).unwrap();
        assert_eq!(v.service_types.len(), 1);
        assert_eq!(v.version, VAULT_VERSION);
    }
}
