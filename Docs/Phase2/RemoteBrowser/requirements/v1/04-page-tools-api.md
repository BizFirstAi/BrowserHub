# BrowserHub LiveBrowser — Page Tools API
## Requirements v1 · Phase 2 · Remote Browser Module

---

## Overview

Page Tools are **stateless, one-shot** browser operations. Each call creates an ephemeral Playwright page, performs a single task, returns a structured result, and closes the page. There is no session ID. They are the right choice when you need the result from a single page or operation without managing session state.

All Page Tool routes require authentication. Include either:
- `Authorization: Bearer <jwt>` header
- `X-Api-Key: <key>` header

Page Tools reuse BrowserHub's existing stealth layer and proxy configuration automatically. They benefit from user-agent rotation and bot-detection evasion without any extra configuration.

---

## 1. `hub_fetch` — Smart Page Fetch

```
POST /api/live-browser/tools/fetch
```

Fetch the content of a single URL. Uses a cascading strategy: fast direct HTTP first, then full headless browser if the page requires JavaScript, then stealth mode if bot detection is suspected.

**Request body:**

```json
{
  "url": "https://example.com/products",
  "waitFor": "css:.product-grid",
  "format": "text",
  "includeLinks": true,
  "includeImages": false,
  "timeoutMs": 30000
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | Page to fetch |
| `waitFor` | string | No | — | CSS selector to wait for before extracting content. Forces headless mode |
| `format` | string | No | `"text"` | Output format: `"text"`, `"html"`, `"markdown"`, `"structured"` |
| `includeLinks` | boolean | No | false | Extract all `<a href>` links |
| `includeImages` | boolean | No | false | Extract all `<img>` elements with alt text |
| `timeoutMs` | number | No | 30000 | Page load timeout |

**Response 200 (`format: "structured"`):**

```json
{
  "url": "https://example.com/products",
  "finalUrl": "https://example.com/products?page=1",
  "title": "Products — Example Store",
  "statusCode": 200,
  "content": {
    "text": "Products\n12 items found\n...",
    "headings": ["Products", "Featured Items", "New Arrivals"],
    "paragraphs": ["12 items found in Electronics", "..."],
    "links": [
      { "text": "iPhone 15", "href": "https://example.com/products/iphone-15" }
    ],
    "images": []
  },
  "fetchStrategy": "headless",
  "durationMs": 1840
}
```

**Response 200 (`format: "text"`):**

```json
{
  "url": "https://example.com/products",
  "title": "Products — Example Store",
  "text": "Products\n12 items found\niPhone 15\nFrom $799\n...",
  "durationMs": 1840
}
```

---

## 2. `hub_crawl` — Site Crawler

```
POST /api/live-browser/tools/crawl
```

Crawl a website starting from a seed URL. Follows internal links up to a configured depth and page limit, returning structured content from each visited page. Uses BrowserHub's existing stealth layer on each page.

**Request body:**

```json
{
  "seedUrl": "https://example.com",
  "maxDepth": 2,
  "maxPages": 50,
  "includePatterns": ["/blog/*", "/docs/*"],
  "excludePatterns": ["/admin/*", "*.pdf"],
  "format": "text",
  "delayBetweenPagesMs": 500,
  "timeoutMs": 20000
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `seedUrl` | string | Yes | — | Starting URL |
| `maxDepth` | number | No | 2 | Max link-following depth from seed |
| `maxPages` | number | No | 50 | Maximum total pages to visit. Hard cap: 200 |
| `includePatterns` | string[] | No | — | Glob patterns — only crawl matching paths |
| `excludePatterns` | string[] | No | — | Glob patterns — skip matching paths |
| `format` | string | No | `"text"` | `"text"`, `"html"`, `"structured"` per page |
| `delayBetweenPagesMs` | number | No | 500 | Polite crawl delay between pages |
| `timeoutMs` | number | No | 20000 | Per-page load timeout |

**Response 200:**

```json
{
  "seedUrl": "https://example.com",
  "pagesVisited": 12,
  "pagesSkipped": 3,
  "durationMs": 14200,
  "pages": [
    {
      "url": "https://example.com",
      "title": "Home — Example",
      "depth": 0,
      "text": "Welcome to Example...",
      "statusCode": 200
    },
    {
      "url": "https://example.com/about",
      "title": "About Us",
      "depth": 1,
      "text": "We are a team of...",
      "statusCode": 200
    }
  ]
}
```

**Notes:**
- Only crawls the same origin as `seedUrl` — no cross-domain following
- Deduplicates URLs — each page visited at most once
- `pagesSkipped` counts URLs that matched `excludePatterns` or were already visited

---

## 3. `hub_audit` — Page Audit

```
POST /api/live-browser/tools/audit
```

Run a quality audit against a page, measuring performance, accessibility, SEO readiness, and best practices using Playwright's page metrics and custom checks. Returns a scored report.

**Request body:**

```json
{
  "url": "https://example.com",
  "categories": ["performance", "accessibility", "seo", "bestPractices"],
  "device": "desktop",
  "timeoutMs": 60000
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | Page to audit |
| `categories` | string[] | No | all | Which audits to run |
| `device` | string | No | `"desktop"` | `"desktop"` or `"mobile"` (sets viewport + UA) |
| `timeoutMs` | number | No | 60000 | Total audit timeout |

**Response 200:**

```json
{
  "url": "https://example.com",
  "auditedAt": "2026-06-16T09:30:00Z",
  "device": "desktop",
  "scores": {
    "performance": 78,
    "accessibility": 91,
    "seo": 85,
    "bestPractices": 70
  },
  "metrics": {
    "timeToFirstByte": 320,
    "largestContentfulPaint": 2100,
    "totalBlockingTime": 180,
    "cumulativeLayoutShift": 0.12
  },
  "findings": [
    {
      "category": "performance",
      "severity": "warning",
      "title": "Images not using next-gen formats",
      "description": "4 images found in JPEG that could be WebP or AVIF",
      "elements": ["img#hero", "img.product-thumb"]
    },
    {
      "category": "accessibility",
      "severity": "error",
      "title": "Button has no accessible name",
      "description": "<button class='close'> has no text or aria-label",
      "elements": ["button.close"]
    }
  ],
  "durationMs": 8400
}
```

**Categories:**

| Category | What it checks |
|----------|----------------|
| `performance` | LCP, TBT, CLS, TTFB, image optimization, render-blocking resources |
| `accessibility` | Missing alt text, unlabelled inputs, insufficient color contrast, missing ARIA roles |
| `seo` | Title tag, meta description, canonical, robots, structured data presence |
| `bestPractices` | HTTPS, console errors, deprecated APIs, mixed content |

---

## 4. `hub_map` — Site Map Discovery

```
POST /api/live-browser/tools/map
```

Discover all URLs on a site by combining sitemap.xml parsing with link extraction. Returns a de-duplicated, sorted list of URLs.

**Request body:**

```json
{
  "url": "https://example.com",
  "includeSitemap": true,
  "includeLinked": true,
  "depth": 1,
  "maxUrls": 500
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | Site root or any starting URL |
| `includeSitemap` | boolean | No | true | Parse sitemap.xml (and sitemap index files) |
| `includeLinked` | boolean | No | true | Extract linked URLs from visited pages |
| `depth` | number | No | 1 | Link-following depth for `includeLinked` |
| `maxUrls` | number | No | 500 | Cap on total URLs returned |

**Response 200:**

```json
{
  "rootUrl": "https://example.com",
  "totalFound": 127,
  "sources": {
    "sitemap": 98,
    "linkExtraction": 34,
    "deduplicated": 5
  },
  "urls": [
    "https://example.com/",
    "https://example.com/about",
    "https://example.com/blog",
    "https://example.com/blog/post-1"
  ],
  "durationMs": 3200
}
```

---

## 5. `hub_export` — Page Export

```
POST /api/live-browser/tools/export
```

Export a page in a chosen format. The response returns a file download.

**Request body:**

```json
{
  "url": "https://example.com/report",
  "format": "pdf",
  "waitFor": "css:.report-table",
  "pdf": {
    "paperSize": "A4",
    "landscape": false,
    "printBackground": true,
    "margins": { "top": "1cm", "bottom": "1cm", "left": "1cm", "right": "1cm" }
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | Page to export |
| `format` | string | Yes | — | `"pdf"`, `"png"`, `"html"`, `"zip"` |
| `waitFor` | string | No | — | CSS selector to wait for before exporting |
| `pdf` | object | No | — | PDF-specific options (only used when `format: "pdf"`) |
| `screenshot` | object | No | — | Screenshot options: `{ fullPage: true, clip: { x, y, width, height } }` |

**Response:** The response is a file download.

| Format | Content-Type | Notes |
|--------|-------------|-------|
| `pdf` | `application/pdf` | Uses Playwright `page.pdf()` |
| `png` | `image/png` | Uses Playwright `page.screenshot()` |
| `html` | `text/html` | The full page HTML at time of export |
| `zip` | `application/zip` | Offline-capable HTML + all assets (images, CSS, JS) inlined |

**Content-Disposition header:** `attachment; filename="export-{timestamp}.{ext}"`

---

## 6. `hub_search` — Web Search

```
POST /api/live-browser/tools/search
```

Perform a web search using a search engine. Optionally fetches the full content of each result page.

**Request body:**

```json
{
  "query": "best Node.js web scraping libraries 2026",
  "engine": "bing",
  "maxResults": 10,
  "fetchEachResult": false,
  "resultFormat": "structured"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `query` | string | Yes | — | Search query |
| `engine` | string | No | `"bing"` | Which search engine to use: `"bing"`, `"duckduckgo"` |
| `maxResults` | number | No | 10 | Number of results to return. Max: 20 |
| `fetchEachResult` | boolean | No | false | If true, fetch and extract text from each result URL |
| `resultFormat` | string | No | `"structured"` | `"structured"` or `"text"` |

**Response 200:**

```json
{
  "query": "best Node.js web scraping libraries 2026",
  "engine": "bing",
  "totalResults": 10,
  "results": [
    {
      "rank": 1,
      "title": "Top 10 Node.js Scraping Libraries in 2026",
      "url": "https://dev.to/example/top-10-nodejs-scraping",
      "snippet": "We tested Playwright, Puppeteer, Cheerio, and others...",
      "fetchedText": "Full page text if fetchEachResult was true..."
    }
  ],
  "durationMs": 4100
}
```

---

## 7. `hub_download` — File Download

```
POST /api/live-browser/tools/download
```

Navigate to a page, trigger a file download (by clicking a button or navigating directly to a download URL), and return the downloaded file.

**Request body:**

```json
{
  "url": "https://example.com/reports",
  "triggerSelector": "button#download-csv",
  "waitFor": "css:button#download-csv",
  "timeoutMs": 30000
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | Page to navigate to |
| `triggerSelector` | string | No | — | CSS selector to click to trigger the download. If omitted, navigation itself should trigger a download |
| `waitFor` | string | No | — | CSS selector to wait for before clicking |
| `timeoutMs` | number | No | 30000 | Total timeout for the download to complete |

**Response:** File download (binary).

| Header | Value |
|--------|-------|
| `Content-Type` | Detected MIME type of the downloaded file |
| `Content-Disposition` | `attachment; filename="{original filename}"` |
| `X-Hub-Download-Url` | The URL that initiated the download |
| `X-Hub-File-Size` | File size in bytes |

---

## 8. `hub_script` — Custom Script Runner

```
POST /api/live-browser/tools/script
```

Run a custom Playwright script against a page. The script receives a `page` object (Playwright `Page`) and returns any serializable value. This is the escape hatch for tasks that don't fit the other tools.

**Request body:**

```json
{
  "url": "https://example.com/table",
  "waitFor": "css:table.data-grid",
  "script": "async (page) => { const rows = await page.$$eval('table tr', rs => rs.map(r => r.innerText)); return rows; }",
  "timeoutMs": 30000
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | Page to navigate to before running the script |
| `waitFor` | string | No | — | CSS selector to wait for before executing the script |
| `script` | string | Yes | — | An async function string that accepts `(page)` and returns a value |
| `timeoutMs` | number | No | 30000 | Total script execution timeout |

**Response 200:**

```json
{
  "url": "https://example.com/table",
  "result": [
    "Name\tAge\tCity",
    "Alice\t30\tNew York",
    "Bob\t25\tSan Francisco"
  ],
  "durationMs": 2100
}
```

**Security note:** `hub_script` is restricted to admin-level API keys by default. Standard user JWT tokens cannot call this endpoint. This can be relaxed in `app.config.json`:

```json
{ "liveBrowser": { "script": { "allowedRoles": ["admin", "user"] } } }
```

---

## Common Error Responses for Page Tools

All Page Tools return errors in a consistent shape:

```json
{
  "error": {
    "code": "FETCH_FAILED",
    "message": "Page returned HTTP 403 — access denied",
    "url": "https://example.com/protected",
    "durationMs": 5200
  }
}
```

| Code | HTTP | Meaning |
|------|------|---------|
| `FETCH_FAILED` | 422 | Page returned an error status or network failure |
| `TIMEOUT` | 422 | Operation timed out |
| `SELECTOR_TIMEOUT` | 422 | `waitFor` selector never appeared |
| `DOWNLOAD_FAILED` | 422 | No download was triggered within the timeout |
| `SCRIPT_ERROR` | 422 | Custom script threw an exception |
| `INVALID_URL` | 400 | URL is not a valid absolute HTTP/HTTPS URL |
| `INVALID_PARAMS` | 400 | Missing or malformed parameters |
| `CRAWL_LIMIT_REACHED` | 200 | Partial success — `maxPages` was hit before crawl completed (not an error, included as metadata) |
