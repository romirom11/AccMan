---
layout: default
title: User Guide
---

# User Guide

This guide covers the features of AccMan and how to use them.

## Table of Contents

- [Dashboard](#dashboard)
- [Accounts](#accounts)
- [Services](#services)
- [Service Types](#service-types)
- [Working with Field Values](#working-with-field-values)
- [Email Inbox and Verification Codes](#email-inbox-and-verification-codes)
- [Search and the Command Palette](#search-and-the-command-palette)
- [Security](#security)
- [Backups, Export and Import](#backups-export-and-import)
- [Settings](#settings)
- [Keyboard Shortcuts](#keyboard-shortcuts)

## Dashboard

The dashboard is the home screen. It shows:

- **Quick actions** to create an account or a service, import services and search.
- **Statistics**: number of accounts, services and service types, and the auto-lock setting.
- **Pinned** accounts and services (see [Pinning](#pinning)).
- **Recently updated** accounts and services. Every account and service records when it was created and last changed. Items created by older versions of AccMan have no timestamp and are listed last.
- **Vault health** (see below).

### Vault Health

The vault health panel analyses your vault locally and lists problems without showing any secret values:

- **Reused values**: the same password, email, proxy or other identifying value used by several services. Values shared between different accounts can link those accounts to each other.
- **Weak passwords**: short or easy-to-guess passwords.
- **Invalid 2FA secrets**: 2FA keys that cannot produce a code (usually a typo).
- **Missing required fields**: services whose required fields are empty.
- **Services without a type**, **services without an account** and **accounts without services**.

Click an item to open it.

## Accounts

An account groups the services that belong to one person, persona or purpose. Deleting an account never deletes its services; they are only unlinked.

### Creating Accounts

1. Click **Create Account** on the dashboard or the Accounts page.
2. Enter a **label**, optional **notes** and **tags**.
3. Save.

### Bulk Creating Accounts

**Bulk Create** on the Accounts page creates up to 1000 accounts at once from a name template such as `Account %n%`, where `%n%` is replaced by a running number (if the template has no `%n%`, the number is appended). Optionally, each new account can be linked to existing services whose name matches a service name template with the same number. A preview shows the generated names before you create them, and a summary shows how many accounts were created and how many services were linked.

### Selecting and Deleting Several Accounts

1. Click **Select** on the Accounts page.
2. Click accounts to select them. **Shift+click** selects a range, **Ctrl/Cmd+A** selects all shown accounts, **Esc** leaves selection mode.
3. Click **Delete** and confirm. The services of the deleted accounts are kept.

### Account Details

Open an account to see its notes, tags and linked services with all their field values. From here you can link existing services, create a new service and link it in one step, unlink services, pin the account, edit it or delete it.

## Services

A service is one login or asset on a platform (for example a Discord account, a mailbox, a proxy or a wallet). Each service is based on a **service type** that defines its fields, and can be linked to accounts.

### Creating Services

1. Go to **Services** and click **Add Service**.
2. Choose the service type and fill in the fields. Secret fields have a password generator button next to them.
3. Save.

### Selecting Several Services

On the Services page, enter selection mode to select several services, then delete them or link them to an account in one step. Deleting a service also removes it from every account and clears fields in other services that pointed to it.

### Importing Services from Text

**Import services** creates many services of one type at once from text, one line per service. You choose the separator (any text, for example `:` or `|`, or a tab), map columns to fields, and get a preview of exactly what will be created. Rows with an empty or already existing label are skipped and listed with the reason.

### Pinning

Use the pin button on an account or service to pin it. Pinned items are listed first and appear in the **Pinned** section of the dashboard.

## Service Types

Service types are templates that define which fields a service has. AccMan ships with Discord, Twitter (X), Email, Proxy, EVM Wallet and Solana Wallet, and you choose which of them to add when you create the vault.

### Field Types

- **Text**: plain values such as usernames or emails.
- **Secret**: masked values such as passwords.
- **Multi-line text (textarea)**: longer values such as backup codes or tokens; line breaks are kept.
- **URL**: web addresses. They are shown as text with a copy button and are not opened inside AccMan.
- **2FA**: a TOTP secret. AccMan shows the current code live (see below).
- **Linked service**: a reference to another service, for example the email or proxy used by an account.

### Creating and Editing Service Types

1. Go to **Service Types** and create a new type, or select an existing one to edit it.
2. Add fields with a label and a type, and mark them as required or masked if needed. The internal field key is generated from the label (Cyrillic labels are transliterated).
3. Save. Renaming a field keeps the values stored in it; removing a field deletes its values from all services of that type.

Deleting a service type that is still used asks for confirmation and says how many services use it. **Confirming deletes those services too**, with their stored data and account links, and removes linked-service fields in other types that point to this type (with their values). If you did this by mistake, restore an [automatic backup](#restoring-a-backup).

## Working with Field Values

- **Reveal**: click the eye icon to show a masked value. It hides again after 15 seconds.
- **Copy**: click the copy icon. A notification confirms the copy. Masked (secret) values, 2FA codes, 2FA keys and generated passwords are cleared from the clipboard after the time set in **Settings → Clear clipboard after** (default 30 seconds), if the clipboard still holds them. When the vault locks or AccMan closes, anything AccMan copied (including non-secret values) is cleared as well if it is still on the clipboard. Clipboard history tools keep their own copies; see the [FAQ](faq.html).
- **2FA codes**: 2FA fields show the current code with a countdown to the next one. Click the code (or its copy button) to copy it. The secret key itself stays masked and has separate show and copy buttons. Base32 secrets (spaces and lowercase are fine) and `otpauth://` URIs, including non-default digits, period and algorithm, are supported. If a key is invalid, the field says so.
- Empty fields show **Not set**, or a red warning when the field is required.

## Email Inbox and Verification Codes

Services of the **Email** type have an inbox view that reads the most recent messages over IMAP using the service's email and password.

- **Providers**: the IMAP server is detected from the address for Gmail, Outlook/Hotmail/Live, Yahoo, iCloud, GMX, Mail.ru, Yandex, Rambler, UKR.NET, I.UA, META.UA, Zoho, AOL and FirstMail. For any other mailbox, fill in the service's **IMAP Host** (and **IMAP Port** if it is not 993). The server must offer IMAP over implicit TLS (IMAPS, usually port 993) with a certificate your system trusts. Servers that only offer STARTTLS (usually port 143) or plain IMAP are not supported, and neither is Proton Mail (its Proton Bridge uses STARTTLS and a self-signed certificate by default). Vaults created with an older version get the **IMAP Host** and **IMAP Port** fields added to the built-in Email type automatically when the vault is unlocked; a custom email type needs fields with the keys `imap_host` and `imap_port`.
- **Verification codes** found in a message are highlighted and can be copied.
- **Wait for code**: click it before requesting a code on a website. AccMan checks the inbox every 5 seconds for up to 2 minutes and copies the first code from a message that arrives after you clicked.
- HTML emails are shown in a sandbox without scripts or remote content.

Many providers (for example Gmail and Yahoo) require an app password for IMAP access. Microsoft has disabled password-based IMAP for most personal Outlook accounts.

## Search and the Command Palette

- The search field in the sidebar shows matching accounts and services as you type.
- **Ctrl+K** (Windows/Linux) or **Cmd+K** (macOS) opens the command palette. Type to fuzzy-search accounts and services by label, tags, type and non-secret field values (secret values are never searched), then press Enter to open the result. The palette also runs actions: new account, new service, import services, service types, settings and lock.
- The Accounts and Services pages have their own search and filters.

## Security

### Master Password

The master password encrypts the whole vault. It must be at least 8 characters long; the setup screen and the change-password form include a password generator and a strength hint. **It cannot be recovered.** If you forget it, the only way back is a backup or export whose password you still know.

To change it: **Settings → Change Master Password**, enter the current password and the new one twice. A backup of the vault is taken first. Older backups and exports keep the password they were made with.

### Auto-lock and Manual Lock

- **Auto-lock** locks the vault after the selected time without keyboard or mouse activity (1, 5, 15, 30 or 60 minutes, or disabled). Time the computer spends asleep counts as inactivity, so the vault is locked when you come back.
- Lock manually with the lock button in the sidebar, the command palette or **Ctrl/Cmd+L**.
- Locking clears decrypted data from the window and clears the clipboard if it still holds something AccMan copied.

### Single Instance

Only one AccMan window can run at a time. Starting AccMan again brings the existing window to the front instead of opening the same vault twice.

### Encryption

- AES-256-GCM with a random nonce for every save.
- The key is derived from the master password with scrypt (logN=17, r=8, p=1) and a random salt. The parameters are stored in the vault file (format v2), so they can be raised in future versions.
- The key is derived once per session; the master password itself is not kept in memory after unlocking.
- Saves are crash-safe: the new file is written next to the old one and then renamed over it.

### Vault Format Upgrade

Vaults created by older versions of AccMan use an older file format (v1) with weaker key derivation. They still open normally. After the first successful unlock, AccMan backs up the old file and re-encrypts the vault in the current format automatically. Nothing needs to be done.

## Backups, Export and Import

### Automatic Backups

AccMan keeps encrypted backups of the vault file in a `backups` folder next to it. A backup is taken:

- before the first change after each unlock;
- before the master password is changed;
- before an import and before a restore;
- before the vault file is upgraded to a newer format.

Changes made right after creating a new vault, before it is locked for the first time, do not trigger a backup.

The newest 15 backups are kept; older ones are deleted automatically. Automatic backups are stored on the same disk as the vault, so also export a copy to another place from time to time.

### Restoring a Backup

You can restore a backup from **Settings → Automatic backups** or from the lock screen (**Restore from backup**), for example if you made a mistake or the vault file is damaged:

1. Choose a backup (they are listed by date and size).
2. Enter the master password that was valid when the backup was taken.
3. Confirm. The current vault is backed up first, the selected backup becomes the vault, and **its password becomes your master password**. The vault is then unlocked.

### Export

**Settings → Export & Import → Export Vault** saves an encrypted copy of the whole vault:

1. Enter an export password (at least 8 characters) and confirm it. It can differ from the master password. **You need this password to import the file**, and it cannot be recovered.
2. Choose where to save the file (the suggested name contains the date, for example `AccMan-export-2026-11-12.json`).
3. AccMan writes the file, reads it back and decrypts it to verify it before reporting success.

Files exported by older AccMan versions were encrypted with the master password in use at the time of the export, not with the export password typed in the dialog. Open them with that master password.

### Import

**Settings → Export & Import → Import Vault**:

1. Select an export file and enter its password.
2. Choose how to import:
   - **Merge** adds service types, services and accounts that are not in the vault yet. Items that already exist (same ID) are kept unchanged and skipped; an existing service type only gains fields it is missing.
   - **Replace** replaces all service types, services and accounts with the ones from the file.
   In both cases your current settings and master password stay the same, and a backup of the vault is taken first.
3. After the import, a summary shows how many items were added, extended and skipped.

## Settings

Changes to preferences are saved immediately.

- **Language**: English or Ukrainian.
- **Auto-lock time**: see [Auto-lock](#auto-lock-and-manual-lock).
- **Clear clipboard after**: never, 15 s, 30 s, 1 minute or 2 minutes. **Never** turns off only the timed clearing: anything AccMan copied is still cleared when the vault locks or the app closes. Clipboard history and cloud clipboard (for example Win+V on Windows) may keep their own copy, which AccMan cannot remove.
- **Change Master Password**.
- **Export & Import** and **Automatic backups** (see above).
- **About**: version, links (copy them and open them in your browser) and **Check for updates**. AccMan also checks for updates when it starts and asks before installing one.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+K / Cmd+K | Open the command palette |
| Ctrl+L / Cmd+L | Lock the vault |
| Shift+click | Select a range (selection mode on the Accounts page) |
| Ctrl+A / Cmd+A | Select all shown accounts (selection mode) |
| Esc | Close dialogs, leave selection mode |

## Troubleshooting

For common issues and solutions, see the [FAQ](faq.html).
