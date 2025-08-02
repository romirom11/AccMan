---
layout: default
title: User Guide
---

# User Guide

This comprehensive guide covers all features and functionality of AccMan.

## Table of Contents

- [Dashboard](#dashboard)
- [Accounts Management](#accounts-management)
- [Services Management](#services-management)
- [Service Types](#service-types)
- [Search and Filtering](#search-and-filtering)
- [Security Features](#security-features)
- [Import/Export](#importexport)
- [Settings](#settings)

## Dashboard

The dashboard is your home screen in AccMan, providing:

### Quick Actions
- **Create Account**: Quickly add a new account
- **Create Service**: Add a new service to your library

### Statistics
- **Total Accounts**: Number of accounts in your vault
- **Total Services**: Number of services available
- **Auto-lock Status**: Current auto-lock configuration

### Recent Accounts
Displays your 5 most recently accessed accounts for quick access.

## Accounts Management

### Creating Accounts

1. Click **"Create Account"** from the dashboard or accounts page
2. Fill in the required information:
   - **Label**: Descriptive name (e.g., "John's Work Account")
   - **Notes**: Additional information or context
   - **Tags**: Keywords for organization (comma-separated)
3. Click **"Save"** to create the account

### Viewing Accounts

- **Grid View**: Visual cards showing account information
- **List View**: Compact list format
- Switch between views using the grid/list toggle buttons

### Account Details

Click on any account to view:

- **Account Information**: Label, tags, and notes
- **Linked Services**: All services associated with this account
- **Service Data**: Usernames, passwords, and other service-specific information

### Editing Accounts

1. Open the account details page
2. Click the **"Edit"** button in the header
3. Modify the information as needed
4. Click **"Save"** to apply changes

### Deleting Accounts

1. Open the account details page
2. Click the **"Delete"** button in the header
3. Confirm the deletion in the dialog

⚠️ **Warning**: Deleting an account will unlink all associated services but won't delete the services themselves.

## Services Management

### Understanding Services

Services represent individual platforms or applications (e.g., Gmail, Discord, GitHub). Each service:

- Is based on a **Service Type** template
- Contains specific data fields (username, password, etc.)
- Can be linked to multiple accounts

### Creating Services

1. Go to the **Services** page
2. Click **"Add Service"**
3. Select a service type from the dropdown
4. Fill in the service information:
   - **Label**: Service name (e.g., "Personal Gmail")
   - **Data Fields**: Based on the selected service type
   - **Tags**: Keywords for organization
5. Click **"Save"**

### Service Data Fields

Different field types serve different purposes:

- **Text**: Regular text information (usernames, emails)
- **Secret**: Masked fields for sensitive data (passwords)
- **2FA**: TOTP secret keys for two-factor authentication
- **URL**: Website links with clickable functionality

### Linking Services to Accounts

#### From Account View
1. Open an account
2. Click **"Link Services"**
3. Select services from the available list
4. Click **"Link Selected"**

#### Bulk Linking
1. Go to the Services page
2. Select multiple services using checkboxes
3. Click **"Link to Account"**
4. Choose the target account
5. Confirm the linking

### Managing Service Data

#### Viewing Sensitive Information
- Click the **eye icon** to reveal masked passwords
- Information automatically hides after 15 seconds

#### Copying Data
- Click the **copy icon** next to any field to copy it to clipboard
- Useful for quickly pasting passwords into login forms

#### 2FA Code Generation
- Click the **key icon** next to 2FA fields
- Generates a 6-digit TOTP code
- Codes refresh every 30 seconds

## Service Types

Service types are templates that define what information can be stored for different types of services.

### Built-in Service Types

AccMan comes with common service types:
- **Email Account**: Username, password, IMAP/SMTP settings
- **Social Media**: Username, password, email
- **Gaming Platform**: Username, password, email, 2FA
- **Banking**: Account number, password, security questions
- **And many more...**

### Creating Custom Service Types

1. Go to **Service Types** in the sidebar
2. Click **"Create Service Type"**
3. Configure the service type:
   - **Name**: Display name (e.g., "Discord Account")
   - **System Name**: Internal identifier (auto-generated)
4. Add fields as needed:
   - **Field Name**: What the field represents
   - **Field Type**: Text, Secret, 2FA, or URL
   - **Required**: Whether the field must be filled
   - **Masked**: Whether to hide the field by default

### Field Types Explained

- **Text**: Plain text fields for usernames, emails, etc.
- **Secret**: Automatically masked fields for passwords
- **2FA**: Special fields for TOTP secrets with code generation
- **URL**: Fields that become clickable links

### Editing Service Types

1. Select a service type from the list
2. Click **"Edit"**
3. Modify fields, add new ones, or remove existing ones
4. Click **"Save"** to apply changes

⚠️ **Note**: Changes to service types affect all existing services of that type.

## Search and Filtering

### Global Search

Use the search bar in the sidebar (⌘+K or Ctrl+K) to quickly find:
- Accounts by name, notes, or tags
- Services by name or tags

### Account Filtering

On the Accounts page:
- **Search**: Filter by account name or notes
- **Tag Filter**: Show only accounts with specific tags
- **View Mode**: Switch between grid and list views

### Service Filtering

On the Services page:
- **Search**: Filter by service name or tags
- **Service Type**: Filter by specific service types
- **Selection**: Use checkboxes for bulk operations

## Security Features

### Master Password

Your master password:
- Encrypts all data in your vault
- Cannot be recovered if forgotten
- Should be strong and unique

#### Changing Master Password
1. Go to **Settings**
2. Click **"Change Master Password"**
3. Enter your current password
4. Enter and confirm your new password
5. Click **"Change Password"**

### Auto-lock

Protects your vault when you're away:

#### Configuration
1. Go to **Settings**
2. Select auto-lock timer:
   - 5, 15, 30 minutes
   - 1, 2, 4 hours
   - Disabled
3. Changes apply immediately

#### Manual Lock
- Click the **"Lock Now"** button in the sidebar
- Vault locks immediately when you close the application

### Data Encryption

- **Algorithm**: AES-256 encryption
- **Key Derivation**: PBKDF2 with your master password
- **Storage**: All data encrypted at rest
- **Memory**: Sensitive data cleared when locked

## Import/Export

### Bulk Import

1. Go to **Services** page
2. Click **"Bulk Import"**
3. Choose import method:
   - **File Upload**: CSV, JSON, or text files
   - **Text Input**: Paste data directly
4. Configure import settings:
   - **Service Type**: What type of services to create
   - **Field Mapping**: Map columns to service fields
   - **Separator**: For CSV/text data
5. Preview and confirm import

### Export Data

1. Go to **Settings**
2. Click **"Export Data"**
3. Choose export format:
   - **JSON**: Complete data with structure
   - **CSV**: Tabular format for spreadsheets
4. Select what to export:
   - All data
   - Specific accounts or services
5. Download the export file

⚠️ **Security Note**: Exported data is not encrypted. Store export files securely.

## Settings

### General Settings

- **Language**: Switch between English and Ukrainian
- **Theme**: Light/dark mode (if available)
- **Auto-lock Timer**: Configure automatic locking

### Security Settings

- **Change Master Password**: Update your vault password
- **Lock Vault**: Manually lock the application

### Data Management

- **Export Data**: Create backups of your vault
- **Import Data**: Restore from backups or migrate data

### Application Settings

- **Auto-start**: Launch AccMan when system starts
- **Minimize to Tray**: Keep running in system tray
- **Update Notifications**: Get notified of new versions

## Keyboard Shortcuts

- **⌘+K / Ctrl+K**: Open global search
- **⌘+N / Ctrl+N**: Create new account
- **⌘+L / Ctrl+L**: Lock vault
- **⌘+, / Ctrl+,**: Open settings
- **Esc**: Close modals/dialogs

## Tips and Best Practices

### Organization
- Use consistent tagging schemes
- Create meaningful account names
- Group related services under single accounts

### Security
- Use unique, strong passwords for each service
- Enable 2FA wherever possible
- Regularly update your master password
- Export backups to secure locations

### Workflow
- Start with your most important accounts
- Use bulk import for migrating from other tools
- Regularly review and clean up unused services
- Take advantage of search and filtering features

## Troubleshooting

For common issues and solutions, see the [FAQ](faq.html) page.