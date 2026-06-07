# BrowserHub — Node.js + Vanilla JS (All-in-One)

> **Status: Alpha / Active Development** — Core features work. Community PRs welcome to complete and stabilise.

This is the reference implementation of BrowserHub. A single Node.js/Express process serves both the API and the HTML/CSS/JS frontend. No build step, no bundler. Clone it, `npm install`, and run.

## Why this version exists

This is the fastest way to run BrowserHub locally and the best starting point for contributors. Because there is no framework overhead, every line of code is directly readable:

- `server.js` — the entire backend in one file. Read it top to bottom.
- `browser-studio/*.html` — each UI page is self-contained HTML + inline `<script>`. No components, no props, no virtual DOM.
- `pipeline/sources/*.json` — add a data source by dropping in a JSON file. No code change required.

Teams who want a React frontend or a .NET backend will find it much easier to build on top of a working specification than from scratch.

## Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js 18+, Express 4, Socket.io 4 |
| Browser automation | Playwright (Chromium) |
| Stealth | playwright-extra + puppeteer-extra-plugin-stealth |
| TTS | msedge-tts (Microsoft Edge neural voices, free) |
| Video | ffmpeg-static + @ffprobe-installer/ffprobe |
| Auth | JWT (jsonwebtoken), Google OAuth 2.0, MetaMask/ethers.js |
| Storage | Local JSON files (no database required) |
| Frontend | Vanilla HTML, CSS variables, Socket.io client |

## Setup

```bash
npm install
npm run setup          # installs Playwright Chromium (~130 MB)

cp config/app.config.example.json config/app.config.json
# open app.config.json and set adminKey + jwtSecret

npm start              # http://localhost:3000
npm run dev            # auto-restart on file change (nodemon)
```

## Folder Structure

```
browser-hub-ui/
├── server.js                  # Express + Socket.io backend (~2000 lines)
├── index.html                 # Dashboard
├── login.html                 # Auth
│
├── browser-studio/            # All browser automation UI pages
│   ├── extractor.html         # Main extractor: scrape, TTS, lead discovery, dataset
│   ├── dataset.html           # Dataset browser
│   ├── scan.html              # Live scan progress
│   ├── results.html           # Results viewer + CSV export
│   ├── admin.html             # Admin panel
│   ├── observability.html     # Real-time metrics
│   ├── scanner.js             # Playwright scan engine
│   └── scraper/page-scraper.js  # Page scraper (metadata, text, links, images)
│
├── pipeline/                  # Lead discovery
│   ├── runner.js              # Pipeline orchestrator
│   ├── sources/*.json         # 8 pre-built sources (add your own here)
│   └── steps/                 # html-scrape, api-call, normalize, dedupe
│
├── video-studio/              # TTS narration + video generation
│   ├── studio.html            # Visual project editor
│   └── tts/edge-tts-service.js
│
├── auth/index.js              # Auth module
├── config/
│   ├── app.config.example.json  ← copy this
│   └── app.config.json          ← your settings (gitignored)
└── css/main.css               # Design system (dark mode)
```

## How to Contribute

See [`../../README.md`](../../README.md) for the project vision and [`CONTRIBUTING.md`](./browser-hub-ui/CONTRIBUTING.md) for code standards.

Areas where PRs are most needed:

- [ ] Fix CSS selector accuracy for Manta, TripAdvisor, Angi pipeline sources
- [ ] Add pagination to the dataset records view
- [ ] Add export to Google Sheets
- [ ] Improve scanner rule types (beyond background-color)
- [ ] Add scheduled pipeline runs
- [ ] Write automated tests (Playwright Test)

## Relationship to Other Versions

This version is the **specification** for all other versions. The React UI (`ui-react`) should expose the same pages and call the same API endpoints. The .NET API (`api-dot-net`) should implement the same REST routes. If you change the API here, document it in `../../Docs/api-reference.md`.
