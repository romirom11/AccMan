---
layout: default
title: Developer Guide
---

# Developer Guide

This guide is for developers who want to contribute to AccMan or understand its architecture.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Technologies Used](#technologies-used)
- [Building and Running](#building-and-running)
- [Testing and Linting](#testing-and-linting)
- [Contributing](#contributing)
- [Backend API](#backend-api)
- [Vault File Format and Storage](#vault-file-format-and-storage)

## Architecture Overview

AccMan is a Tauri v2 application:

- **Frontend**: React 19 + TypeScript, Zustand store, Tailwind CSS + shadcn/ui, i18next (English and Ukrainian).
- **Backend**: Rust. It owns the vault file, all cryptography, backups, the clipboard and the IMAP client.
- **IPC**: Tauri commands. Every command that changes the vault returns the complete updated `Vault`, and the frontend replaces its copy with it.

### Key Design Principles

1. **Security first**: the vault is encrypted at rest; the master password is not kept after key derivation; a strict Content Security Policy is set for the webview, and a navigation guard keeps the window on the app.
2. **Transactional changes**: every mutation is applied to a copy of the vault, validated, encrypted and written to disk, and only then replaces the in-memory vault. On any error nothing changes.
3. **Testable core**: vault logic (`vault_ops.rs`) and file/crypto logic (`storage.rs`, `crypto.rs`) are plain Rust functions without Tauri types. Frontend logic that does not need React lives in `src/lib` and is unit-tested with `node:test`.
4. **Local only**: no cloud services. The only network access is the optional IMAP inbox and the updater.

## Development Setup

### Prerequisites

- **Node.js** 20 or later to build; the frontend tests run TypeScript files directly with `node --test`, which needs Node 24 or later (built-in type stripping and test file globs)
- **pnpm**
- **Rust** (latest stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS

### Installation

```bash
git clone https://github.com/romirom11/AccMan.git
cd AccMan
pnpm install            # Tauri CLI
pnpm --dir src install  # frontend dependencies
```

### Development Environment

```bash
pnpm tauri dev
```

This starts the Vite dev server and the Tauri application.

## Project Structure

```
AccMan/
├── src/                       # Frontend (React)
│   ├── api/vault.ts           # One function per Tauri command; error handling (callApi)
│   ├── stores/vault-store.ts  # Zustand store: app status, vault, actions
│   ├── pages/                 # Routes (dashboard, accounts, services, settings, lock screen, ...)
│   ├── components/            # Feature components (field rows, command palette, dialogs, ...)
│   │   └── ui/                # shadcn/ui components (vendored)
│   ├── hooks/                 # useAutoLock, useHotkey, useTotp, useUpdater, ...
│   ├── lib/                   # Pure helpers: totp, password, clipboard, errors, search, vault health, import parser, ...
│   ├── types/index.ts         # TypeScript mirror of the Rust models and error codes
│   ├── tests/                 # node:test unit tests for src/lib
│   ├── locales/{en,uk}/       # Translations
│   ├── eslint.config.js       # ESLint 9 flat config
│   └── app.tsx, main.tsx      # Router, layout, startup
├── src-tauri/                 # Backend (Rust)
│   ├── src/
│   │   ├── lib.rs             # App setup, plugins, command registration
│   │   ├── commands.rs        # Thin Tauri command layer (vault)
│   │   ├── vault_ops.rs       # Pure vault operations, validation, normalisation, import merge
│   │   ├── session.rs         # Session state (vault + derived key), transactional mutation helper
│   │   ├── storage.rs         # Atomic file writes, vault read/write, backups
│   │   ├── crypto.rs          # Vault envelope (v1 legacy / v2), scrypt key derivation, AES-256-GCM
│   │   ├── clipboard.rs       # clipboard_copy / clipboard_clear with conditional auto-clear
│   │   ├── error.rs           # CommandError { code, message }
│   │   ├── models.rs          # Vault, ServiceType, Service, Account, Settings
│   │   ├── defaults.rs        # Built-in service types
│   │   ├── email_commands.rs  # Email Tauri commands
│   │   ├── email_client.rs    # IMAP client and verification code extraction
│   │   ├── email_providers.rs # Provider table and IMAP server resolution
│   │   └── email_models.rs    # Email data types
│   ├── capabilities/          # Tauri permissions
│   └── tauri.conf.json        # App config (CSP, updater, bundle)
├── docs/                      # Documentation (GitHub Pages)
└── .github/workflows/         # Release workflow
```

## Technologies Used

### Frontend

- **React 19**, **TypeScript**, **Vite**
- **Tailwind CSS** and **shadcn/ui** (Radix) components, **Lucide** icons
- **React Router**, **Zustand**
- **i18next** with language detection (English, Ukrainian)
- **fuse.js** (command palette search), **cmdk**, **otpauth** (TOTP), **sonner** (toasts)

### Backend

- **Tauri 2** with the dialog, updater, process, log, clipboard-manager and single-instance plugins
- **ring** (AES-256-GCM), **scrypt** (key derivation), **zeroize**
- **serde** / **serde_json**, **base64**, **uuid**, **thiserror**
- **imap**, **native-tls**, **mail-parser**, **regex** (email inbox)

## Building and Running

```bash
# Development with hot reload
pnpm tauri dev

# Production build (builds the frontend into src/dist first)
pnpm tauri build
```

Bundles are written to `src-tauri/target/release/bundle/`.

## Testing and Linting

### Backend

```bash
cd src-tauri
cargo test
```

The Rust tests cover the crypto envelope (v1 and v2, malformed input), atomic writes and backups, vault operations (validation, linking, deletion semantics, service type field changes, import merge/replace, bulk creation), the email provider table and verification code extraction. Debug builds compile `scrypt` with optimisations so the tests stay fast.

### Frontend

```bash
cd src
pnpm test                  # node --test "tests/*.test.ts"
pnpm exec tsc --noEmit     # type check
pnpm lint                  # ESLint 9 (flat config in src/eslint.config.js)
```

Frontend tests live in `src/tests/*.test.ts` and test the pure modules in `src/lib`. They run directly in Node: use `node:test` and `node:assert/strict`, import modules by relative path with the `.ts` extension, and keep the tested modules free of runtime `@/` imports (`import type` is fine).

## Contributing

### Code Style

- **Frontend**: functional components with hooks, strict TypeScript, every user-visible string through i18n in both `en` and `uk`.
- **Backend**: `cargo fmt` and `cargo clippy`; errors are `CommandError` values with a code.
- **Commits**: conventional commit messages.

### Frontend Conventions

- **API and errors**: call the backend only through `vaultApi` (`src/api/vault.ts`). Every rejection becomes an `ApiError` with a `code`; `callApi` shows one localised error toast (`errors.<CODE>`) unless called with `{ silent: true }`. Use `isApiError(e, 'INVALID_PASSWORD')` to show errors inline.
- **Toasts**: store actions show the success toast, the API layer shows the error toast. Pages must not toast again for store actions, but should `try/catch` to keep their own state right (keep a dialog open on failure, guard against double submit).
- **Shared building blocks**: `FieldValueRow` (masking, copy, live TOTP), `copyText` (`src/lib/clipboard.ts`), `PasswordGenerator`/`PasswordStrengthHint`, `generateFieldKey`, `service-helpers` (secret detection, search that never matches secret values).

### Backend Conventions

- Heavy commands (key derivation, email) run off the main thread (`async` + `spawn_blocking`).
- New model fields need `#[serde(default)]` so existing vault files keep loading.
- Lock poisoning never panics; malformed input never panics.

## Backend API

Arguments are camelCase on the JavaScript side. Every mutating vault command returns the complete `Vault`.

### Vault and Session

```
vault_exists() -> bool
get_default_service_types_list() -> ServiceType[]
create_vault(password, settings, selectedServiceTypeIds) -> Vault
unlock_vault(password) -> Vault
lock_vault() -> ()                       // idempotent; also clears the clipboard if AccMan still owns it
get_vault() -> Vault
update_settings(settings) -> Vault
change_master_password(oldPassword, newPassword) -> ()
```

### Export, Import and Backups

```
export_vault(exportPath, password) -> ()     // encrypts with the given password, then reads back and verifies
import_vault(importPath, password, mergeStrategy: "merge" | "replace") -> { vault, summary: ImportSummary }
list_backups() -> BackupInfo[]               // newest first; works while locked
restore_backup(fileName, password) -> Vault  // works locked or unlocked; leaves the session unlocked
```

### Service Types, Services and Accounts

```
add_service_type(serviceType) / update_service_type(serviceType) -> Vault
delete_service_type(serviceTypeId, cascade?) -> Vault      // SERVICE_TYPE_IN_USE unless cascade
add_service(service, accountId?) / add_services(services) / update_service(service) -> Vault
delete_service(serviceId) / delete_services(serviceIds) -> Vault
add_account(account) / update_account(account) -> Vault
delete_account(accountId) / delete_accounts(accountIds) -> Vault   // services are kept
link_services_to_account(accountId, serviceIds) / unlink_services_from_account(accountId, serviceIds) -> Vault
set_pinned(kind: "account" | "service", id, pinned) -> Vault
bulk_create_accounts(request) -> { vault, summary: { created, linked, unmatched } }
```

### Clipboard and Email

```
clipboard_copy(text, clearAfterSeconds?) -> ()
clipboard_clear() -> ()
is_email_provider_supported(email, imapHost?) -> bool
test_email_connection(email, password, imapHost?, imapPort?) -> EmailConnection
fetch_recent_emails(email, password, limit?, imapHost?, imapPort?) -> EmailFetchResult
```

### Errors

Every command rejects with `{ "code": "<CODE>", "message": "<English text>" }`. Codes include `VAULT_LOCKED`, `VAULT_NOT_FOUND`, `VAULT_CORRUPTED`, `UNSUPPORTED_VAULT_VERSION`, `INVALID_PASSWORD`, `PASSWORD_TOO_SHORT`, `SERVICE_TYPE_IN_USE`, `VALIDATION`, `BACKUP_NOT_FOUND`, `IO` and the `EMAIL_*` codes; see `ERROR_CODES` in `src/types/index.ts`.

### Data Models

```typescript
interface Vault {
  version: string            // "0.3.0"
  serviceTypes: ServiceType[]
  services: Service[]
  accounts: Account[]
  settings: Settings
}

interface Settings {
  autoLockMinutes: number        // 0 = disabled, default 15
  clipboardClearSeconds: number  // 0 = never, default 30
}

interface ServiceType { id: string; name: string; icon: string; fields: ServiceField[] }

interface ServiceField {
  id: string                 // stable identity; values follow it when the key is renamed
  key: string                // ^[a-z0-9_]+$, unique within the type
  label: string
  type: "text" | "secret" | "textarea" | "url" | "linked_service" | "2fa"
  masked: boolean
  required: boolean
  linkedServiceTypeId?: string
}

interface Service {
  id: string; serviceTypeId: string; label: string
  data: Record<string, string>; tags: string[]
  pinned: boolean; createdAt: number; updatedAt: number   // Unix ms, set by the backend; 0 = unknown
}

interface Account {
  id: string; label: string; notes: string; tags: string[]; linkedServices: string[]
  pinned: boolean; createdAt: number; updatedAt: number
}
```

## Vault File Format and Storage

### Location

`vault.json` lives in the app's local data folder (Tauri `AppLocalData`, identifier `com.romirom11.accman`):

- **Windows**: `%LOCALAPPDATA%\com.romirom11.accman\vault.json`
- **macOS**: `~/Library/Application Support/com.romirom11.accman/vault.json`
- **Linux**: `~/.local/share/com.romirom11.accman/vault.json`

Automatic backups (snapshots) are stored in `backups/vault-<unix_seconds>.json` next to it.

### Format v2

```json
{ "format": 2,
  "kdf": { "alg": "scrypt", "logN": 17, "r": 8, "p": 1 },
  "salt": "<base64>", "nonce": "<base64>", "ciphertext": "<base64, includes the GCM tag>" }
```

- The key is derived once per session with scrypt and reused for saves; every save uses a fresh random 96-bit nonce. The format, KDF parameters and salt are bound to the ciphertext as AES-GCM associated data.
- A wrong password gives `INVALID_PASSWORD`; an unreadable envelope, absurd KDF parameters or undecodable content give `VAULT_CORRUPTED`; an unknown `format` gives `UNSUPPORTED_VAULT_VERSION`.
- Legacy v1 files (`{ "salt": ..., "ciphertext": [numbers] }`, scrypt logN=14) are still read. After a successful unlock of a v1 file, or a v2 file with weaker KDF parameters, the backend takes a snapshot and re-encrypts the vault with the current parameters.
- Writes are atomic: a temporary file in the same folder (mode 0600 on Unix) is synced and renamed over the target, and the folder is synced on Unix. Exports use the same mechanism.

### Backups

A snapshot (a byte copy of the current `vault.json`) is taken before the first write of each unlocked session (except the session that created the vault, which has nothing worth backing up), before `change_master_password`, before `import_vault` and `restore_backup`, and before a format upgrade. At most one snapshot per second; the newest 15 are kept.

### Normalisation

After unlock, import and restore, the vault is normalised: `2fa_key`/`totp`/`totp_secret` fields of type `secret` become `2fa`, dangling account links and `linked_service` values are removed, tags are trimmed and de-duplicated, and empty or duplicate ids get new ones. Changes are persisted with the next save.

## Debugging

- **Frontend**: the webview developer tools are available in debug builds (right-click → Inspect).
- **Backend**: debug builds log at `info` level through `tauri-plugin-log` to the terminal running `pnpm tauri dev`. Secrets and file contents are never logged.

## Release Process

Releases are built by the GitHub Actions workflow in `.github/workflows/release.yml` (it runs on pushes to `master` and uses `tauri-action` to build the platform bundles and create the release). To build locally:

```bash
pnpm tauri build
# Artifacts: src-tauri/target/release/bundle/
```
