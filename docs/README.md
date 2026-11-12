# AccMan Documentation

This directory contains the documentation website for AccMan, built with Jekyll and hosted on GitHub Pages.

## Structure

- `index.md` - Homepage with project overview
- `getting-started.md` - Installation and setup guide
- `user-guide.md` - Complete user manual
- `developer-guide.md` - Development and contribution guide
- `faq.md` - Frequently asked questions
- `contributing.md` - Contribution guidelines
- `_config.yml` - Jekyll configuration
- `assets/` - Static assets (CSS, images, etc.)

## Local Development

To run the documentation site locally:

1. Install Jekyll:
   ```bash
   gem install bundler jekyll
   ```

2. Install the gems listed in the existing `Gemfile`:
   ```bash
   cd docs
   bundle install
   ```

3. Serve locally:
   ```bash
   bundle exec jekyll serve
   ```

4. Open http://localhost:4000 in your browser

## Deployment

The site is deployed to GitHub Pages from this directory (see `_config.yml`).

## Contributing

To contribute to the documentation:

1. Edit the relevant `.md` files
2. Test locally if possible
3. Commit and push changes
4. GitHub Pages will automatically rebuild the site

For more details, see `contributing.md`.