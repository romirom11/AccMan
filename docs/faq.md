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

Yes, your data is protected by:
- **AES-256 encryption** for all stored data
- **Local storage only** - data never leaves your device
- **Master password protection** - only you can access your vault
- **Memory clearing** - sensitive data is removed from memory when locked

### What happens if I forget my master password?

Unfortunately, there's no way to recover a forgotten master password. This is by design to ensure maximum security. If you forget your master password, you'll need to:
1. Delete the vault file
2. Create a new vault
3. Re-enter all your data

To prevent this, consider:
- Using a memorable but strong password
- Writing it down and storing it securely
- Regular data exports as backups

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

Yes, you can install AccMan on multiple devices, but each installation will have its own separate vault. To sync data between devices, you'll need to:
1. Export data from one device
2. Import it on another device
3. Manually keep them synchronized

### How do I update AccMan?

Currently, updates are manual:
1. Download the latest version from GitHub releases
2. Install it over your existing installation
3. Your vault data will be preserved

Automatic updates may be added in future versions.

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

AccMan supports importing from:
- CSV files (common export format)
- JSON files
- Plain text files

To import from other password managers:
1. Export your data from the other tool
2. Use AccMan's bulk import feature
3. Map the fields appropriately
4. Review and clean up the imported data

### How do I backup my data?

1. Go to **Settings** > **Export Data**
2. Choose your export format (JSON recommended for complete backups)
3. Save the file to a secure location
4. Consider encrypting the backup file separately
5. Store backups in multiple locations (cloud storage, external drives)

### Why can't I see my 2FA codes?

If 2FA codes aren't generating:
1. Ensure you've entered the correct secret key
2. Check that the field type is set to "2FA"
3. Verify your system clock is accurate
4. Try re-entering the 2FA secret

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
1. **Double-check your password** - ensure caps lock is off
2. **Try typing slowly** - avoid rapid keystrokes
3. **Restart AccMan** - close and reopen the application
4. **Check vault file** - ensure it hasn't been corrupted or moved

### Data appears corrupted

If your data seems corrupted:
1. **Don't panic** - try restarting AccMan first
2. **Check backups** - restore from a recent export
3. **Contact support** - create a GitHub issue with details
4. **Preserve the vault file** - don't delete it, it might be recoverable

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