---
layout: default
title: Getting Started
---

# Getting Started with AccMan

Welcome to AccMan! This guide will help you get started with managing your accounts securely.

## Installation

### System Requirements

- **Windows**: Windows 10 or later
- **macOS**: macOS 10.15 (Catalina) or later
- **Linux**: Most modern distributions with GTK 3.0+

### Download and Install

1. Visit the [Releases page](https://github.com/romirom11/AccMan/releases/latest)
2. Download the appropriate installer for your operating system:
   - **Windows**: `AccMan_x.x.x_x64_en-US.msi`
   - **macOS**: `AccMan_x.x.x_x64.dmg`
   - **Linux**: `AccMan_x.x.x_amd64.AppImage`

### Platform-Specific Installation

#### Windows
1. Double-click the downloaded `.msi` file
2. Follow the installation wizard
3. Launch AccMan from the Start Menu or Desktop shortcut

#### macOS
1. Open the downloaded `.dmg` file
2. Drag AccMan to the Applications folder
3. Launch AccMan from Applications
4. If you see a security warning, go to System Preferences > Security & Privacy and click "Open Anyway"

#### Linux
1. Make the AppImage executable:
   ```bash
   chmod +x AccMan_x.x.x_amd64.AppImage
   ```
2. Run the application:
   ```bash
   ./AccMan_x.x.x_amd64.AppImage
   ```

## First Launch

### Initial Setup

When you first launch AccMan, you'll be guided through the setup process:

1. **Language Selection**: Choose your preferred language (English or Ukrainian)
2. **Service Templates**: Select which built-in service types you want (Discord, Twitter (X), Email, Proxy, EVM Wallet, Solana Wallet)
3. **Master Password and Auto-lock**: Create the master password that protects your vault and choose after how much inactivity AccMan locks itself

### Creating Your Master Password

Your master password is the key to your entire vault. It must be at least 8 characters long; the password generator button next to the field creates a strong one, and a strength hint is shown as you type. Choose a password that:

- Is at least 12 characters long
- Contains uppercase and lowercase letters
- Includes numbers and special characters
- Is unique and not used elsewhere
- Is memorable to you

⚠️ **Important**: There's no way to recover your master password. If you forget it, you'll lose access to all your data unless you have a backup or export whose password you know.

### Upgrading from an Older Version

If you already have a vault created by an older version of AccMan, just unlock it. AccMan backs up the old file and upgrades the vault to the current, stronger file format automatically.

## Basic Usage

### Creating Your First Account

1. Click the **"Create Account"** button on the dashboard
2. Fill in the account details:
   - **Label**: A descriptive name for the account
   - **Notes**: Any additional information
   - **Tags**: Keywords to help organize and search
3. Click **"Save"** to create the account

### Adding Services to Your Account

1. Open your account by clicking on it
2. Link existing services, or create a new service that is linked right away
3. Fill in the service-specific information (username, password, etc.)
4. Save your changes

### Creating Service Types

Service types are templates that define what fields are available for different types of services:

1. Go to **Service Types** in the sidebar
2. Click **"Create Type"**
3. Define the fields you need:
   - **Text fields**: For usernames, emails, etc.
   - **Secret fields**: For passwords (automatically masked)
   - **Multi-line fields**: For backup codes, tokens and notes
   - **2FA fields**: For storing TOTP secrets (codes are shown live)
   - **URL fields**: For website links
   - **Linked service fields**: To point to another service, such as the email or proxy used
4. Save your service type

## Security Features

### Auto-lock

AccMan can automatically lock your vault after a period of inactivity:

- Configure the timer in Settings (1, 5, 15, 30 or 60 minutes, or disabled)
- Time the computer spends asleep counts as inactivity
- Lock manually at any time with **Ctrl/Cmd+L** or the lock button in the sidebar
- The vault is locked whenever the application starts

### 2FA Support

AccMan can store and generate TOTP (Time-based One-Time Password) codes:

1. Add a 2FA field to your service type (the built-in Discord, Twitter (X) and Email types already have one)
2. Paste the secret key (base32) or an `otpauth://` URI
3. AccMan shows the current code live with a countdown; click it to copy it. The clipboard is cleared automatically after the time set in Settings, if it still holds the code

### Data Encryption

- All data is encrypted using AES-256-GCM
- The encryption key is derived from your master password with scrypt
- The vault is stored locally and is never uploaded anywhere. AccMan uses the network only for IMAP when you open an inbox in the email viewer, and to check GitHub for updates
- Encrypted backups of the vault are taken automatically, and you can export an encrypted copy with its own password (Settings)

## Tips for Getting Started

1. **Start Small**: Begin with a few important accounts and gradually add more
2. **Use Tags**: Organize your accounts with meaningful tags like "work", "personal", "banking"
3. **Regular Backups**: Automatic backups protect against mistakes; also export the vault regularly to another drive
4. **Strong Passwords**: Use the password generator to create unique, strong passwords for each service
5. **2FA Everything**: Enable 2FA on all services that support it and store the secrets in AccMan
6. **Use the command palette**: Press **Ctrl/Cmd+K** to jump to any account or service

## For Developers

If you want to build from source:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/romirom11/AccMan.git
   cd AccMan
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   pnpm --dir src install
   ```

3. **Run in development mode**:
   ```bash
   pnpm tauri dev
   ```

4. **Build for production**:
   ```bash
   pnpm tauri build
   ```

## Next Steps

- Read the [User Guide](user-guide.html) for detailed feature explanations
- Check out the [FAQ](faq.html) for common questions
- Visit our [GitHub repository](https://github.com/romirom11/AccMan) for updates and support

## Need Help?

If you encounter any issues:

1. Check the [FAQ](faq.html) for common solutions
2. Search existing [GitHub Issues](https://github.com/romirom11/AccMan/issues)
3. Create a new issue if you can't find a solution
4. Join our [Discussions](https://github.com/romirom11/AccMan/discussions) for community support