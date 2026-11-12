---
layout: default
title: FAQ
---

# Frequently Asked Questions

Find answers to common questions about AccMan.

## General Questions

### What is AccMan?

AccMan is a secure desktop application for managing your accounts and services. It stores all your login credentials, 2FA codes, and account information in an encrypted vault on your local device.

### Is AccMan free?

Yes, AccMan is completely free and open-source. You can use it without any limitations, and the source code is available on GitHub.

### What platforms does AccMan support?

AccMan works on:
- **Windows** 10 and later
- **macOS** 10.15 (Catalina) and later
- **Linux** distributions with GTK 3.0+

### How is AccMan different from other password managers?

AccMan is designed specifically for managing multiple accounts per service. While traditional password managers focus on individual logins, AccMan lets you organize accounts by person or purpose and link multiple services to each account.

## Security Questions

### Is my data safe?

Your data is protected by:
- **AES-256-GCM encryption** of the whole vault, with the key derived from your master password by scrypt (logN=17, r=8, p=1)
- **Local storage only** - the vault never leaves your device. The network is used only for IMAP when you open an inbox in the email viewer, and to check GitHub for updates
- **Master password protection** - the master password is not stored; only a derived key is kept in memory while the vault is unlocked
- **Auto-lock and clipboard clearing** - the vault locks after inactivity, and copied secrets are cleared from the clipboard after a configurable time and on lock, if the clipboard still holds them
- **Crash-safe saves and automatic backups** - a crash during a save cannot corrupt the vault, and encrypted automatic backups let you go back

### What happens if I forget my master password?

There's no way to recover a forgotten master password. This is by design. What you can still do:
- **Restore an automatic backup** whose password you remember (for example one taken before you changed the master password): on the lock screen click **Restore from backup**. The backup's password becomes your master password.
- **Import an export** into a new vault if you know the export password.

Otherwise you will need to delete the vault file, create a new vault and enter your data again.

To prevent this, consider:
- Using a memorable but strong password (the built-in generator can help)
- Writing it down and storing it securely
- Exporting the vault regularly to another drive, with an export password you will remember

### Can AccMan be hacked?

While no software is 100% secure, AccMan is designed with security best practices:
- All data is encrypted locally
- No network connections for data storage
- Built with Rust, which prevents many common vulnerabilities
- Regular security updates

### Should I trust AccMan with my passwords?

AccMan is open-source, meaning anyone can review the code for security issues. The encryption implementation uses well-established cryptographic libraries. However, you should always:
- Keep regular backups
- Use strong, unique passwords
- Enable 2FA on important accounts

## Installation and Setup

### Why does my antivirus flag AccMan?

Some antivirus software may flag AccMan as suspicious because:
- It's a new application without widespread recognition
- It handles sensitive data (passwords)
- The executable is not signed with an expensive code signing certificate

AccMan is safe to use. You can:
- Add it to your antivirus whitelist
- Download from the official GitHub releases page
- Verify the file checksums if provided

### Can I install AccMan on multiple devices?

Yes, you can install AccMan on multiple devices, but each installation will have its own separate vault. To move data between devices:
1. Export the vault on one device (**Settings → Export & Import → Export Vault**) with an export password
2. Import the file on the other device with that password, choosing **Merge** or **Replace**
3. Repeat when needed; there is no automatic sync

On one device, only one AccMan instance runs at a time: starting it again focuses the open window.

### How do I update AccMan?

AccMan checks for updates when it starts and asks before downloading and installing a new version; you can also click **Settings → About → Check for updates**. Alternatively, download the latest version from GitHub releases and install it over the existing installation.

Your vault is preserved. A vault created by an older version of AccMan uses an older file format; it opens normally, and after the first unlock AccMan backs up the old file and upgrades the vault to the current format automatically.

## Usage Questions

### How do I organize my accounts?

Here are some organization strategies:

**By Person:**
- "John's Personal Account"
- "John's Work Account"
- "Sarah's Account"

**By Purpose:**
- "Personal Social Media"
- "Work Development Tools"
- "Family Shared Services"

**By Security Level:**
- "High Security" (banking, email)
- "Medium Security" (social media)
- "Low Security" (forums, newsletters)

### What's the difference between accounts and services?

- **Accounts** represent a person or purpose (e.g., "John's Work Account")
- **Services** represent platforms or applications (e.g., "Gmail", "Discord")
- You link services to accounts to organize related logins

### How do I handle shared accounts?

For accounts shared between multiple people:
1. Create an account with a descriptive name (e.g., "Family Netflix")
2. Add appropriate tags (e.g., "shared", "family")
3. Link the relevant services
4. Use notes to document who has access

### Can I import data from other password managers?

There is no direct importer for other password managers. You can import services from text, one line per service, with a separator of your choice (for example a CSV export or a `login:password` list):
1. Export your data from the other tool as text/CSV
2. Open **Import services** (dashboard, Services page or command palette)
3. Choose the service type and separator, and map the columns to fields
4. Check the preview and import

### How do I backup my data?

AccMan takes **automatic encrypted backups** of the vault (before the first change after each unlock, before a password change, an import or a restore, and before a format upgrade) and keeps the newest 15. They are stored next to the vault, so they do not protect you against losing the disk. For that:
1. Go to **Settings** > **Export & Import** > **Export Vault**
2. Choose an export password (at least 8 characters) and confirm it. You will need it to import the file
3. Save the file; AccMan verifies it after writing
4. Store copies in more than one place (for example an external drive)

Export files and automatic backups are encrypted; there is no plaintext export.

### I exported the vault with an older version and the export password does not work

Older versions of AccMan encrypted export files with the master password that was in use at the time of the export and ignored the password typed in the export dialog. Import such files with that master password. Export files made with the current version use the export password.

### How do I restore an automatic backup?

On the lock screen click **Restore from backup**, or use **Settings → Automatic backups → Restore from backup**. Choose a backup, enter the master password that was valid when it was taken and confirm. The current vault is backed up first, and the backup's password becomes your master password.

### Why is my clipboard cleared?

Masked (secret) values, 2FA codes, 2FA keys and generated passwords copied with AccMan's copy buttons are cleared from the clipboard after the time set in **Settings → Clear clipboard after** (default 30 seconds), if the clipboard still holds them. In addition, when the vault locks or AccMan closes, anything AccMan copied (including non-secret values such as usernames or links) is cleared if it is still on the clipboard. If you copied something else in the meantime, it is left alone.

Setting **Clear clipboard after** to **Never** turns off only the timed clearing; the clearing on lock and on close still happens.

### Can copied secrets stay in clipboard history?

Yes. AccMan can only clear the current clipboard content. Clipboard history and cloud clipboard features keep their own copies: for example Windows clipboard history (**Win+V**) and its "Sync across devices" option, or clipboard managers such as Klipper on KDE. If you copy secrets from AccMan, turn these features off (on Windows: **Settings → System → Clipboard**) or clear their history after use.

### Why can't I see my 2FA codes?

2FA fields show the current code live with a countdown. If no code appears:
1. Check the field type is **2FA** (fields with the key `2fa_key` are converted automatically)
2. Check the secret: base32 (spaces and lowercase are fine) or an `otpauth://` URI. An invalid secret is shown in red and listed in **Vault health**
3. If codes are rejected by the website, make sure your system clock is accurate

### Which email providers work with the inbox view?

Gmail, Outlook/Hotmail/Live, Yahoo, iCloud, GMX, Mail.ru, Yandex, Rambler, UKR.NET, I.UA, META.UA, Zoho, AOL and FirstMail are detected from the address. Any other mailbox works if you fill in the **IMAP Host** (and **IMAP Port**, default 993) fields of the Email service and the server offers IMAP over implicit TLS (IMAPS, usually port 993) with a certificate your system trusts. Servers that only offer STARTTLS (usually port 143) or unencrypted IMAP are not supported. Proton Mail is not supported: its Proton Bridge uses STARTTLS and a self-signed certificate by default. Many providers require an app password for IMAP; Microsoft has disabled password-based IMAP for most personal Outlook accounts.

## Technical Issues

### AccMan won't start

Try these solutions:
1. **Restart your computer**
2. **Run as administrator** (Windows) or with sudo (Linux)
3. **Check antivirus software** - add AccMan to whitelist
4. **Reinstall AccMan** - download fresh copy from GitHub
5. **Check system requirements** - ensure your OS is supported

### The application is slow

Performance issues may be caused by:
- **Large datasets** - consider organizing with tags and search
- **Low system resources** - close other applications
- **Disk space** - ensure adequate free space
- **Antivirus scanning** - add AccMan folder to exclusions

### I can't unlock my vault

If you can't unlock your vault:
1. **Double-check your password** - the lock screen warns when Caps Lock is on
2. **Check the keyboard layout** - the password is case- and layout-sensitive
3. **Restore a backup** - if the vault file is reported as damaged, or you remember an older password, click **Restore from backup** on the lock screen

### Data appears corrupted

If your data seems corrupted:
1. **Don't panic** - saves are atomic, so the vault file is either the old or the new version
2. **Restore an automatic backup** from the lock screen or Settings, or import a recent export
3. **Preserve the vault file** - don't delete it; the current file is also backed up automatically before a restore
4. **Contact support** - create a GitHub issue with details (never attach the vault file)

### AccMan crashes frequently

For stability issues:
1. **Update AccMan** - ensure you have the latest version
2. **Check system requirements** - verify compatibility
3. **Disable antivirus temporarily** - test if it's causing conflicts
4. **Report the issue** - create a GitHub issue with crash details

## Feature Requests

### Will there be a mobile app?

A mobile companion app is being considered for future development. It would likely be view-only for security reasons.

### Can you add cloud sync?

Cloud sync is not planned due to security concerns. AccMan is designed to keep your data local and under your control.

### Will there be browser integration?

Browser integration (auto-fill) is being considered but presents security challenges that need careful consideration.

### Can I customize the interface?

Basic theming options may be added in future versions. The current focus is on core functionality and security.

## Getting Help

### Where can I get support?

1. **Check this FAQ** for common issues
2. **Search GitHub Issues** for existing solutions
3. **Create a new issue** if you can't find an answer
4. **Join discussions** on GitHub for community support

### How do I report a bug?

When reporting bugs:
1. Go to [GitHub Issues](https://github.com/romirom11/AccMan/issues)
2. Search for existing reports
3. Create a new issue with:
   - Clear description of the problem
   - Steps to reproduce
   - Your operating system and AccMan version
   - Screenshots if applicable

### How can I contribute?

You can help by:
- **Reporting bugs** and issues
- **Suggesting features** and improvements
- **Contributing code** (see [Developer Guide](developer-guide.html))
- **Improving documentation**
- **Translating** to other languages
- **Sharing AccMan** with others who might find it useful

### Is there a community?

Join the community on:
- **GitHub Discussions** for questions and ideas
- **GitHub Issues** for bug reports and feature requests
- **Social media** - follow updates and announcements

---

**Still have questions?** Feel free to [create an issue](https://github.com/romirom11/AccMan/issues/new) on GitHub or start a [discussion](https://github.com/romirom11/AccMan/discussions).