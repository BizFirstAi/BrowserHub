# BrowserHub

**Open-source browser automation platform** — web scraping, screenshots, PDF generation, TTS narration, lead discovery, and dataset management. Powered by [Playwright](https://playwright.dev/).

No cloud accounts, no API keys required for core features. Runs on your own machine.

---

## Features

| Module | What it does |
|--------|-------------|
| **Web Extractor** | Scrape pages for text, metadata, links, images, structured data (JSON-LD, Open Graph) |
| **Screenshots / PDF** | Full-page screenshots and PDFs via headless Chromium |
| **Visual Scanner** | Detect layout regressions, broken images, missing elements across a URL list |
| **Lead Discovery** | Scrape Yellow Pages, BBB, Manta, TripAdvisor, Angi and more — extract business contacts into datasets |
| **Dataset Management** | Organise scraped records into Projects → DataSets, view, filter, export as CSV or JSON |
| **TTS Narration** | Generate per-slide MP3 audio from `data-narration` attributes using Microsoft Edge neural voices (free, no API key) |
| **Video Studio** | Combine slide screenshots with TTS audio to produce narrated MP4 presentations |
| **Observability** | Real-time job metrics streamed via Socket.io |
| **Webhooks** | POST job completion events to any endpoint |

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- Windows, macOS, or Linux

### Install

```bash
git clone https://github.com/your-org/browser-hub.git
cd browser-hub/src/ui-js/browser-hub-ui

npm install
npm run setup        # downloads Playwright's Chromium browser (~130 MB)
```

### Configure

```bash
cp config/app.config.example.json config/app.config.json
```

Open `config/app.config.json` and set at minimum:

```json
{
  "adminKey": "your-strong-random-admin-key",
  "jwtSecret": "your-long-random-jwt-secret-at-least-32-chars"
}
```

> `config/app.config.json` is listed in `.gitignore` and will never be committed. Do not commit it.

### Start

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

For development with auto-reload:

```bash
npm run dev
```

---

## Authentication

BrowserHub supports three auth methods out of the box:

| Method | How to use |
|--------|-----------|
| **Guest / Test** | Click "Continue as Guest" on the login page. Good for local use. |
| **Google OAuth** | Set `googleClientId`, `googleClientSecret`, and `googleRedirectUri` in `app.config.json`. |
| **MetaMask / Web3** | Connect any EVM-compatible wallet via the browser extension. |
| **API Keys** | Generate keys in Settings → API Keys for programmatic access. |

---

## Lead Discovery Pipeline

BrowserHub ships with 8 pre-configured pipeline sources:

| Source | Type | API Key? |
|--------|------|---------|
| Yellow Pages | HTML scrape | No |
| Better Business Bureau | HTML scrape | No |
| Manta | HTML scrape | No |
| TripAdvisor | HTML scrape | No |
| Angi (Home Services) | HTML scrape | No |
| Yelp | API | Yes — `YELP_API_KEY` |
| Google Maps (Places) | API | Yes — `GOOGLE_MAPS_API_KEY` |
| Foursquare | API | Yes — `FOURSQUARE_API_KEY` |

Pipeline results are automatically normalised into a standard contact schema:

```json
{
  "company":  { "name": "Acme Dental", "category": "Dentist" },
  "contact":  { "phone": "(512) 555-0100", "website": "https://...", "address": { "city": "Austin" } },
  "signals":  { "rating": 4.5, "bbbGrade": "A+" },
  "meta":     { "source": "yellowpages", "sourceUrl": "https://...", "runId": "..." }
}
```

### Adding a custom source

Drop a JSON file into `pipeline/sources/` — no server restart needed. See [CONTRIBUTING.md](./CONTRIBUTING.md#adding-a-pipeline-source) for the schema.

---

## TTS Narration

BrowserHub uses **Microsoft Edge TTS** (the same neural voices as Windows Narrator) via the `msedge-tts` library. No Microsoft account or API key is required.

### Supported voices (selection)

| Voice ID | Description |
|---------|-------------|
| `en-US-JennyNeural` | US English, Female (default) |
| `en-US-GuyNeural` | US English, Male |
| `en-GB-SoniaNeural` | British English, Female |
| `en-AU-NatashaNeural` | Australian English, Female |
| `es-ES-ElviraNeural` | Spanish (Spain), Female |
| `fr-FR-DeniseNeural` | French, Female |
| `de-DE-KatjaNeural` | German, Female |

To use narration, add `data-slide` and `data-narration` attributes to your HTML presentation slides:

```html
<section data-slide="1" data-narration="Welcome to our product overview. In this presentation...">
  <!-- slide content -->
</section>
```

Then paste the URL (or local path like `C:\path\to\presentation.html`) into the **Narration** tab of the Web Extractor.

---

## API Reference

All API endpoints require a Bearer token (obtained from the login page) or a valid `X-Api-Key` header. Endpoints marked `[public]` are unauthenticated.

### Pipeline

| Method | Endpoint | Description |
|--------|---------|-------------|
| GET | `/api/pipeline/sources` | List all pipeline source manifests `[public]` |
| POST | `/api/pipeline/sources` | Add or update a source manifest |
| DELETE | `/api/pipeline/sources/:id` | Delete a source manifest |
| POST | `/api/pipeline/run` | Start a pipeline run → `{ runId }` |
| GET | `/api/pipeline/run/:runId` | Get run status and results |

**Start a run:**
```bash
curl -X POST http://localhost:3000/api/pipeline/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "sourceId": "yellowpages", "query": "dentist", "location": "Austin TX", "maxResults": 50 }'
```

### TTS Narration

| Method | Endpoint | Description |
|--------|---------|-------------|
| GET | `/api/tts/voices` | List available voices `[public]` |
| POST | `/api/tts/jobs` | Start a narration job → `{ jobId }` |
| GET | `/api/tts/jobs/:id` | Job status and slide results |
| GET | `/api/tts/jobs/:id/audio/:slide` | Stream slide MP3 |
| GET | `/api/tts/jobs/:id/download` | Download ZIP of all MP3s |

**Start a narration job:**
```bash
curl -X POST http://localhost:3000/api/tts/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/presentation.html",
    "voice": "en-US-JennyNeural",
    "outputFolder": "/path/to/save/mp3s"
  }'
```

### Datasets

| Method | Endpoint | Description |
|--------|---------|-------------|
| GET | `/api/studio/projects` | List projects (pass `?type=dataset&parentId=` to filter) |
| POST | `/api/studio/projects` | Create project or dataset |
| GET | `/api/studio/projects/:id/records` | List records (supports `?limit=` and `?offset=`) |
| POST | `/api/studio/projects/:id/records` | Append a record |

### Scanning

| Method | Endpoint | Description |
|--------|---------|-------------|
| POST | `/api/scan` | Start a visual scan job → `{ jobId }` |
| GET | `/api/scan/:jobId` | Scan status and results |
| POST | `/api/scan/:jobId/cancel` | Cancel a running scan |

---

## Project Structure

```
browser-hub-ui/
├── server.js                  # Express + Socket.io backend
├── index.html                 # Dashboard
├── login.html                 # Auth page
│
├── browser-studio/            # Web extractor + scanner UI
│   ├── extractor.html         # Main extractor (scrape, narrate, lead discovery)
│   ├── dataset.html           # Dataset browser
│   ├── scan.html              # Live scan view
│   ├── results.html           # Scan results viewer
│   ├── admin.html             # Admin panel
│   ├── observability.html     # Real-time metrics
│   ├── webhooks.html          # Webhook config
│   ├── scanner.js             # Playwright scan engine
│   ├── scraper/               # Page scraper module
│   └── browser/               # Stealth + user-agent rotation
│
├── pipeline/                  # Lead discovery pipeline
│   ├── runner.js              # Orchestrator
│   ├── sources/               # 8 pre-built source manifests (JSON)
│   └── steps/                 # html-scrape, api-call, normalize, dedupe
│
├── video-studio/              # Video + TTS module
│   ├── studio.html            # Visual project editor
│   ├── studio/                # Project manager + video builder
│   ├── tts/                   # Edge TTS service
│   └── html-to-slides/        # URL → screenshot → MP4 pipeline
│
├── auth/                      # Auth module (Metamask, Google, API keys)
├── dataset/                   # Data persistence (JSON file store)
├── metrics/                   # Observability emitter
├── css/                       # Design system (dark mode)
├── config/
│   ├── app.config.example.json  # Config template — copy and fill in
│   └── app.config.json          # Your config (gitignored)
└── Sample/                    # Example presentation for testing TTS
```

---

## Configuration Reference

All settings live in `config/app.config.json`:

| Key | Default | Description |
|-----|---------|-------------|
| `appTitle` | `"BrowserHub"` | Browser tab title and header text |
| `logoUrl` | `""` | URL to a logo image (leave empty for text title) |
| `adminKey` | — | Required. Admin API key for privileged operations. |
| `jwtSecret` | — | Required. Secret for signing JWT tokens. Use a random 32+ char string. |
| `googleClientId` | `""` | Google OAuth Client ID (optional) |
| `googleClientSecret` | `""` | Google OAuth Client Secret (optional) |
| `googleRedirectUri` | `"http://localhost:3000/api/auth/google/callback"` | Update for production |
| `rateLimits.maxUrlsPerJob` | `500` | Max URLs in a single scan/scrape job |
| `rateLimits.maxConcurrency` | `16` | Max parallel browser contexts |
| `rateLimits.maxJobsPerHour` | `100` | Per-IP job rate limit |
| `rateLimits.scrapeTimeoutMs` | `60000` | Per-page timeout (ms) |

---

## Deployment

### Local (default)

```bash
npm start              # PORT=3000 by default
PORT=8080 npm start    # custom port
```

### Docker

```dockerfile
FROM node:20-slim
RUN npx playwright install --with-deps chromium
WORKDIR /app
COPY . .
RUN npm ci
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t browser-hub .
docker run -p 3000:3000 \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/data:/app/data \
  browser-hub
```

Mount `config/` and `data/` as volumes so your settings and scraped data persist across container restarts.

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name hub.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";   # required for Socket.io
        proxy_set_header Host $host;
    }
}
```

---

## Roadmap

- [ ] .NET server implementation (same API surface, C# / ASP.NET Core)
- [ ] Additional pipeline sources (Clutch, G2, Houzz, HomeAdvisor)
- [ ] Scheduled pipeline runs (cron)
- [ ] Export to Google Sheets / Airtable
- [ ] Multi-node scraping cluster support
- [ ] Playwright Test integration for scan rules

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

[MIT](./LICENSE) — free to use, modify, and distribute.
