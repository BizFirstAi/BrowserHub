# Changelog — BrowserHub

## v1.1.0 — 2026-06-07

### Lead Discovery Pipeline
- 8 pre-built pipeline sources: Yellow Pages, BBB, Manta, TripAdvisor, Angi, Yelp, Google Maps, Foursquare
- Normalised contact schema: company, contact, signals, meta
- Multi-select results with "Save Selected" or "Save All to DataSet"
- Socket.io streaming progress per pipeline run
- HTML scraper improved: waits for networkidle + waitForSelector before extracting (handles JS-rendered pages)
- Diagnostic logging when 0 results (page title, URL, body sample)

### TTS Narration
- Accepts local Windows file paths (C:\path\to\file.html) in addition to HTTP/HTTPS URLs
- outputFolder parameter — copies generated MP3s to a user-specified directory on completion

### Dataset Management
- Projects → DataSets hierarchy via /api/studio/projects
- dataset.html — standalone dataset browser page
- Save scrape results or pipeline leads to any dataset

---

## v1.0.0 — 2026-06-02

### Initial Release — Visual Scanner + Web Extractor

- Playwright headless Chromium scanning engine
- Rule-based element detection with extensible rules engine
- Real-time scan progress via Socket.io
- CSV export of findings; persistent scan history (JSON file store)
- Full-page screenshots, PDF generation, bulk capture
- TTS narration via Microsoft Edge neural voices (msedge-tts, no API key required)
- Video Studio: combine slide screenshots with TTS audio → MP4
- Web Extractor: scrape metadata, headings, links, images, structured data (JSON-LD, Open Graph)
- Auth: Google OAuth, MetaMask/Web3 wallet, API keys, guest mode
- Dark-mode design system
- Webhook support for async job notifications
- Real-time observability dashboard