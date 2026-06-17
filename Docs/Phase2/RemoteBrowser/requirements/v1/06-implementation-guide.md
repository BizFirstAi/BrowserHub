# BrowserHub LiveBrowser — Community Developer Implementation Guide
## Requirements v1 · Phase 2 · Remote Browser Module

---

## Welcome

This guide is written for the community developer who will build the LiveBrowser module. It tells you what to build, in what order, and how to verify each piece works before moving to the next.

Read Documents 01–05 before this one. This guide assumes you understand the architecture and API already.

---

## 1. Prerequisites

You'll need a working BrowserHub development environment:

```bash
cd src/ui-js/browser-hub-ui
npm install
npm run setup            # Installs Playwright Chromium
cp config/app.config.example.json config/app.config.json
npm run dev              # BrowserHub starts at http://localhost:3000
```

Confirm BrowserHub is running and you can reach `http://localhost:3000` in a browser.

**Node.js version:** 18+ (Playwright requirement).

**Playwright:** Already installed as a project dependency — do not install a second copy.

---

## 2. File Layout

Create this directory structure under `src/ui-js/browser-hub-ui/browser-studio/`:

```
browser-studio/live-browser/
├── session-manager.js      Step 1
├── browser-session.js      Step 1
├── capture-engine.js       Step 2
├── command-runner.js       Step 3
├── page-tools.js           Step 4
├── routes.js               Step 5
├── errors.js               Step 1 (alongside session files)
└── mcp-server.js           Step 6
```

And create the data directory (at runtime — the app creates it on first use):

```
data/live-browser/sessions/    (auto-created)
```

---

## 3. Build Order

Follow this order. Each step produces something testable before the next step depends on it.

---

### Step 1 — Error Codes + Session Skeleton

**Files:** `errors.js`, `browser-session.js`, `session-manager.js`

**`errors.js`** — Define all error codes as constants and a factory function:

```js
const CODES = {
  ELEMENT_NOT_FOUND:        'ELEMENT_NOT_FOUND',
  NAVIGATION_TIMEOUT:       'NAVIGATION_TIMEOUT',
  ELEMENT_TIMEOUT:          'ELEMENT_TIMEOUT',
  SESSION_NOT_FOUND:        'SESSION_NOT_FOUND',
  SESSION_EXPIRED:          'SESSION_EXPIRED',
  SESSION_FORBIDDEN:        'SESSION_FORBIDDEN',
  EXECUTE_ERROR:            'EXECUTE_ERROR',
  NAVIGATION_ERROR:         'NAVIGATION_ERROR',
  BATCH_ERROR:              'BATCH_ERROR',
  INVALID_PARAMS:           'INVALID_PARAMS',
  BROWSER_CRASH:            'BROWSER_CRASH',
  SESSION_CAPACITY_REACHED: 'SESSION_CAPACITY_REACHED',
  USER_SESSION_LIMIT:       'USER_SESSION_LIMIT',
  FETCH_FAILED:             'FETCH_FAILED',
  TIMEOUT:                  'TIMEOUT',
  SELECTOR_TIMEOUT:         'SELECTOR_TIMEOUT',
  DOWNLOAD_FAILED:          'DOWNLOAD_FAILED',
  SCRIPT_ERROR:             'SCRIPT_ERROR',
  INVALID_URL:              'INVALID_URL',
};

function makeError(code, message, extra = {}) {
  return { error: { code, message, ...extra } };
}

module.exports = { CODES, makeError };
```

**`browser-session.js`** — Plain data class. No Playwright calls yet:

```js
class BrowserSession {
  constructor({ id, ownerId, context, page }) {
    this.id = id;
    this.ownerId = ownerId;
    this.context = context;
    this.page = page;
    this.createdAt = new Date();
    this.lastActiveAt = new Date();
    this.status = 'active';
    this.history = [];
  }

  touch() { this.lastActiveAt = new Date(); }

  isIdleSince(ms) {
    return (Date.now() - this.lastActiveAt.getTime()) > ms;
  }
}

module.exports = BrowserSession;
```

**`session-manager.js`** — The singleton. At this stage just implement create/get/close and the in-memory map. Add the idle sweep last.

Key things to implement:

- `create(ownerId, options)` — calls `chromium.launchPersistentContext` (or `browser.newContext()`), creates a `BrowserSession`, stores in `Map`
- `get(sessionId, requestingUserId)` — returns the session, throws `SESSION_NOT_FOUND` or `SESSION_FORBIDDEN`
- `close(sessionId)` — calls `context.close()`, sets `status = 'closed'`, removes from map
- `_sweep()` — called every 60s via `setInterval`, closes idle sessions
- `_writeMetadata(session)` — writes `data/live-browser/sessions/{id}.json`

**Verification:** Write a small test script (`test-session-manager.js`, not committed) that calls `create`, logs the session ID, calls `get`, then calls `close`. Run with `node test-session-manager.js`. You should see a Chromium window open and close (in headed mode for debugging: pass `headless: false` in `create`).

---

### Step 2 — CaptureEngine

**File:** `capture-engine.js`

This is the most important piece to get right. The AI assistant depends entirely on this output to know what it can interact with.

**`capture(page, options)`** — Core method:

1. Evaluate a Playwright `page.evaluate` call that:
   a. Queries all interactive and informational elements (see element criteria in `02-architecture.md`)
   b. Assigns a `data-hub-idx` attribute to each (sequential integer)
   c. Collects tag, text/label/placeholder, type, bounding box (to check visibility), and computes a selector `[data-hub-idx='N']`
   d. Returns an array of element descriptors

2. Also call `page.evaluate(() => document.body.innerText)` to get a plain-text representation of the page

3. Assemble and return the capture object (schema in `03-session-api.md`)

**Important implementation detail:** The `data-hub-idx` injection is done entirely inside the `page.evaluate` closure — it runs in the browser's JS context, not in Node. Use `document.querySelectorAll` inside the closure. Do not try to use Playwright's `$$` outside the closure for this step.

**`clearIndices(page)`** — Removes all `data-hub-idx` attributes. Call this before every navigation to avoid stale indices carrying over.

**Verification:** Hardcode a test URL, create a session manually (reuse Step 1 code), call `capture`, and `console.log(JSON.stringify(result, null, 2))`. Manually check that the selectors in the output actually exist on the page by opening the URL in a headed browser and inspecting the elements.

---

### Step 3 — CommandRunner

**File:** `command-runner.js`

Implement each command as a private method. The public API is:

```js
async run(session, method, params)    // single command
async runBatch(session, commands)     // array of { method, params }
```

Implement commands in this order (simplest first):

1. `navigate` — `page.goto(url, { waitUntil, timeout })`. Call `clearIndices` before navigating. Update `session.history`.
2. `capture` — delegates to `CaptureEngine.capture(page, params)`
3. `extract` — `page.$eval(selector, el => el.innerText)`
4. `source` — `page.$eval(selector, el => el.outerHTML)` or `page.content()` if no selector
5. `tap` — `page.click(selector, options)`. Wrap in try/catch; throw `ELEMENT_NOT_FOUND` if selector missing.
6. `fill` — `page.fill(selector, text)`
7. `choose` — `page.selectOption(selector, value)`
8. `toggle` — `page.setChecked(selector, checked)`
9. `point` — `page.hover(selector)`
10. `slide` — `page.evaluate` to scroll by delta, or `page.mouse.wheel`
11. `execute` — `page.evaluate(new Function('return ' + script + ';')()`). Wrap carefully — user script errors must be caught and returned as `EXECUTE_ERROR`.
12. `goBack`, `goForward`, `reload` — Playwright `page.goBack()`, etc.
13. `awaitElement` — `page.waitForSelector(selector, { state, timeout })`
14. `awaitLoad` — `page.waitForNavigation({ waitUntil, timeout })`
15. `awaitDelay` — `page.waitForTimeout(ms)`. Cap at 10 000 ms.
16. `awaitRequest` — `page.waitForRequest(urlPattern, { timeout })`
17. `awaitResponse` — `page.waitForResponse(response => ..., { timeout })`
18. `liveView` — Generate a screenshot stream URL (see note below)
19. `end` — calls `SessionManager.close(session.id)`

**`liveView` implementation note:** A simple approach for v1 is a polling endpoint. When `liveView` is called, register the session ID as "live view active" in `SessionManager`. The route `GET /api/live-browser/sessions/:id/view` streams a new screenshot every `refreshRateMs` milliseconds using `page.screenshot()` and sends it as `multipart/x-mixed-replace` (MJPEG stream). Return the URL to this endpoint as `viewUrl`.

**Error wrapping:** Every command that calls Playwright should catch Playwright's `TimeoutError` and map it to the appropriate BrowserHub error code. Other unexpected errors map to `BROWSER_CRASH`.

**`runBatch` rule:** Run commands in a `for` loop with `await`. On first error, set `errorIndex` and break. Also call a fresh `capture` after the error and include it in the error response as `freshCapture`.

**Verification:** Open a real session, manually navigate to a page with a form, call `capture`, observe the indices, then call `fill` and `tap` using those indices. Confirm the form was submitted by calling `capture` again and checking the new URL/elements.

---

### Step 4 — PageTools

**File:** `page-tools.js`

Each function in this file is independent. Implement them in order of complexity:

1. `hubFetch(params)` — Navigate a temporary page to `url`, optionally wait for `waitFor` selector, return content in requested `format`. Reuse the existing `page-scraper.js` browser pool if possible.

2. `hubMap(params)` — Fetch `url/sitemap.xml` with `xml2js` (already a BrowserHub dependency), parse URLs. If `includeLinked`, also navigate to `url`, capture all `<a href>` links, and merge. Deduplicate. Return sorted list.

3. `hubSearch(params)` — Navigate a headless page to Bing or DuckDuckGo, type the query, wait for results, extract result titles/URLs/snippets. If `fetchEachResult`, run `hubFetch` on each. This is the most fragile tool — build it to be tolerant of DOM changes in the search engines.

4. `hubExport(params)` — Navigate to `url`, wait for `waitFor` if set, then:
   - `pdf` → `page.pdf(pdfOptions)`
   - `png` → `page.screenshot({ fullPage: true })`
   - `html` → `page.content()`
   - `zip` → `page.content()` + download all referenced assets, zip together

5. `hubAudit(params)` — Navigate to `url`, collect Playwright timing metrics (`page.metrics()`), run manual checks for accessibility (query for missing alt text, unlabelled inputs), SEO (check title/meta desc/canonical in `page.$eval`). Score each category 0–100. This is a custom implementation — not Lighthouse — keep it pragmatic.

6. `hubCrawl(params)` — A BFS queue. Start with `[seedUrl]`. For each URL: fetch content, extract all `<a href>` links, filter by origin + include/exclude patterns + not already visited, add to queue. Respect `maxDepth` and `maxPages`. Use delays between pages.

7. `hubDownload(params)` — Set up a Playwright download event listener (`page.on('download', ...)`), navigate to `url`, optionally click `triggerSelector`, await the download event, save to a temp file, return the file buffer.

8. `hubScript(params)` — Navigate to `url`, wait for `waitFor` if set, call `page.evaluate(new Function(script))`. The script string must be a valid async function that accepts `page` — but `page.evaluate` runs in the browser context, not Node. For `hub_script`, the script actually receives a Playwright Page proxy, which means the script must run in Node context (not `page.evaluate`). Use `new AsyncFunction('page', script)(page)` in Node. This is the only Page Tool where the script runs in Node context.

**Verification:** Call each function directly from a test script and assert the returned shape matches the schemas in `04-page-tools-api.md`.

---

### Step 5 — Routes

**File:** `routes.js`

Mount in `server.js` as: `app.use('/api/live-browser', require('./browser-studio/live-browser/routes'));`

Implement these routes:

```
POST   /sessions                        → SessionManager.create
GET    /sessions                        → SessionManager.listByOwner
GET    /sessions/:id                    → SessionManager.get
POST   /sessions/:id/run                → CommandRunner.run or runBatch
DELETE /sessions/:id                    → SessionManager.close
GET    /sessions/:id/view               → Screenshot stream (liveView)

POST   /tools/fetch                     → PageTools.hubFetch
POST   /tools/crawl                     → PageTools.hubCrawl
POST   /tools/audit                     → PageTools.hubAudit
POST   /tools/map                       → PageTools.hubMap
POST   /tools/export                    → PageTools.hubExport
POST   /tools/search                    → PageTools.hubSearch
POST   /tools/download                  → PageTools.hubDownload
POST   /tools/script                    → PageTools.hubScript (admin only)
```

**Auth middleware:** Reuse BrowserHub's existing auth middleware from `auth/index.js`. Attach it to every route. Extract `req.user.id` (or `req.apiKey.ownerId`) for ownership checks.

**Input validation:** Every route handler should validate required fields before calling any session/tool function and return a `400 INVALID_PARAMS` immediately if fields are missing or malformed.

**`/tools/script` extra guard:**

```js
if (!req.user.roles?.includes('admin')) {
  return res.status(403).json(makeError('SESSION_FORBIDDEN', 'hub_script requires admin role'));
}
```

**Verification:** Use a REST client (Bruno, Insomnia, or `curl`) to hit each endpoint. Walk through the full session lifecycle manually: create → navigate → capture → fill → tap → end.

---

### Step 6 — MCP Server

**File:** `mcp-server.js`

**Package to install:** `npm install @modelcontextprotocol/sdk`

Implement the MCP server as a thin HTTP/stdio adapter over the BrowserHub REST API. It does **not** call Playwright directly — it calls `http://localhost:3000/api/live-browser/*` endpoints using a service API key from `BROWSERHUB_API_KEY` env var.

**Structure:**

```js
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const server = new Server(
  { name: 'browserhub', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [/* tool definitions from section 3 of doc 05 */]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  // route to the correct BrowserHub API call
  // return { content: [{ type: 'text', text: JSON.stringify(result) }] }
});
```

**`bh_session` routing logic in the MCP handler:**

```js
if (name === 'bh_session') {
  const { method, sessionId, params, commands } = args;

  if (method === 'open') {
    const res = await bhApi.post('/api/live-browser/sessions', {});
    return mcpResult(res.data);
  }

  if (!sessionId) throw new Error('sessionId is required for method: ' + method);

  if (commands) {
    const res = await bhApi.post(`/api/live-browser/sessions/${sessionId}/run`, { commands });
    return mcpResult(res.data);
  }

  const res = await bhApi.post(`/api/live-browser/sessions/${sessionId}/run`, { method, params });
  return mcpResult(res.data);
}
```

**Starting the MCP server:**

- **stdio mode** (default): `const transport = new StdioServerTransport(); await server.connect(transport);`
- **httpStream mode**: Use the SDK's `StreamableHTTPServerTransport` (or implement a simple Express route that handles the MCP HTTP transport if the SDK doesn't provide one for CommonJS)

**`start(config)` export** (called from `server.js`):

```js
function start(mcpConfig) {
  if (mcpConfig.transport === 'httpStream') {
    startHttpStream(mcpConfig.port);
  } else {
    startStdio();
  }
}

module.exports = { start };
```

**Publish as npm package:** Once the MCP server works locally, extract `mcp-server.js` into a separate npm package `@browserhub/mcp-server` with a `bin` entry so it can be run via `npx -y @browserhub/mcp-server`.

**Verification:**
1. Start BrowserHub normally
2. In a separate terminal: `BROWSERHUB_URL=http://localhost:3000 BROWSERHUB_API_KEY=your_key node mcp-server.js`
3. Connect Claude Code: `claude mcp add browserhub node -- path/to/mcp-server.js`
4. In a Claude Code session, ask: "Use bh_session to open a browser, go to https://example.com, capture the page, and tell me what you see"

---

## 4. Configuration Update

Add to `config/app.config.example.json`:

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
    },
    "script": {
      "allowedRoles": ["admin"]
    }
  }
}
```

Read config in code using BrowserHub's existing config loader pattern.

---

## 5. Testing Checklist

Before submitting your pull request, verify every item in this list manually:

### Session Driver
- [ ] Can create a session and receive a `sessionId`
- [ ] Can navigate to a URL within a session
- [ ] Can call `capture` and receive a list of elements with selectors
- [ ] Selectors from `capture` correctly target the right elements when used in `tap` and `fill`
- [ ] Can log into a website (fill username, fill password, tap submit) and remain logged in for subsequent `navigate` calls
- [ ] Session times out after idle period and returns `SESSION_EXPIRED` on next call
- [ ] `end` command closes the session
- [ ] Cannot access another user's session (returns `SESSION_FORBIDDEN`)
- [ ] Batch commands execute in order and stop on first error
- [ ] `ELEMENT_NOT_FOUND` returns a `freshCapture` in the error body
- [ ] Socket.io emits `live-browser-navigated`, `live-browser-captured`, `live-browser-session-closed`

### Page Tools
- [ ] `hub_fetch` returns page text for a public URL
- [ ] `hub_fetch` with `waitFor` waits for a dynamic element before returning
- [ ] `hub_map` returns sitemap URLs for a site that has `sitemap.xml`
- [ ] `hub_crawl` visits linked pages up to `maxDepth`
- [ ] `hub_search` returns result titles and URLs for a query
- [ ] `hub_export` with `format: "pdf"` returns a downloadable PDF
- [ ] `hub_export` with `format: "png"` returns a PNG image
- [ ] `hub_audit` returns scores for all four categories
- [ ] `hub_download` captures a file download triggered by a button
- [ ] `hub_script` is blocked for non-admin tokens

### MCP
- [ ] MCP server starts in stdio mode without errors
- [ ] Claude Code can list BrowserHub tools via `bh_`
- [ ] `bh_session` open → navigate → capture flow works in a Claude Code session
- [ ] `bh_fetch` returns page content in a Claude Code session
- [ ] MCP server starts in httpStream mode and is accessible at `localhost:{port}/mcp`

### Integration
- [ ] All Phase 1 features still work (scan jobs, pipeline, video studio, auth)
- [ ] Sessions appear in `data/live-browser/sessions/` as JSON files
- [ ] No memory leaks — creating and closing 50 sessions leaves no orphaned Playwright contexts

---

## 6. Coding Conventions

Follow BrowserHub's existing conventions from `CONTRIBUTING.md`:

- Plain Node.js, no TypeScript, no transpiler
- CommonJS (`require`/`module.exports`), not ES modules
- No unnecessary comments — only add a comment when the *why* is non-obvious
- Async/await throughout — no raw `.then()` chains
- Keep functions small and named descriptively
- No new npm packages without discussion — `@modelcontextprotocol/sdk` is the one exception

---

## 7. Pull Request Expectations

Submit one PR for the full LiveBrowser module. The PR description should include:

1. A brief description of what was built
2. Notes on any design decisions that deviated from this spec (and why)
3. Manual testing evidence (screenshots or terminal output showing the session lifecycle working)
4. Any known limitations or items left for v2

Tag the PR with the `phase-2` and `live-browser` labels.

---

## 8. Questions and Support

If anything in this spec is ambiguous or you discover a technical constraint that changes the design, open an issue tagged `live-browser-spec` in the BrowserHub repository before changing course. The feature owner will respond within 2 business days.
