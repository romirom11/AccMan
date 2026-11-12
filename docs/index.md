---
layout: default
title: AccMan - Account Manager
---

# 🔐 AccMan - Account Manager

<div align="center" markdown="1">
  <img src="assets/images/accman.png" alt="AccMan Logo" width="128" height="128">
  
  **Secure and intuitive desktop application for managing your accounts and services.**
  
  [![Release](https://github.com/romirom11/AccMan/actions/workflows/release.yml/badge.svg)](https://github.com/romirom11/AccMan/actions/workflows/release.yml)
  [![GitHub Repo stars](https://img.shields.io/github/stars/romirom11/AccMan?style=social)](https://github.com/romirom11/AccMan)
  ![License](https://img.shields.io/badge/license-MIT-blue.svg)
  [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/romirom11/AccMan/releases)
</div>

## About

AccMan is a secure desktop application for comprehensive account management. Whether you're managing multiple accounts across different services, organizing personal credentials, or handling business accounts, AccMan provides a flexible and secure solution to store, organize, and quickly access all your account data in one encrypted vault.

## ✨ Features

- 🔒 **Secure Local Storage** - One encrypted vault file on your device (AES-256-GCM, key derived with scrypt). Your vault data stays local: the network is used only when you open an inbox in the email viewer (IMAP) and when AccMan checks GitHub for updates.
- 🛟 **Crash-safe saves and automatic backups** - Every save is written atomically, and encrypted backups of the vault are taken automatically (the newest 15 are kept). Restore one from the lock screen or from Settings.
- 💾 **Encrypted export with its own password** - Export the whole vault to a file protected by a password you choose; the file is read back and verified after writing. Import merges or replaces data and shows a summary.
- 🎯 **Multi-Account Organization** - Manage dozens of accounts per service efficiently, with bulk creation and bulk delete
- 🏷️ **Service Templates** - Create reusable service types with your own fields (text, secret, multi-line, URL, 2FA, link to another service)
- 🔑 **Live 2FA codes** - TOTP codes are shown live with a countdown and copied with one click (base32 secrets and `otpauth://` URIs)
- 📋 **Clipboard auto-clear** - Copied passwords, keys and codes are cleared from the clipboard after a configurable time if it still holds them; anything AccMan copied is also cleared when the vault locks or the app closes (clipboard history tools such as Win+V keep their own copies)
- 🎲 **Password generator** - Generate strong passwords for services and for the master password, with a strength hint
- ⌨️ **Command palette** - `Ctrl/Cmd+K` searches accounts and services and runs actions; `Ctrl/Cmd+L` locks the vault
- 📌 **Pinned and recent items** - Pin favourite accounts and services; the dashboard shows pinned and recently updated items
- 🩺 **Vault health** - Finds reused values (passwords, emails, proxies), weak passwords, invalid 2FA secrets, missing required fields, services without an account and empty accounts
- 📧 **Email inbox and verification codes** - Read recent emails of an IMAP mailbox over implicit TLS (IMAPS, usually port 993; built-in presets for popular providers, or your own IMAP host) and wait for a new verification code, which is copied automatically
- 📥 **Bulk Import** - Import many services at once from text (one line per service, custom separator)
- 🔗 **Account Linking** - Link multiple services to single accounts
- 🌍 **Multi-language** - Available in English and Ukrainian
- 📱 **Cross-Platform** - Works on Windows, macOS, and Linux; only one instance runs at a time

## 🚀 Quick Start

### Download

Download the latest version from the [Releases](https://github.com/romirom11/AccMan/releases) page.

### Installation

#### Windows
1. Download the `.msi` installer
2. Run the installer and follow the setup wizard
3. Launch AccMan from the Start Menu

#### macOS
1. Download the `.dmg` file
2. Open the DMG and drag AccMan to Applications
3. Launch AccMan from Applications (you may need to allow it in Security & Privacy settings)

#### Linux
1. Download the `.AppImage` file
2. Make it executable: `chmod +x AccMan.AppImage`
3. Run the application: `./AccMan.AppImage`

## 📖 Documentation

- [Getting Started](getting-started.html) - Installation and initial setup
- [User Guide](user-guide.html) - Complete feature overview
- [Developer Guide](developer-guide.html) - Contributing and development
- [FAQ](faq.html) - Frequently asked questions
- [Contributing](contributing.html) - How to contribute to the project

## 🛡️ Security

AccMan prioritizes your security:

- **Local Encryption**: The vault is encrypted with AES-256-GCM; the key is derived from your master password with scrypt (vault format v2, older vaults are upgraded automatically)
- **Master Password**: Your vault is protected by a master password that is never stored
- **No Cloud Storage**: The vault stays on your device. The network is used only for IMAP when you use the email viewer and for update checks on GitHub
- **Auto-lock**: Locks after inactivity (sleep counts too), or instantly with Ctrl/Cmd+L
- **Clipboard Auto-clear**: Copied secrets and 2FA codes are cleared after a configurable time if the clipboard still holds them, and anything AccMan copied is cleared on lock
- **Backups**: Crash-safe saves, automatic encrypted backups with restore, and verified exports protected by their own password
- **Hardened Webview**: Strict Content Security Policy, sandboxed email HTML, single running instance

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](contributing.html) for details.

## 📄 License

This project is licensed under the MIT License.

## 🔗 Links

- [GitHub Repository](https://github.com/romirom11/AccMan)
- [Download Latest Release](https://github.com/romirom11/AccMan/releases/latest)
- [Report Issues](https://github.com/romirom11/AccMan/issues)
- [Discussions](https://github.com/romirom11/AccMan/discussions)