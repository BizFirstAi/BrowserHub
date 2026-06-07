# BrowserHub — Project Overview

## What is BrowserHub?

BrowserHub is a self-hosted browser automation platform. It wraps Playwright's headless Chromium engine in a polished multi-page web UI and a clean REST/Socket.io API, so individuals and teams can:

- Scrape structured data from any website without writing custom scripts
- Run visual regression scans to detect layout changes
- Discover business leads from public directories
- Produce narrated video presentations from web content
- Manage and export data as structured datasets

Everything runs on your own machine or server. There are no cloud subscriptions, no per-call fees, and no data leaves your infrastructure.

## Design Philosophy

**Self-contained.** The reference implementation (`src/ui-js`) requires only Node.js and a single `npm install`. No database, no message broker, no infrastructure setup.

**Readable above all else.** Each file does one job. The entire backend lives in `server.js`. Each UI page is a self-contained HTML file. A developer who has never seen the project before should be able to understand any individual piece in under fifteen minutes.

**Specification-first.** The Vanilla JS implementation in `src/ui-js` is the contract for all other versions. The API shape, the Socket.io event names, the JSON source manifest format — these are defined there and documented here. The React UI, the dedicated Node API, and the .NET API are re-implementations of that same contract, not independent products.

**No lock-in.** Every export format is open (CSV, JSON). The source manifest format is a plain JSON file anyone can write. The TTS uses Microsoft Edge neural voices, which are free and require no API key. The video generation uses `ffmpeg`, which is open source.

**AI is optional.** Phase 1 ships with zero AI dependencies. AI features (content classification, lead scoring, voice synthesis improvements, intelligent scraping) are designed as a plugin layer added in Phase 2, so teams that do not want AI can run the platform with no AI-related setup.

## Goals

### Phase 1 — Core Platform (Current)

- Reliable headless browser automation (scraping, screenshots, PDFs, forms)
- Lead discovery pipeline with configurable JSON source manifests
- Dataset management (projects, datasets, records, CSV/JSON export)
- TTS narration (Microsoft Edge neural voices)
- Video generation (screenshots + audio → MP4)
- REST API + Socket.io streaming for real-time job progress
- Auth: JWT, Google OAuth, API keys
- Basic observability (job counts, durations)

**Status:** Alpha. The Node.js + Vanilla JS version is the working implementation. Several pipeline sources and UI flows are still being stabilised. See `CONTRIBUTING.md` in `src/ui-js/browser-hub-ui/` for known gaps.

### Phase 2 — AI as Plugin

- LLM-powered content classification (auto-tag scraped records)
- Lead scoring (rank leads by relevance using embeddings or a classifier)
- Intelligent wait strategy (ask the model what selector to wait for)
- Voice synthesis improvements (custom voice cloning, emotion)
- Scheduled runs with AI-generated summaries

See [`../Ai/README.md`](../Ai/README.md) for the plugin architecture.

### Phase 3 — Collaboration

- Multi-user workspaces
- Shared datasets
- Permission model (owner / editor / viewer)
- Webhooks to Slack, Teams, etc.
- Cloud deployment guides (AWS, Azure, Railway, Fly.io)

## Non-Goals

- **Not a replacement for purpose-built scraping tools.** For extreme scale (millions of pages), use a dedicated crawling platform.
- **Not a browser proxy.** BrowserHub drives a headless browser locally; it is not a MITM proxy.
- **Not a CAPTCHA solver.** The stealth plugin helps avoid bot detection but BrowserHub does not solve CAPTCHAs.
- **Not a cloud service.** BrowserHub is always self-hosted.

## Intended Users

- Independent developers and researchers scraping data for personal projects
- Small agencies automating client lead generation
- Enterprise teams building internal data pipelines on .NET infrastructure
- Open source contributors who want to learn Playwright automation by working on a real project
