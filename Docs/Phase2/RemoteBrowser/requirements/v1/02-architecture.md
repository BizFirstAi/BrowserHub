# BrowserHub LiveBrowser — System Architecture
## Requirements v1 · Phase 2 · Remote Browser Module

---

## 1. Module Placement in BrowserHub

LiveBrowser is a **self-contained sub-module** added to BrowserHub's existing Node.js server. It does not replace or modify any Phase 1 functionality. All additions are additive.

```
src/ui-js/browser-hub-ui/
├── server.js                        ← Register LiveBrowser routes here (minimal changes)
├── browser-studio/
│   ├── live-browser/                ← NEW MODULE ROOT
│   │   ├── session-manager.js       ← Manages all active BrowserSession objects
│   │   ├── browser-session.js       ← A single stateful Playwright session
│   │   ├── capture-engine.js        ← Page element snapshot/capture logic
│   │   ├── command-runner.js        ← Executes individual commands against a session
│   │   ├── page-tools.js            ← Eight stateless one-shot tools
│   │   ├── routes.js                ← Express router — all /api/live-browser/* routes
│   │   ├── mcp-server.js            ← MCP server (stdio + httpStream transports)
│   │   └── errors.js                ← Structured error codes and factory functions
│   └── scraper/
│       └── page-scraper.js          ← Existing — reuse browser pool utilities where applicable
```

**Changes to `server.js`:** Two additions only.

```js
// Mount LiveBrowser routes
const liveBrowserRoutes = require('./browser-studio/live-browser/routes');
app.use('/api/live-browser', liveBrowserRoutes);
```

```js
// Optionally start MCP server if configured
if (config.liveBrowser?.mcp?.enabled) {
  require('./browser-studio/live-browser/mcp-server').start(config.liveBrowser.mcp);
}
```

---

## 2. Core Components

### 2.1 SessionManager

A singleton that owns all active `BrowserSession` objects. Responsibilities:

- **Create** — Launch a new Playwright `BrowserContext`, assign a session ID (UUID v4), record owner (user ID from JWT/API key)
- **Retrieve** — Look up a session by ID, enforce ownership (caller must own the session)
- **Idle timeout** — A `setInterval` sweep every 60 seconds terminates sessions idle longer than `config.liveBrowser.sessionTimeoutMs` (default: 600 000 ms / 10 min)
- **Capacity enforcement** — Reject new sessions if `activeSessions.size >= config.liveBrowser.maxSessions`
- **Per-user cap** — Reject if a single user already has `>= config.liveBrowser.maxSessionsPerUser` active sessions
- **Graceful shutdown** — On process exit, close all open Playwright contexts

State storage: in-memory `Map<sessionId, BrowserSession>`. Session metadata (ID, owner, created time, last active time, status) is also written to `data/live-browser/sessions/{sessionId}.json` so the admin panel can display it.

### 2.2 BrowserSession

Wraps a single Playwright `BrowserContext` and its primary `Page`. Exposes the command interface used by `CommandRunner`.

Properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | UUID v4 |
| `ownerId` | string | User ID from auth |
| `context` | Playwright.BrowserContext | The isolated browser context |
| `page` | Playwright.Page | The active page (top-level) |
| `createdAt` | Date | Session creation time |
| `lastActiveAt` | Date | Updated on every command |
| `status` | `'active'` \| `'closed'` \| `'error'` | Current state |
| `history` | string[] | Ordered list of URLs visited |

A `BrowserSession` does **not** hold business logic. It is a thin stateful wrapper. All logic lives in `CaptureEngine` and `CommandRunner`.

### 2.3 CaptureEngine

Produces **captures** — structured snapshots of the current page state. A capture replaces raw HTML for the purpose of AI-driven interaction: it returns a compact, selector-indexed list of every element the caller might want to interact with or read.

A capture contains:

```json
{
  "url": "https://example.com/checkout",
  "title": "Checkout — Example Store",
  "capturedAt": "2026-06-16T09:14:00Z",
  "elements": [
    {
      "index": 1,
      "tag": "input",
      "type": "email",
      "label": "Email address",
      "placeholder": "you@example.com",
      "selector": "[data-hub-idx='1']",
      "visible": true,
      "interactive": true
    },
    {
      "index": 2,
      "tag": "button",
      "text": "Continue to shipping",
      "selector": "[data-hub-idx='2']",
      "visible": true,
      "interactive": true
    }
  ],
  "text": "Checkout\nEmail address\nContinue to shipping",
  "elementCount": 2
}
```

**Selector strategy:** On capture, `CaptureEngine` injects a temporary `data-hub-idx` attribute onto every captured element. Selectors returned in the capture use this attribute (`[data-hub-idx='N']`). This makes selectors stable for the lifetime of the current page state and immune to DOM position shifts. Attributes are removed on navigation.

Element selection criteria — include elements that are:
- Visible in the viewport or near-viewport (within 1.5× viewport height)
- One of: `a`, `button`, `input`, `select`, `textarea`, `[role=button]`, `[role=link]`, `[role=checkbox]`, `[role=menuitem]`, `[tabindex]`, headings (`h1`–`h6`), `img` with alt text, `label`, `p` (text blocks, trimmed to 300 chars)

`maxElements` parameter (default: 200) caps capture output for very large pages.

### 2.4 CommandRunner

Receives a command object `{ method, params }` and executes it against a `BrowserSession`. Returns a structured result or a structured error.

Stateful commands (require a session): `navigate`, `capture`, `extract`, `source`, `execute`, `tap`, `fill`, `choose`, `toggle`, `point`, `slide`, `awaitElement`, `awaitLoad`, `awaitDelay`, `awaitRequest`, `awaitResponse`, `liveView`, `end`

All commands are async. `CommandRunner` updates `session.lastActiveAt` on every call.

**Batch execution:** When a caller sends a `commands` array, `CommandRunner` executes each in sequence within the same session. Execution stops immediately on first error; remaining commands are skipped.

### 2.5 PageTools

Eight stateless functions. Each receives parameters, launches an ephemeral Playwright page, performs the task, returns the result, and closes the page. No session ID is involved.

These reuse BrowserHub's existing stealth and proxy layer (`page-scraper.js`) so they inherit bot-detection evasion automatically.

| Tool | Function | Returns |
|------|----------|---------|
| `hub_fetch` | Fetch a single page with smart fallback (direct → stealth → wait for element) | Structured content |
| `hub_crawl` | Crawl a site from a seed URL, scrape every discovered page up to a depth/page limit | Array of page results |
| `hub_audit` | Run a Lighthouse performance/accessibility/SEO audit | Audit report object |
| `hub_map` | Discover all URLs on a site via sitemap.xml + link extraction | URL array |
| `hub_export` | Export a page as HTML, PDF, PNG, or offline ZIP | Binary file or base64 |
| `hub_search` | Web search with optional per-result page fetch | Search result array |
| `hub_download` | Trigger and capture a browser-initiated file download | File binary + metadata |
| `hub_script` | Run custom Playwright JavaScript against a page | Arbitrary return value |

### 2.6 Routes

All LiveBrowser HTTP routes live under `/api/live-browser`. The router is a standard Express Router, mounted in `server.js`. Every route validates the auth token (JWT or API key) using BrowserHub's existing auth middleware before any browser code runs.

### 2.7 MCP Server

An optional process (or in-process HTTP endpoint) that translates the Model Context Protocol into `CommandRunner` and `PageTools` calls. Covered in full in Document 05.

---

## 3. Session Lifecycle

```
Caller                    BrowserHub                     Playwright
  │                           │                               │
  │  POST /api/live-browser/sessions                          │
  │ ─────────────────────────►│                               │
  │                           │  browser.newContext()         │
  │                           │ ─────────────────────────────►│
  │                           │◄─────────────────────────────┤
  │◄─────────────────────────┤  { sessionId, status }        │
  │                           │                               │
  │  POST /sessions/:id/run   │                               │
  │  { method: "navigate" }   │                               │
  │ ─────────────────────────►│  page.goto(url)               │
  │                           │ ─────────────────────────────►│
  │◄─────────────────────────┤  { url, title, status }       │
  │                           │                               │
  │  POST /sessions/:id/run   │                               │
  │  { method: "capture" }    │                               │
  │ ─────────────────────────►│  inject idx attrs + query DOM │
  │                           │ ─────────────────────────────►│
  │◄─────────────────────────┤  { elements: [...] }          │
  │                           │                               │
  │  POST /sessions/:id/run   │                               │
  │  { method: "tap",         │                               │
  │    params: { selector }}  │                               │
  │ ─────────────────────────►│  page.click(selector)         │
  │                           │ ─────────────────────────────►│
  │◄─────────────────────────┤  { ok: true }                 │
  │                           │                               │
  │  POST /sessions/:id/run   │                               │
  │  { method: "end" }        │                               │
  │ ─────────────────────────►│  context.close()              │
  │                           │ ─────────────────────────────►│
  │◄─────────────────────────┤  { closed: true }             │
```

**Idle timeout path:**

```
SessionManager sweep (every 60s)
  │
  ├─ For each session where (now - lastActiveAt) > sessionTimeoutMs
  │    │
  │    ├─ context.close()
  │    ├─ session.status = 'closed'
  │    ├─ Write tombstone to data/live-browser/sessions/{id}.json
  │    └─ Emit Socket.io event: 'live-browser-session-expired' { sessionId }
```

---

## 4. Real-Time Events (Socket.io)

LiveBrowser emits events on the existing BrowserHub Socket.io channel. Clients subscribe by connecting to the existing Socket.io server — no new server needed.

| Event | Payload | When |
|-------|---------|------|
| `live-browser-session-created` | `{ sessionId, ownerId }` | Session opened |
| `live-browser-navigated` | `{ sessionId, url, title }` | After successful `navigate` |
| `live-browser-captured` | `{ sessionId, elementCount, url }` | After `capture` |
| `live-browser-error` | `{ sessionId, code, message, method }` | Any command error |
| `live-browser-session-closed` | `{ sessionId, reason }` | Session ended (manual or timeout) |
| `live-browser-session-expired` | `{ sessionId }` | Idle timeout triggered |

---

## 5. Data Storage

Session metadata is written to JSON files in BrowserHub's existing `data/` directory:

```
data/
└── live-browser/
    └── sessions/
        └── {sessionId}.json
```

Schema of a session file:

```json
{
  "id": "a1b2c3d4-...",
  "ownerId": "user_abc",
  "status": "active",
  "createdAt": "2026-06-16T09:00:00Z",
  "lastActiveAt": "2026-06-16T09:14:00Z",
  "closedAt": null,
  "closeReason": null,
  "history": [
    "https://example.com",
    "https://example.com/login",
    "https://example.com/dashboard"
  ]
}
```

Active sessions write to this file on every `navigate` command (history update) and on close. The file is not written on every command — only on state changes — to keep I/O overhead low.

---

## 6. Configuration

Added to `app.config.json` under a `liveBrowser` key:

```json
{
  "liveBrowser": {
    "enabled": true,
    "maxSessions": 20,
    "maxSessionsPerUser": 3,
    "sessionTimeoutMs": 600000,
    "capture": {
      "maxElements": 200,
      "viewportWidth": 1280,
      "viewportHeight": 800
    },
    "mcp": {
      "enabled": false,
      "transport": "httpStream",
      "port": 7420
    }
  }
}
```

All fields are optional. Defaults are applied in code if the `liveBrowser` key is absent.

---

## 7. Security Considerations

- **Ownership enforcement:** Every route checks that the authenticated user is the owner of the requested session. A user cannot run commands against another user's session.
- **Admin override:** Users with the `admin` role can view and close any session (for the admin panel).
- **No shell execution:** `execute` (JavaScript in page context) runs inside the Playwright page sandbox, not in Node.js. Playwright isolates page JS from the host process.
- **Resource limits:** Max sessions and per-user caps prevent runaway resource consumption.
- **Input validation:** All route handlers validate required parameters and reject malformed requests before any Playwright API is called.
- **Timeout enforcement:** Idle sessions are unconditionally terminated, preventing indefinitely open browser contexts.
