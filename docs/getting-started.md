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
2. **Service Templates**: Select which service templates you want to have available
3. **Master Password**: Create a strong master password to protect your vault
4. **Auto-lock Timer**: Configure how long AccMan stays unlocked

### Creating Your Master Password

Your master password is the key to your entire vault. Choose a strong password that:

- Is at least 12 characters long
- Contains uppercase and lowercase letters
- Includes numbers and special characters
- Is unique and not used elsewhere
- Is memorable to you

⚠️ **Important**: There's no way to recover your master password. If you forget it, you'll lose access to all your data.

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
2. Click **"Link Services"** button
3. Select services from the list or create new ones
4. Fill in the service-specific information (username, password, etc.)
5. Save your changes

### Creating Service Types

Service types are templates that define what fields are available for different types of services:

1. Go to **Service Types** in the sidebar
2. Click **"Create Service Type"**
3. Define the fields you need:
   - **Text fields**: For usernames, emails, etc.
   - **Secret fields**: For passwords (automatically masked)
   - **2FA fields**: For storing TOTP secrets
   - **URL fields**: For website links
4. Save your service type

## Security Features

### Auto-lock

AccMan can automatically lock your vault after a period of inactivity:

- Configure the timer in Settings
- Choose from 5 minutes to 4 hours, or disable auto-lock
- The vault locks immediately when you close the application

### 2FA Support

AccMan can store and generate TOTP (Time-based One-Time Password) codes:

1. Add a 2FA field to your service type
2. Scan the QR code or enter the secret key manually
3. AccMan will generate 6-digit codes that refresh every 30 seconds

### Data Encryption

- All data is encrypted using AES-256 encryption
- Your master password is used to derive the encryption key
- Data is stored locally and never transmitted to external servers

## Tips for Getting Started

1. **Start Small**: Begin with a few important accounts and gradually add more
2. **Use Tags**: Organize your accounts with meaningful tags like "work", "personal", "banking"
3. **Regular Backups**: Export your data regularly as a backup
4. **Strong Passwords**: Use AccMan to store unique, strong passwords for each service
5. **2FA Everything**: Enable 2FA on all services that support it and store the codes in AccMan

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