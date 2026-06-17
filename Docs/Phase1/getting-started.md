# BrowserHub — Getting Started

## Prerequisites

- Windows 10+, macOS 12+, or Ubuntu 20.04+
- Node.js 18 or higher (`node --version`)
- Git

---

## Option 1: Node.js + Vanilla JS (Recommended — Start Here)

This is the working reference implementation. Get it running first before exploring other versions.

### Step 1: Clone and install

```bash
git clone https://github.com/bizfirst/browser-hub.git
cd browser-hub/src/ui-js/browser-hub-ui
npm install
```

### Step 2: Install Playwright Chromium

```bash
npm run setup
# This downloads ~130 MB of Chromium. Run once.
```

### Step 3: Configure

```bash
cp config/app.config.example.json config/app.config.json
```

Open `config/app.config.json` and set at minimum:

```json
{
  "adminKey": "choose-a-strong-password",
  "jwtSecret": "choose-a-long-random-string-at-least-32-chars",
  "port": 3000
}
```

> Never commit `app.config.json` — it is already in `.gitignore`.

### Step 4: Start

```bash
npm start
# Server running at http://localhost:3000
```

For auto-restart on file changes (development):

```bash
npm run dev
```

### Step 5: Log in

Open `http://localhost:3000` in your browser. Use the admin password you set in `adminKey`.

---

## Quick Feature Tour

### Web Extractor

1. Click **Extractor** in the sidebar.
2. Enter a URL in the input field, e.g. `https://example.com`.
3. Click **Extract**.
4. Metadata (title, description, Open Graph, JSON-LD, links, images) appears in the results panel.
5. Click **Screenshot** to capture a full-page image.

### Lead Discovery

1. Click **Leads** in the sidebar.
2. Select sources (Yellow Pages, BBB, etc.).
3. Enter a keyword, e.g. `dentist`, and a location, e.g. `Austin TX`.
4. Click **Run Pipeline**.
5. Results stream in as each source completes.
6. Select records using the checkboxes and click **Save Selected** to add them to a dataset.

### TTS Narration

1. Click **Video Studio** in the sidebar.
2. Enter a URL (or a local file path: `C:\path\to\file.html`).
3. Select a voice from the dropdown.
4. Optionally enter an output folder path.
5. Click **Generate Audio**.
6. MP3 files are generated per slide and appear in the file list.

### Dataset Manager

1. Click **Datasets** in the sidebar.
2. Create a project, then a dataset inside it.
3. View records, paginate, and export as CSV or JSON.

---

## Option 2: React UI (Community — Not Yet Built)

The React version does not exist yet. If you want to build it:

1. Read `src/ui-react/README.md`.
2. Read `Docs/api-reference.md` for the API contract.
3. Use `Mockup/index.html` as your design reference.
4. Open a PR when ready.

---

## Option 3: .NET 9 API (Community — Not Yet Built)

The .NET version does not exist yet. If you want to build it:

1. Read `src/api-dot-net/README.md`.
2. Read `Docs/architecture.md` for the planned structure.
3. Read the guidelines under `Docs/dotnet-guidelines/`.
4. Open a PR when ready.

---

## Option 4: Dedicated Node.js API (Community — Not Yet Built)

If you want a headless API server without the embedded UI:

1. Read `src/api-node-server/README.md`.
2. Extract API routes from `src/ui-js/browser-hub-ui/server.js`.
3. Add CORS and remove static file serving middleware.

---

## Configuration Reference

All settings live in `config/app.config.json`. Copy from `app.config.example.json`.

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `port` | number | No (3000) | HTTP port |
| `adminKey` | string | Yes | Password for the admin account |
| `jwtSecret` | string | Yes | Secret for signing JWT tokens (32+ chars) |
| `googleClientId` | string | No | Google OAuth client ID |
| `googleClientSecret` | string | No | Google OAuth client secret |
| `googleCallbackUrl` | string | No | Google OAuth callback URL |
| `webhookUrl` | string | No | POST job completion events here |
| `dataDir` | string | No (`./data`) | Where to store datasets and job results |
| `uploadDir` | string | No | Where uploaded files are stored |

---

## Troubleshooting

### "Playwright Chromium not found"

Run `npm run setup` (or `npx playwright install chromium`) to download the browser binary.

### Pipeline returns 0 results

The CSS selectors for some sources may be outdated. Enable debug mode to see what the page looks like:

```bash
PIPELINE_DEBUG=1 npm start
```

With debug mode on, the full page HTML is written to the console when 0 results are found. Inspect the HTML to update the `listSelector` in `pipeline/sources/<source>.json`.

### TTS job hangs

Ensure the URL is reachable from the server. For local files, use the format `file:///C:/path/to/file.html` (three forward slashes after `file:`).

### Port already in use

Change the port in `app.config.json`:

```json
{ "port": 3001 }
```

Or kill the existing process:

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F
```

---

## Development Workflow

```bash
# Start with auto-restart
npm run dev

# Run linter
npm run lint

# Run tests (once written)
npm test
```

Pull requests should pass linting before review.
