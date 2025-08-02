# AccMan Documentation

This directory contains the documentation website for AccMan, built with Jekyll and hosted on GitHub Pages.

## Structure

- `index.md` - Homepage with project overview
- `getting-started.md` - Installation and setup guide
- `user-guide.md` - Complete user manual
- `developer-guide.md` - Development and contribution guide
- `faq.md` - Frequently asked questions
- `contributing.md` - Contribution guidelines
- `github-pages-setup.md` - Instructions for setting up GitHub Pages
- `_config.yml` - Jekyll configuration
- `assets/` - Static assets (CSS, images, etc.)

## Local Development

To run the documentation site locally:

1. Install Jekyll:
   ```bash
   gem install bundler jekyll
   ```

2. Create Gemfile:
   ```bash
   cd docs
   bundle init
   bundle add jekyll
   bundle add minima
   ```

3. Serve locally:
   ```bash
   bundle exec jekyll serve
   ```

4. Open http://localhost:4000 in your browser

## Deployment

The site is automatically deployed to GitHub Pages when changes are pushed to the main branch. See `github-pages-setup.md` for detailed setup instructions.

## Contributing

To contribute to the documentation:

1. Edit the relevant `.md` files
2. Test locally if possible
3. Commit and push changes
4. GitHub Pages will automatically rebuild the site

For more details, see `contributing.md`.