# Screenshots for AccMan Documentation

This folder contains screenshots of the AccMan application for use in documentation.

## Required Screenshots

To complete the README documentation, please add the following screenshots:

### 1. Dashboard Overview (`dashboard.png`)
- Main dashboard view showing account overview
- Should include sidebar navigation and main content area
- Recommended size: 1200x800px or similar

### 2. Account Management (`accounts.png`)
- Accounts list page showing multiple accounts
- Should demonstrate the account organization features
- Include search/filter functionality if visible

### 3. Service Configuration (`services.png`)
- Services management page
- Show service types and templates
- Demonstrate service linking capabilities

### 4. Account Details (`account-details.png`)
- Individual account view with details
- Show custom fields, 2FA codes, notes
- Demonstrate the account editing interface

## Screenshot Guidelines

### Technical Requirements
- **Format**: PNG (preferred) or JPG
- **Size**: Optimize for web (under 500KB each)
- **Resolution**: High DPI/Retina friendly (2x scale)
- **Dimensions**: Consistent aspect ratio, ~1200px width

### Content Guidelines
- **Use sample data**: Don't include real credentials
- **Clean interface**: Close unnecessary dialogs/popups
- **Good lighting**: Use light theme for better visibility
- **Highlight features**: Show key functionality clearly
- **Consistent styling**: Use same theme across all screenshots

### Privacy & Security
- ❌ **Never include real passwords or sensitive data**
- ❌ **Don't show actual email addresses or usernames**
- ✅ **Use placeholder data like 'john.doe@example.com'**
- ✅ **Use generic service names or well-known public services**
- ✅ **Blur or redact any potentially sensitive information**

## How to Take Screenshots

### macOS
```bash
# Full screen
Cmd + Shift + 3

# Selected area
Cmd + Shift + 4

# Specific window
Cmd + Shift + 4, then Space, then click window
```

### Windows
```bash
# Full screen
Print Screen

# Active window
Alt + Print Screen

# Selected area (Windows 10+)
Windows + Shift + S
```

### Linux
```bash
# Using GNOME Screenshot
gnome-screenshot

# Using scrot
scrot -s  # Select area
scrot -u  # Current window
```

## Image Optimization

After taking screenshots, optimize them:

### Online Tools
- [TinyPNG](https://tinypng.com/) - PNG compression
- [Squoosh](https://squoosh.app/) - Google's image optimizer
- [ImageOptim](https://imageoptim.com/) - macOS app

### Command Line
```bash
# Using ImageMagick
convert input.png -quality 85 -resize 1200x output.png

# Using pngquant
pngquant --quality=65-80 input.png --output output.png
```

## File Naming Convention

- Use lowercase with hyphens: `account-details.png`
- Be descriptive: `dashboard-overview.png` not `screen1.png`
- Include version if needed: `dashboard-v2.png`
- Use consistent naming across related screenshots

## Adding Screenshots

1. **Take screenshots** following the guidelines above
2. **Optimize images** for web use
3. **Save to this folder** with appropriate names
4. **Test in README** by viewing the rendered markdown
5. **Commit and push** to update documentation

## Alternative Placeholder

If screenshots are not ready yet, you can temporarily use placeholder images:

```markdown
<img src="https://via.placeholder.com/800x500/2c3e50/ffffff?text=AccMan+Dashboard" alt="AccMan Dashboard" width="800">
```

Replace with actual screenshots when available.