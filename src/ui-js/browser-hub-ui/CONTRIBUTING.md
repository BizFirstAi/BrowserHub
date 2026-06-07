# Contributing to BrowserHub

Thank you for your interest in contributing. This document covers how to get started, the development workflow, and what we look for in pull requests.

## Development Setup

```bash
git clone https://github.com/your-org/browser-hub.git
cd browser-hub/src/ui-js/browser-hub-ui

npm install
npm run setup          # installs Playwright Chromium browser

cp config/app.config.example.json config/app.config.json
# Edit app.config.json — set adminKey and jwtSecret before starting

npm start              # http://localhost:3000
```

## Branching Model

| Branch | Purpose |
|--------|---------|
| `main` | Stable releases only |
| `dev` | Integration branch — target all PRs here |
| `feature/<name>` | New feature work |
| `fix/<name>` | Bug fixes |

All pull requests should target `dev`, not `main`.

## Code Style

- **JavaScript**: plain Node.js / browser JS — no transpiler, no bundler. Keep it readable.
- **HTML UI**: vanilla JS and HTML. Avoid adding framework dependencies to frontend pages.
- **No comments** that describe *what* the code does — only *why* when the reason is non-obvious.
- **No auto-commits** — all commits are intentional and descriptive.

## Pull Request Checklist

- [ ] Code runs locally with `npm start`
- [ ] New pipeline sources include a `waitForSelector` hint and were tested against the live site
- [ ] No secrets, API keys, or private URLs committed
- [ ] `config/app.config.json` is listed in `.gitignore` (never commit it)
- [ ] PR description explains the *why*, not just the *what*

## Reporting Issues

Open a GitHub Issue with:
1. Steps to reproduce
2. Expected vs. actual behaviour
3. Node.js version (`node -v`) and OS
4. Relevant server log output

## Adding a Pipeline Source

Create a new JSON file under `pipeline/sources/`:

```json
{
  "id": "my-source",
  "name": "My Source",
  "type": "html",
  "description": "One line describing what this source covers.",
  "rateLimit": { "delayMs": 3000 },
  "search": {
    "urlTemplate": "https://example.com/search?q={{query}}&loc={{location}}&page={{page}}",
    "startPage": 1,
    "maxPages": 5,
    "waitForSelector": "div.result-card"
  },
  "extract": {
    "listSelector": "div.result-card",
    "fields": {
      "name":  { "sel": "h2 a", "attr": "text" },
      "phone": { "sel": "a[href^='tel:']", "attr": "text" },
      "url":   { "sel": "h2 a", "attr": "href" }
    }
  },
  "outputMap": {
    "company.name":  "name",
    "contact.phone": "phone",
    "meta.sourceUrl": "url",
    "meta.source":   "my-source"
  }
}
```

Test with `POST /api/pipeline/run` before submitting. Include evidence (field counts, sample record) in your PR description.

## License

By contributing, you agree your code will be licensed under the [MIT License](./LICENSE).
