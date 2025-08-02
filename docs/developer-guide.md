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
- [Contributing](#contributing)
- [API Documentation](#api-documentation)

## Architecture Overview

AccMan is built using the Tauri framework, combining:

- **Frontend**: React with TypeScript for the user interface
- **Backend**: Rust for secure data handling and system integration
- **Storage**: Local encrypted files using AES-256
- **IPC**: Tauri's secure communication between frontend and backend

### Key Design Principles

1. **Security First**: All sensitive data is encrypted at rest
2. **Local Storage**: No cloud dependencies or external services
3. **Cross-Platform**: Single codebase for Windows, macOS, and Linux
4. **Modern UI**: Clean, intuitive interface using modern web technologies
5. **Extensible**: Plugin-like service type system

## Development Setup

### Prerequisites

- **Node.js**: Version 16 or later
- **pnpm**: Package manager (recommended over npm/yarn)
- **Rust**: Latest stable version
- **Tauri CLI**: For building and development

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/romirom11/AccMan.git
   cd AccMan
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Install frontend dependencies**:
   ```bash
   pnpm --dir src install
   ```

4. **Install Rust dependencies**:
   ```bash
   cd src-tauri
   cargo build
   ```

### Development Environment

1. **Run Tauri development build**:
   ```bash
   pnpm tauri dev
   ```

This will start both the React development server and the Tauri application.

## Project Structure

```
AccMan/
├── src/                    # Frontend React application
│   ├── components/         # React components
│   │   ├── ui/            # Reusable UI components
│   │   └── *.tsx          # Feature-specific components
│   ├── pages/             # Application pages/routes
│   ├── hooks/             # Custom React hooks
│   ├── stores/            # State management (Zustand)
│   ├── api/               # API layer for Tauri commands
│   ├── locales/           # Internationalization files
│   │   ├── en/           # English translations
│   │   └── uk/           # Ukrainian translations
│   ├── types/             # TypeScript type definitions
│   └── lib/               # Utility functions
├── src-tauri/             # Tauri backend (Rust)
│   ├── src/               # Rust source code
│   │   ├── main.rs       # Application entry point
│   │   ├── lib.rs        # Library exports
│   │   ├── commands.rs   # Tauri command handlers
│   │   ├── storage.rs    # File system operations
│   │   ├── crypto.rs     # Encryption/decryption
│   │   ├── models.rs     # Data structures
│   │   └── defaults.rs   # Default service types
│   ├── icons/            # Application icons
│   └── Cargo.toml        # Rust dependencies
├── docs/                  # Documentation (GitHub Pages)
└── .github/               # GitHub workflows and templates
    └── workflows/
        └── release.yml    # Automated release workflow
```

## Technologies Used

### Frontend

- **React 19**: UI framework with hooks and functional components
- **TypeScript**: Type-safe JavaScript development
- **Vite**: Fast build tool and development server
- **Tailwind CSS**: Utility-first CSS framework
- **shadcn/ui**: Pre-built accessible UI components
- **React Router**: Client-side routing
- **Zustand**: Lightweight state management
- **i18next**: Internationalization framework
- **Lucide React**: Icon library

### Backend

- **Tauri**: Rust-based framework for desktop applications
- **Serde**: Serialization/deserialization library
- **AES-GCM**: Encryption implementation
- **PBKDF2**: Key derivation function
- **UUID**: Unique identifier generation
- **Chrono**: Date and time handling

### Development Tools

- **pnpm**: Fast, disk space efficient package manager
- **ESLint**: JavaScript/TypeScript linting
- **Prettier**: Code formatting
- **Cargo**: Rust package manager and build tool

## Building and Running

### Development Mode

```bash
# Start development build with hot reload
pnpm tauri dev
```

### Production Build

```bash
# Build frontend for production
pnpm build

# Build Tauri application
pnpm tauri build
```

### Platform-Specific Builds

```bash
# Build for current platform
pnpm tauri build

# Build with specific target
pnpm tauri build --target x86_64-pc-windows-msvc
```

## Contributing

### Code Style

- **Frontend**: Follow React best practices, use TypeScript strictly
- **Backend**: Follow Rust conventions, use `cargo fmt` and `cargo clippy`
- **Commits**: Use conventional commit messages

### Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Add tests if applicable
5. Ensure all tests pass: `pnpm test` and `cargo test`
6. Commit your changes: `git commit -m 'feat: add amazing feature'`
7. Push to the branch: `git push origin feature/amazing-feature`
8. Open a Pull Request

### Development Guidelines

#### Frontend

- Use functional components with hooks
- Implement proper TypeScript types
- Follow the existing component structure
- Use the established state management patterns
- Ensure accessibility (ARIA labels, keyboard navigation)
- Add translations for new text content

#### Backend

- Follow Rust ownership principles
- Handle errors properly using `Result<T, E>`
- Use appropriate data structures from `models.rs`
- Ensure thread safety for concurrent operations
- Add proper logging for debugging

### Testing

#### Frontend Tests

```bash
# Run frontend tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Generate coverage report
pnpm test:coverage
```

#### Backend Tests

```bash
# Run Rust tests
cd src-tauri
cargo test

# Run tests with output
cargo test -- --nocapture
```

## API Documentation

### Tauri Commands

The backend exposes several commands that the frontend can call:

#### Vault Management

```rust
// Check if vault exists
vault_exists() -> bool

// Create new vault
create_vault(password: String, settings: Settings, service_types: Vec<String>) -> Vault

// Unlock existing vault
unlock_vault(password: String) -> Vault

// Lock vault
lock_vault() -> ()
```

#### Account Operations

```rust
// Add new account
add_account(account: Account) -> ()

// Update existing account
update_account(account: Account) -> ()

// Delete account
delete_account(account_id: String) -> ()
```

#### Service Operations

```rust
// Add new service
add_service(service: Service) -> ()

// Update existing service
update_service(service: Service) -> ()

// Delete service
delete_service(service_id: String) -> ()

// Link services to account
link_services_to_account(account_id: String, service_ids: Vec<String>) -> ()
```

#### Service Type Operations

```rust
// Get default service types
get_default_service_types_list() -> Vec<ServiceType>

// Add custom service type
add_service_type(service_type: ServiceType) -> ()

// Update service type
update_service_type(service_type: ServiceType) -> ()

// Delete service type
delete_service_type(service_type_id: String) -> ()
```

### Data Models

#### Core Types

```typescript
interface Vault {
  accounts: Account[]
  services: Service[]
  serviceTypes: ServiceType[]
  settings: Settings
}

interface Account {
  id: string
  label: string
  notes: string
  tags: string[]
  linkedServices: string[]
}

interface Service {
  id: string
  label: string
  serviceTypeId: string
  data: Record<string, string>
  tags: string[]
}

interface ServiceType {
  id: string
  name: string
  fields: ServiceField[]
}

interface ServiceField {
  id: string
  name: string
  type: 'text' | 'secret' | '2fa' | 'url'
  required: boolean
  masked: boolean
}
```

### State Management

The application uses Zustand for state management with the following stores:

#### VaultStore

```typescript
interface VaultStore {
  // State
  appStatus: 'loading' | 'needs_setup' | 'locked' | 'unlocked' | 'error'
  vault: Vault | null
  error: string | null
  
  // Actions
  checkInitialStatus(): Promise<void>
  unlock(password: string): Promise<void>
  createVault(password: string, settings: Settings, serviceTypeIds: string[]): Promise<void>
  lock(): Promise<void>
  
  // CRUD operations for accounts, services, and service types
  addAccount(account: Account): Promise<void>
  updateAccount(account: Account): Promise<void>
  deleteAccount(accountId: string): Promise<void>
  // ... and more
}
```

### Encryption

The application uses AES-256-GCM encryption with PBKDF2 key derivation:

```rust
// Key derivation parameters
const PBKDF2_ITERATIONS: u32 = 100_000;
const SALT_LENGTH: usize = 32;
const KEY_LENGTH: usize = 32;

// Encryption process
1. Generate random salt
2. Derive key from password using PBKDF2
3. Generate random nonce
4. Encrypt data using AES-256-GCM
5. Store: salt + nonce + encrypted_data
```

### File Structure

Vault data is stored in platform-specific directories:

- **Windows**: `%APPDATA%/AccMan/vault.dat`
- **macOS**: `~/Library/Application Support/AccMan/vault.dat`
- **Linux**: `~/.local/share/AccMan/vault.dat`

## Debugging

### Frontend Debugging

- Use browser developer tools
- React Developer Tools extension
- Console logging with appropriate levels

### Backend Debugging

```bash
# Standard development
pnpm tauri dev

# Run with debug output
RUST_LOG=debug pnpm tauri dev

# Run specific module with debug
RUST_LOG=accman::storage=debug pnpm tauri dev
```

### Common Issues

1. **Build Failures**: Ensure all dependencies are installed
2. **Permission Errors**: Check file system permissions for vault storage
3. **Encryption Errors**: Verify master password handling
4. **UI Issues**: Check React component state and props

## Release Process

Releases are automated using GitHub Actions:

1. Create a new tag: `git tag v1.0.0`
2. Push the tag: `git push origin v1.0.0`
3. GitHub Actions will build and create a release
4. Binaries for all platforms will be attached to the release

### Manual Release

```bash
# Build for all platforms
pnpm tauri build

# Artifacts will be in src-tauri/target/release/bundle/
```

## Performance Considerations

- **Large Datasets**: Implement virtualization for large lists
- **Search**: Use efficient search algorithms (Fuse.js)
- **Memory**: Clear sensitive data from memory when locked
- **Startup**: Lazy load non-critical components
- **File I/O**: Minimize disk operations, batch writes

## Security Considerations

- **Memory Safety**: Rust prevents common security vulnerabilities
- **Input Validation**: Validate all user inputs
- **Secure Storage**: Never store plaintext passwords
- **Process Isolation**: Tauri provides secure IPC
- **Auto-lock**: Implement timeout-based locking

For more detailed information, check the inline code documentation and comments throughout the codebase.