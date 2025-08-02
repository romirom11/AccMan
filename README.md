# 🔐 AccMan - Account Manager

<div align="center">
  <img src="accman.png" alt="AccMan Logo" width="128" height="128">
  
  **Secure and intuitive desktop application for managing your accounts and services.**
  
  [![Release](https://github.com/romirom11/AccMan/actions/workflows/release.yml/badge.svg)](https://github.com/romirom11/AccMan/actions/workflows/release.yml)
  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/romirom11/AccMan/releases)
</div>

## About

AccMan is a secure and intuitive desktop application for managing your accounts and services. It provides a simple and efficient way to store, access, and organize your login credentials across different platforms. 

## ✨ Features

- 🔒 **Secure Storage** - Your data is encrypted and stored locally
- 🌐 **Multi-Service Support** - Manage accounts across different platforms
- 🎨 **Modern UI** - Clean and intuitive interface built with React
- 🔄 **Auto-Updates** - Stay up-to-date with the latest features
- 🌍 **Internationalization** - Available in multiple languages (English, Ukrainian)
- 📱 **Cross-Platform** - Works on Windows, macOS, and Linux
- 🚀 **Fast Performance** - Built with Tauri for optimal speed and security
- 🔑 **2FA Key Management** - Store and manage 2FA keys for secure authentication

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
3. Run: `./AccMan.AppImage`

## 🛠️ Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [pnpm](https://pnpm.io/) (v9 or later)
- [Rust](https://rustlang.org/) (latest stable)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/romankudin/AccMan.git
   cd AccMan
   ```

2. **Install dependencies**
   ```bash
   # Install root dependencies (Tauri CLI)
   pnpm install
   
   # Install frontend dependencies
   pnpm --dir src install
   ```

3. **Start development server**
   ```bash
   pnpm tauri dev
   ```

### Build

```bash
# Build for production
pnpm build

# Build Tauri app
pnpm tauri build
```

## 🏗️ Project Structure

```
AccMan/
├── src/                    # Frontend React application
│   ├── components/         # React components
│   ├── pages/             # Application pages
│   ├── hooks/             # Custom React hooks
│   ├── stores/            # State management
│   ├── locales/           # Internationalization files
│   └── api/               # API layer
├── src-tauri/             # Tauri backend (Rust)
│   ├── src/               # Rust source code
│   ├── icons/             # Application icons
│   └── Cargo.toml         # Rust dependencies
└── .github/workflows/     # CI/CD workflows
```

## 🔧 Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Vite
- **Backend**: Rust, Tauri
- **State Management**: Custom stores
- **Styling**: Tailwind CSS, shadcn/ui components
- **Internationalization**: i18next
- **Build Tool**: Vite
- **Package Manager**: pnpm

## 🌍 Internationalization

AccMan supports multiple languages:
- 🇺🇸 English
- 🇺🇦 Ukrainian

To add a new language:
1. Create a new folder in `src/locales/`
2. Add translation files
3. Update the i18n configuration

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Tauri](https://tauri.app/) - For the amazing framework
- [React](https://reactjs.org/) - For the UI library
- [Tailwind CSS](https://tailwindcss.com/) - For the styling framework
- [shadcn/ui](https://ui.shadcn.com/) - For the beautiful components

## 📞 Support

If you have any questions or need help:
- 🐛 [Report a bug](https://github.com/romirom11/AccMan/issues/new?template=bug_report.md)
- 💡 [Request a feature](https://github.com/romirom11/AccMan/issues/new?template=feature_request.md)
- 💬 [Start a discussion](https://github.com/romirom11/AccMan/discussions)

---

<div align="center">
  Made with ❤️ by Roman Kudin
</div>