# BrowserHub

**Open-source browser automation platform** — web scraping, screenshots, TTS narration, lead discovery, and dataset management. Available in multiple implementation flavours so you can pick the stack that fits your team.

[![License: MIT + Attribution](https://img.shields.io/badge/license-MIT%20%2B%20Attribution-blue)](./LICENSE)

---

## What is BrowserHub?

BrowserHub is a self-hosted automation platform that wraps [Playwright](https://playwright.dev/) in a polished web UI and a clean REST API. You point it at URLs, it scrapes data, takes screenshots, generates PDFs, runs visual regression checks, discovers business leads, and produces narrated MP4 presentations — all without any cloud subscriptions or per-call fees.

The project ships in **four implementation flavours**. Pick the one that matches your stack:

| Folder | Stack | Status |
|--------|-------|--------|
| [`src/ui-js`](./src/ui-js/) | Node.js server + Vanilla JS / HTML UI (all-in-one) | **Available** |
| [`src/ui-react`](./src/ui-react/) | Node.js server + React UI (decoupled frontend) | Planned |
| [`src/api-node-server`](./src/api-node-server/) | Dedicated Node.js REST API (no embedded UI) | Planned |
| [`src/api-dot-net`](./src/api-dot-net/) | .NET 9 / ASP.NET Core MVC API + SQL Server | Planned |

All four expose the **same API surface** so the React UI and the Vanilla JS UI are interchangeable, and the Node.js API and the .NET API can serve the same frontend clients.

---

## Why four versions?

Because developer teams are not uniform:

- **Solo developer or startup** — grab `ui-js`. One `npm install`, one `node server.js`. Zero ceremony.
- **Frontend-focused team** — use `ui-react`. Write components in React, hit the same API endpoints.
- **Enterprise / .NET shop** — use `api-dot-net`. Full ASP.NET Core MVC, SQL Server persistence, standard enterprise deployment patterns. Familiar to C# teams and easy to plug into existing CI/CD pipelines.
- **Microservice architecture** — use `api-node-server` as a headless scraping service behind an API gateway, with any frontend on top.

Having all four in one repository also means:

1. Designers can prove a feature in `ui-js` before a larger team builds it properly in `ui-react`.
2. Backend decisions proven in Node.js can be re-implemented in .NET with a clear specification.
3. Community contributors pick the stack they know and improve that version without touching others.

---

## Feature Overview

| Feature | Description |
|---------|-------------|
| **Web Extractor** | Scrape metadata, headings, links, images, structured data (JSON-LD, Open Graph) from any page |
| **Screenshots / PDF** | Full-page screenshots and PDFs via headless Chromium |
| **Visual Scanner** | Detect layout regressions, broken images, missing elements |
| **Lead Discovery** | Scrape Yellow Pages, BBB, Manta, TripAdvisor, Angi and more — export to datasets |
| **Dataset Management** | Organise records into Projects → DataSets, paginate, export CSV/JSON |
| **TTS Narration** | Generate MP3 audio per slide using Microsoft Edge neural voices (free, no API key) |
| **Video Studio** | Combine screenshots with TTS audio → narrated MP4 presentations |
| **Webhooks** | POST job completion events to any endpoint |
| **Observability** | Real-time job metrics via Socket.io |
| **Auth** | Google OAuth, MetaMask/Web3, API keys, guest mode |

---

## Quick Start (Node.js version)

```bash
cd src/ui-js/browser-hub-ui
npm install
npm run setup        # installs Playwright Chromium

cp config/app.config.example.json config/app.config.json
# set adminKey and jwtSecret inside app.config.json

npm start            # http://localhost:3000
```

Full setup guide → [`src/ui-js/README.md`](./src/ui-js/README.md)

---

## Repository Layout

```
BrowserHub/
├── README.md               ← you are here
├── LICENSE                 ← MIT + Attribution
│
├── src/
│   ├── ui-js/              ← Node.js + Vanilla JS/HTML (all-in-one)
│   ├── ui-react/           ← Node.js API + React frontend (planned)
│   ├── api-node-server/    ← Dedicated Node.js REST API (planned)
│   └── api-dot-net/        ← ASP.NET Core MVC + SQL Server (planned)
│
├── Docs/                   ← Architecture, API reference, developer guides
├── Mockup/                 ← HTML interactive screen mockups for developers
└── Ai/                     ← AI plugin strategy (Phase 2 — not in Phase 1)
```

---

## Documentation

| Document | Description |
|---------|-------------|
| [`Docs/overview.md`](./Docs/overview.md) | Project goals and design philosophy |
| [`Docs/architecture.md`](./Docs/architecture.md) | System architecture across all four implementations |
| [`Docs/api-reference.md`](./Docs/api-reference.md) | Full REST API reference |
| [`Docs/pipeline-sources.md`](./Docs/pipeline-sources.md) | Lead discovery pipeline source schema |
| [`Docs/getting-started.md`](./Docs/getting-started.md) | Step-by-step setup guide |
| [`Mockup/index.html`](./Mockup/index.html) | Interactive screen mockups |
| [`Ai/README.md`](./Ai/README.md) | AI plugin architecture (Phase 2) |

---

## Contributing

Fork the repository, pick the implementation flavour you want to contribute to, and open a pull request against `dev`.

Each `src/` subfolder has its own `README.md` and `CONTRIBUTING.md` with stack-specific instructions.

For cross-cutting contributions (Docs, Mockup, Ai), open a PR at the root level.

---

## License

[MIT + Attribution](./LICENSE) — free to use and modify. You must retain the BizFirst logo and attribution in the UI. See the license file for details.
