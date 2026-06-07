# BrowserHub — System Architecture

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                          Clients                               │
│   Browser UI (Vanilla JS)    Browser UI (React)   API clients  │
└──────────────────┬──────────────────┬─────────────────────────┘
                   │  HTTP / WebSocket │
          ┌────────▼──────────────────▼────────┐
          │            API Layer                │
          │  ┌──────────────────────────────┐  │
          │  │  Node.js (Express + Socket.io) │  │  ← reference impl
          │  └──────────────────────────────┘  │
          │  ┌──────────────────────────────┐  │
          │  │  .NET 9 (ASP.NET Core + SignalR)│  │  ← enterprise impl
          │  └──────────────────────────────┘  │
          └────────────────┬───────────────────┘
                           │
          ┌────────────────▼───────────────────┐
          │           Core Services             │
          │  PipelineRunner  ScanEngine  TTS   │
          │  Playwright (headless Chromium)     │
          └────────────────┬───────────────────┘
                           │
          ┌────────────────▼───────────────────┐
          │             Storage                 │
          │  JSON files (default)               │
          │  SQL Server / SQLite (.NET version) │
          └────────────────────────────────────┘
```

## The Four Implementations

### 1. `src/ui-js` — All-In-One (Reference)

A single Express process serves both the REST API and all HTML pages.

```
browser-hub-ui/
├── server.js              # Express routes + Socket.io handlers
├── index.html             # Dashboard
├── browser-studio/*.html  # UI pages (extractor, scan, admin, …)
├── pipeline/              # Lead discovery engine
│   ├── runner.js          # Orchestrates pipeline steps
│   ├── sources/*.json     # Source manifests (one per directory)
│   └── steps/*.js         # Step classes (html-scrape, api-call, …)
├── video-studio/          # TTS + ffmpeg video generation
├── auth/                  # Auth middleware
└── config/                # app.config.json
```

**When to use:** Local development, single-user deployments, prototyping new features.

### 2. `src/ui-react` — React Frontend (Planned)

Same Express backend as `ui-js`, but the frontend is React (Vite build, React Router, Zustand). The backend dev server proxies API calls so no CORS configuration is needed during development.

### 3. `src/api-node-server` — Headless API (Planned)

Strips out all static file serving and session middleware from `ui-js`. Exposes only the REST + Socket.io surface. Intended to be deployed as a container behind an API gateway. The UI versions connect to it over HTTP(S) with CORS.

**Why separate?**
- The API server can scale horizontally (multiple Playwright workers).
- The UI is served from a CDN or any static host.
- Different teams own different services.

**Architecture note:** This is the natural evolution of `ui-js`. You can migrate by extracting the API routes from `server.js` into this project and adding a CORS header.

### 4. `src/api-dot-net` — .NET 9 API (Planned)

Implements the same REST + SignalR surface using ASP.NET Core MVC 9 and Entity Framework Core. SQL Server for persistence. Playwright.NET for browser automation.

**When to use:** Enterprises that standardise on .NET, need Azure AD integration, or require SQL Server for compliance.

---

## API Contract

All four implementations honour this contract. Changes must be documented in [`api-reference.md`](./api-reference.md).

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Email + password login → JWT |
| POST | `/api/auth/google` | Google OAuth callback → JWT |
| GET | `/api/studio/projects` | List projects |
| POST | `/api/studio/projects` | Create project |
| GET | `/api/studio/projects/:id/datasets` | List datasets in project |
| POST | `/api/studio/datasets/:id/records` | Append records to dataset |
| POST | `/api/scan` | Start a scan job |
| GET | `/api/scan/:jobId` | Get scan job status |
| POST | `/api/pipeline/run` | Start a pipeline run |
| GET | `/api/pipeline/run/:runId` | Get pipeline run status |
| POST | `/api/tts/jobs` | Create a TTS narration job |
| GET | `/api/tts/jobs/:jobId` | Get TTS job status |
| GET | `/api/tts/jobs/:jobId/audio` | Download MP3 files (zip) |

### Socket.io / SignalR Events

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `pipeline-progress` | server → client | `{ runId, source, fetched }` | Records fetched from one source |
| `pipeline-done` | server → client | `{ runId, records[], rawFetched, total }` | All sources done |
| `pipeline-error` | server → client | `{ runId, error }` | Pipeline failed |
| `scan-progress` | server → client | `{ jobId, url, status }` | Per-URL scan update |
| `scan-done` | server → client | `{ jobId, results[] }` | Scan complete |
| `tts-progress` | server → client | `{ jobId, slideIndex, total }` | TTS slide rendered |
| `tts-done` | server → client | `{ jobId, files[] }` | All slides done |

---

## Pipeline Architecture

The Lead Discovery pipeline transforms a keyword + location into a list of business records.

```
User input:  keyword="dentist"  location="Austin TX"
                    │
                    ▼
           PipelineRunner (runner.js)
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
   YellowPages    BBB       Manta      ← sources/*.json
   step runner  step runner  step runner
         │          │          │
         ▼          ▼          ▼
   html-scrape  html-scrape  html-scrape  ← steps/html-scrape.js
   (Playwright) (Playwright) (Playwright)
         │          │          │
         └──────────┴──────────┘
                    │
                 normalize          ← steps/normalize.js
                    │
                  dedupe            ← steps/dedupe.js
                    │
                records[]   →  emitted via Socket.io  →  UI table
```

### Source Manifest Schema

```json
{
  "id": "yellowpages",
  "label": "Yellow Pages",
  "type": "html-scrape",
  "search": {
    "urlTemplate": "https://www.yellowpages.com/search?search_terms={keyword}&geo_location_terms={location}",
    "waitForSelector": "div.result"
  },
  "extract": {
    "listSelector": "div.result",
    "fields": {
      "name":    { "sel": "a.business-name span", "attr": "text" },
      "phone":   { "sel": "div.phones.phone.primary", "attr": "text" },
      "address": { "sel": "span.street-address", "attr": "text" }
    }
  }
}
```

Add a new data source by creating a JSON file in `pipeline/sources/`. No code change required.

---

## Authentication

Three auth modes are supported:

| Mode | Implementation | When to use |
|------|---------------|-------------|
| Email + password | JWT (stored in localStorage) | Default |
| Google OAuth 2.0 | OAuth 2.0 PKCE → JWT | Teams using Google Workspace |
| API keys | `X-Api-Key` header | Programmatic / CLI access |
| Guest mode | No auth, read-only | Demo / evaluation |

The .NET version will add Azure AD (OpenID Connect) as a fourth mode.

---

## Storage

### Node.js (default)

All data is stored as JSON files under `data/`:

```
data/
├── projects.json
├── datasets/
│   └── {datasetId}.json
└── jobs/
    └── {jobId}.json
```

No database required. Suitable for single-user and small-team use. For larger deployments, a MongoDB or PostgreSQL adapter can replace the JSON file storage without changing the service interface.

### .NET version

Entity Framework Core with SQL Server (or SQLite for local development). Migrations managed by EF Core. See `src/api-dot-net/README.md` for the schema.

---

## Deployment

### Node.js (single process)

```
node server.js
```

For production: PM2 with a `ecosystem.config.js`, behind nginx as a reverse proxy.

### .NET

Standard ASP.NET Core deployment: IIS, Azure App Service, or a self-contained executable. Includes a `Dockerfile` (planned).

### Docker Compose (planned)

```yaml
services:
  browser-hub-api:    # Node or .NET API
  browser-hub-ui:     # React static files via nginx
  sqlserver:          # .NET version only
```
