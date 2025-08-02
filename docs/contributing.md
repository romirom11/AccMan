---
layout: default
title: Contributing
---

# Contributing to AccMan

Thank you for your interest in contributing to AccMan! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Contribution Guidelines](#contribution-guidelines)
- [Pull Request Process](#pull-request-process)
- [Style Guidelines](#style-guidelines)
- [Community](#community)

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:

### Our Pledge

We pledge to make participation in our project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards

**Positive behavior includes:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

**Unacceptable behavior includes:**
- Harassment, trolling, or discriminatory comments
- Publishing others' private information without permission
- Other conduct which could reasonably be considered inappropriate

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

**When submitting a bug report, include:**
- Clear, descriptive title
- Detailed description of the issue
- Steps to reproduce the problem
- Expected vs. actual behavior
- Screenshots or error messages
- Your operating system and AccMan version
- Any relevant configuration details

### Suggesting Features

Feature suggestions are welcome! Please:
- Check existing feature requests first
- Clearly describe the feature and its benefits
- Explain why this feature would be useful
- Consider the security implications
- Provide mockups or examples if applicable

### Contributing Code

We welcome code contributions! Areas where help is needed:

- **Bug fixes** - Fix reported issues
- **Feature implementation** - Build requested features
- **Performance improvements** - Optimize existing code
- **Security enhancements** - Strengthen security measures
- **UI/UX improvements** - Enhance user experience
- **Documentation** - Improve guides and comments
- **Testing** - Add or improve test coverage
- **Localization** - Translate to new languages

### Documentation

Help improve our documentation:
- Fix typos and grammatical errors
- Clarify confusing sections
- Add missing information
- Create tutorials and guides
- Improve code comments

### Translation

Help make AccMan available in more languages:
- Review existing translations
- Add new language support
- Update outdated translations
- Improve translation quality

## Development Setup

### Prerequisites

- **Node.js** 16+ and **pnpm**
- **Rust** (latest stable)
- **Git** for version control

### Getting Started

1. **Fork the repository** on GitHub

2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/AccMan.git
   cd AccMan
   ```

3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/romirom11/AccMan.git
   ```

4. **Install dependencies**:
   ```bash
   pnpm install
   ```

5. **Start development**:
   ```bash
   pnpm tauri dev
   ```

### Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/amazing-feature
   ```

2. **Start development**:
   ```bash
   pnpm tauri dev
   ```

3. **Make your changes**

4. **Test your changes**:
   ```bash
   pnpm test
   cargo test
   ```

5. **Commit your changes**:
   ```bash
   git commit -m "feat: add amazing feature"
   ```

6. **Push to your fork**:
   ```bash
   git push origin feature/amazing-feature
   ```

7. **Create a Pull Request**

## Contribution Guidelines

### Before You Start

- **Check existing issues** to avoid duplicate work
- **Discuss major changes** in an issue first
- **Keep changes focused** - one feature/fix per PR
- **Follow security best practices**
- **Consider backward compatibility**

### Code Quality

- **Write clean, readable code**
- **Add appropriate comments**
- **Follow existing patterns**
- **Include tests for new features**
- **Ensure all tests pass**
- **Update documentation as needed**

### Security Considerations

- **Never commit secrets** or sensitive data
- **Validate all user inputs**
- **Follow secure coding practices**
- **Consider security implications** of changes
- **Use established cryptographic libraries**

## Pull Request Process

### Before Submitting

1. **Update your branch** with latest upstream changes:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run all tests**:
   ```bash
   pnpm test
   cargo test
   ```

3. **Check code formatting**:
   ```bash
   pnpm lint
   cargo fmt --check
   cargo clippy
   ```

4. **Update documentation** if needed

### Pull Request Template

When creating a PR, include:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tests pass locally
- [ ] Added tests for new functionality
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### Review Process

1. **Automated checks** must pass
2. **Code review** by maintainers
3. **Testing** on multiple platforms
4. **Security review** for sensitive changes
5. **Merge** after approval

## Style Guidelines

### TypeScript/React

- Use **functional components** with hooks
- Follow **React best practices**
- Use **TypeScript strictly** - no `any` types
- Prefer **const assertions** and **type guards**
- Use **meaningful variable names**
- Keep **components small** and focused

```typescript
// Good
interface UserProps {
  user: User;
  onUpdate: (user: User) => void;
}

const UserCard: React.FC<UserProps> = ({ user, onUpdate }) => {
  const handleEdit = useCallback(() => {
    onUpdate({ ...user, lastModified: new Date() });
  }, [user, onUpdate]);

  return (
    <div className="user-card">
      <h3>{user.name}</h3>
      <button onClick={handleEdit}>Edit</button>
    </div>
  );
};
```

### Rust

- Follow **Rust conventions**
- Use **cargo fmt** for formatting
- Address **cargo clippy** warnings
- Handle **errors properly** with `Result<T, E>`
- Use **meaningful error types**
- Add **documentation comments**

```rust
/// Encrypts data using AES-256-GCM
/// 
/// # Arguments
/// * `data` - The data to encrypt
/// * `key` - The encryption key
/// 
/// # Returns
/// * `Ok(Vec<u8>)` - Encrypted data with nonce prepended
/// * `Err(CryptoError)` - If encryption fails
pub fn encrypt_data(data: &[u8], key: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| CryptoError::InvalidKey)?;
    
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, data)
        .map_err(|_| CryptoError::EncryptionFailed)?;
    
    let mut result = nonce.to_vec();
    result.extend_from_slice(&ciphertext);
    Ok(result)
}
```

### Commit Messages

Use **Conventional Commits** format:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(auth): add 2FA support for accounts
fix(ui): resolve button alignment issue
docs(api): update encryption documentation
```

### Documentation

- Use **clear, concise language**
- Include **code examples**
- Add **screenshots** for UI changes
- Update **relevant guides**
- Keep **API docs** current

## Community

### Communication Channels

- **GitHub Issues** - Bug reports and feature requests
- **GitHub Discussions** - Questions and general discussion
- **Pull Requests** - Code review and collaboration

### Getting Help

If you need help:
1. Check existing **documentation**
2. Search **GitHub issues** and discussions
3. Ask questions in **GitHub Discussions**
4. Tag maintainers if urgent

### Recognition

Contributors are recognized through:
- **GitHub contributors** list
- **Release notes** mentions
- **Special thanks** in documentation
- **Maintainer status** for significant contributors

## Development Tips

### Debugging

```bash
# Standard development
pnpm tauri dev

# Backend debugging with logs
RUST_LOG=debug pnpm tauri dev

# Specific module debugging
RUST_LOG=accman::storage=debug pnpm tauri dev
```

### Testing

```bash
# Run all tests
pnpm test
cargo test

# Watch mode for frontend
pnpm test:watch

# Coverage report
pnpm test:coverage
```

### Building

```bash
# Development build with hot reload
pnpm tauri dev

# Production build
pnpm tauri build

# Platform-specific build
pnpm tauri build --target x86_64-pc-windows-msvc
```

## Questions?

Don't hesitate to ask questions! We're here to help:

- **New to open source?** Check out [First Contributions](https://firstcontributions.github.io/)
- **Need help with Git?** See [Git Handbook](https://guides.github.com/introduction/git-handbook/)
- **Rust beginner?** Visit [The Rust Book](https://doc.rust-lang.org/book/)
- **React questions?** Check [React Documentation](https://reactjs.org/docs/)

Thank you for contributing to AccMan! 🎉