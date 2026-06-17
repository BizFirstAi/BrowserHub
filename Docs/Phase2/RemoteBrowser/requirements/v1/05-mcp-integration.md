# BrowserHub LiveBrowser — MCP Integration Specification
## Requirements v1 · Phase 2 · Remote Browser Module

---

## 1. What Is MCP?

The **Model Context Protocol (MCP)** is an open protocol that lets AI assistants (Claude, Copilot, etc.) call external tools through a standardised interface. An MCP server declares tools; an MCP client (Claude Desktop, Claude Code, VS Code extension, Cursor, Windsurf, or any compatible IDE) discovers and routes tool calls to the server at runtime.

LiveBrowser's MCP server exposes all nine BrowserHub tools — one stateful Session Driver tool and eight stateless Page Tools — so that any MCP-compatible AI assistant can drive a real browser as part of a conversation.

---

## 2. MCP Server Overview

**Package name (npm):** `@browserhub/mcp-server` *(published separately, or run via npx)*

**Transports:**
- **stdio** — for desktop clients (Claude Desktop, Cursor, VS Code). The MCP client starts the server as a child process.
- **httpStream** — for shared/server deployments. One long-lived HTTP endpoint serves multiple clients.

**Tool prefix:** `bh_` — all BrowserHub MCP tools are prefixed `bh_` to avoid collisions with other MCP servers.

**Tools exposed:**

| MCP Tool Name | Type | Maps To |
|---------------|------|---------|
| `bh_session` | Stateful | `hub_browser` Session Driver |
| `bh_fetch` | Stateless | `hub_fetch` |
| `bh_crawl` | Stateless | `hub_crawl` |
| `bh_audit` | Stateless | `hub_audit` |
| `bh_map` | Stateless | `hub_map` |
| `bh_export` | Stateless | `hub_export` |
| `bh_search` | Stateless | `hub_search` |
| `bh_download` | Stateless | `hub_download` |
| `bh_script` | Stateless | `hub_script` |

---

## 3. Tool Definitions

### 3.1 `bh_session` — Stateful Browser Session

This is the main multi-turn tool. The AI calls it repeatedly within a conversation, passing a `method` each time. The browser session persists between calls.

**MCP tool schema:**

```json
{
  "name": "bh_session",
  "description": "Drive a live Chromium browser session across multiple turns. The session keeps cookies, storage, and history between calls. Use this when a task needs login, form submission, multi-step flows, or page interaction. Call capture after every navigation to see what's on the page before acting.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sessionId": {
        "type": "string",
        "description": "Session identifier returned by method=open. Omit when calling method=open."
      },
      "method": {
        "type": "string",
        "enum": ["open", "navigate", "capture", "extract", "source", "execute", "tap", "fill", "choose", "toggle", "point", "slide", "awaitElement", "awaitLoad", "awaitDelay", "awaitRequest", "awaitResponse", "liveView", "end"],
        "description": "Action to perform on the session."
      },
      "params": {
        "type": "object",
        "description": "Parameters for the chosen method. See method reference for field details."
      },
      "commands": {
        "type": "array",
        "description": "Batch of {method, params} objects to run sequentially on the same page. Use for filling forms in one shot.",
        "items": {
          "type": "object",
          "properties": {
            "method": { "type": "string" },
            "params": { "type": "object" }
          },
          "required": ["method"]
        }
      }
    },
    "required": ["method"]
  }
}
```

**`method=open` — Create a session**

```json
{ "method": "open" }
```

Returns: `{ "sessionId": "...", "status": "active" }`

The AI stores the returned `sessionId` and passes it in every subsequent call.

**Subsequent calls:**

```json
{
  "sessionId": "a1b2c3...",
  "method": "navigate",
  "params": { "url": "https://example.com/login" }
}
```

```json
{
  "sessionId": "a1b2c3...",
  "method": "capture"
}
```

```json
{
  "sessionId": "a1b2c3...",
  "commands": [
    { "method": "fill",  "params": { "selector": "[data-hub-idx='2']", "text": "alice@example.com" } },
    { "method": "fill",  "params": { "selector": "[data-hub-idx='3']", "text": "mypassword" } },
    { "method": "tap",   "params": { "selector": "[data-hub-idx='4']" } }
  ]
}
```

```json
{
  "sessionId": "a1b2c3...",
  "method": "end"
}
```

---

### 3.2 `bh_fetch`

```json
{
  "name": "bh_fetch",
  "description": "Fetch the content of a single web page. Uses headless Chromium when needed. Best for reading one page — use bh_session when you need login or multi-step interaction.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url":         { "type": "string", "description": "Absolute URL to fetch" },
      "waitFor":     { "type": "string", "description": "CSS selector to wait for before reading content" },
      "format":      { "type": "string", "enum": ["text", "html", "markdown", "structured"], "default": "text" },
      "includeLinks":  { "type": "boolean", "default": false },
      "includeImages": { "type": "boolean", "default": false }
    },
    "required": ["url"]
  }
}
```

---

### 3.3 `bh_crawl`

```json
{
  "name": "bh_crawl",
  "description": "Crawl a website from a seed URL and return content from all discovered pages. Best for indexing a site or reading documentation.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "seedUrl":        { "type": "string" },
      "maxDepth":       { "type": "number", "default": 2 },
      "maxPages":       { "type": "number", "default": 50 },
      "includePatterns":{ "type": "array", "items": { "type": "string" } },
      "excludePatterns":{ "type": "array", "items": { "type": "string" } },
      "format":         { "type": "string", "enum": ["text", "html", "structured"], "default": "text" }
    },
    "required": ["seedUrl"]
  }
}
```

---

### 3.4 `bh_audit`

```json
{
  "name": "bh_audit",
  "description": "Run a quality audit on a page covering performance, accessibility, SEO, and best practices. Returns scores and a list of findings.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url":        { "type": "string" },
      "categories": { "type": "array", "items": { "type": "string", "enum": ["performance", "accessibility", "seo", "bestPractices"] } },
      "device":     { "type": "string", "enum": ["desktop", "mobile"], "default": "desktop" }
    },
    "required": ["url"]
  }
}
```

---

### 3.5 `bh_map`

```json
{
  "name": "bh_map",
  "description": "Discover all URLs on a site by reading sitemap.xml and following links. Returns a de-duplicated URL list.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url":            { "type": "string" },
      "includeSitemap": { "type": "boolean", "default": true },
      "includeLinked":  { "type": "boolean", "default": true },
      "depth":          { "type": "number", "default": 1 },
      "maxUrls":        { "type": "number", "default": 500 }
    },
    "required": ["url"]
  }
}
```

---

### 3.6 `bh_export`

```json
{
  "name": "bh_export",
  "description": "Export a page as PDF, PNG screenshot, HTML, or a self-contained offline ZIP.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url":     { "type": "string" },
      "format":  { "type": "string", "enum": ["pdf", "png", "html", "zip"] },
      "waitFor": { "type": "string", "description": "CSS selector to wait for before exporting" }
    },
    "required": ["url", "format"]
  }
}
```

---

### 3.7 `bh_search`

```json
{
  "name": "bh_search",
  "description": "Search the web and return a list of results with titles, URLs, and snippets. Optionally fetches full content of each result page.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query":           { "type": "string" },
      "engine":          { "type": "string", "enum": ["bing", "duckduckgo"], "default": "bing" },
      "maxResults":      { "type": "number", "default": 10 },
      "fetchEachResult": { "type": "boolean", "default": false }
    },
    "required": ["query"]
  }
}
```

---

### 3.8 `bh_download`

```json
{
  "name": "bh_download",
  "description": "Navigate to a page and capture a file download triggered by a button click or direct URL navigation.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url":             { "type": "string" },
      "triggerSelector": { "type": "string", "description": "CSS selector to click to start the download" },
      "waitFor":         { "type": "string" }
    },
    "required": ["url"]
  }
}
```

---

### 3.9 `bh_script`

```json
{
  "name": "bh_script",
  "description": "Run a custom Playwright async function against a page. The function receives a Playwright Page object. Use this for tasks not covered by other tools. Requires admin permissions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url":     { "type": "string" },
      "waitFor": { "type": "string" },
      "script":  { "type": "string", "description": "async (page) => { ... } — must return a serializable value" }
    },
    "required": ["url", "script"]
  }
}
```

---

## 4. Authentication

The MCP server authenticates to BrowserHub using a **service API key** — a long-lived key generated in the BrowserHub admin panel. This key is passed as an environment variable. All tool calls are executed under the identity of the service key owner.

The AI assistant itself never handles authentication — it calls the MCP tool and gets results.

**Auth flow:**

```
AI Assistant
    │  calls bh_session / bh_fetch / etc.
    ▼
MCP Server (local or hosted)
    │  injects X-Api-Key: <BROWSERHUB_API_KEY>
    ▼
BrowserHub REST API (/api/live-browser/...)
    │  validates API key → resolves user
    ▼
Result → MCP Server → AI Assistant
```

---

## 5. Transport Configuration

### stdio (Recommended for Desktop Clients)

The MCP server is started as a child process by the client. Communication is over stdin/stdout.

**How to start:**

```bash
BROWSERHUB_URL=http://localhost:3000 BROWSERHUB_API_KEY=your_key npx -y @browserhub/mcp-server
```

**Environment variables:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BROWSERHUB_URL` | Yes | — | Base URL of the running BrowserHub instance |
| `BROWSERHUB_API_KEY` | Yes | — | API key from BrowserHub admin panel |
| `TRANSPORT` | No | `stdio` | `stdio` or `httpStream` |
| `PORT` | No | 7420 | HTTP port (only used with `httpStream`) |
| `REQUEST_TIMEOUT_MS` | No | 60000 | How long to wait for BrowserHub API responses |

### httpStream (Shared / Multi-Client)

```bash
TRANSPORT=httpStream PORT=7420 BROWSERHUB_URL=http://localhost:3000 BROWSERHUB_API_KEY=your_key npx -y @browserhub/mcp-server
```

Point MCP clients at: `http://localhost:7420/mcp`

---

## 6. Client Configuration

### Claude Desktop

Add to `claude_desktop_config.json` (usually at `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "browserhub": {
      "command": "npx",
      "args": ["-y", "@browserhub/mcp-server"],
      "env": {
        "BROWSERHUB_URL": "http://localhost:3000",
        "BROWSERHUB_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

### Claude Code (CLI)

Add to `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "browserhub": {
      "command": "npx",
      "args": ["-y", "@browserhub/mcp-server"],
      "env": {
        "BROWSERHUB_URL": "http://localhost:3000",
        "BROWSERHUB_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

Or add globally via `claude mcp add`:

```bash
claude mcp add browserhub npx -- -y @browserhub/mcp-server
```

---

### VS Code (with MCP extension)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "browserhub": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@browserhub/mcp-server"],
      "env": {
        "BROWSERHUB_URL": "http://localhost:3000",
        "BROWSERHUB_API_KEY": "${input:browserhub_api_key}"
      }
    }
  }
}
```

---

### Cursor / Windsurf

In the IDE's MCP settings panel, add a new stdio server:

- **Name:** BrowserHub
- **Command:** `npx`
- **Args:** `-y @browserhub/mcp-server`
- **Env vars:** `BROWSERHUB_URL=http://localhost:3000`, `BROWSERHUB_API_KEY=YOUR_KEY`

---

### httpStream clients (URL-only)

For clients that only accept a URL (no env var support):

```
http://localhost:7420/mcp
```

The `httpStream` transport still requires `BROWSERHUB_API_KEY` set on the server side — there is no token-in-URL mode in v1 (intentionally, to avoid tokens in browser history / logs).

---

## 7. MCP Server Implementation Notes

The MCP server (`mcp-server.js`) is a thin translation layer. It:

1. Starts an MCP protocol handler (stdio or HTTP using the `@modelcontextprotocol/sdk` package)
2. Declares all nine tools using the schemas in section 3
3. On each tool call, translates MCP parameters into a BrowserHub REST request (with the service API key in the header)
4. Returns the BrowserHub response as the MCP tool result

The server does **not** run Playwright itself — it only calls BrowserHub's REST API. This means:
- The MCP server can run anywhere (developer's machine, CI, cloud) as long as it can reach the BrowserHub instance
- BrowserHub is always the source of truth for session state
- The MCP server is stateless and can be restarted without losing sessions

**Key dependency:** `@modelcontextprotocol/sdk` (official MCP TypeScript SDK) — or the community JavaScript equivalent if TypeScript is not used in this codebase. Given BrowserHub is plain Node.js with no transpiler, use the SDK's CommonJS build or a pure-JS implementation.

---

## 8. Example AI Interaction

The following is what the AI-driven turn sequence looks like from the inside, using the `bh_session` tool:

```
AI: I need to log into the site and check my order history.

→ calls bh_session { method: "open" }
← { sessionId: "a1b2c3", status: "active" }

→ calls bh_session { sessionId: "a1b2c3", method: "navigate", params: { url: "https://shop.example.com/login" } }
← { url: "https://shop.example.com/login", title: "Login" }

→ calls bh_session { sessionId: "a1b2c3", method: "capture" }
← { elements: [ { index: 1, tag: "input", label: "Email" }, { index: 2, tag: "input", label: "Password" }, { index: 3, tag: "button", text: "Sign in" } ] }

→ calls bh_session {
    sessionId: "a1b2c3",
    commands: [
      { method: "fill", params: { selector: "[data-hub-idx='1']", text: "alice@example.com" } },
      { method: "fill", params: { selector: "[data-hub-idx='2']", text: "mypassword" } },
      { method: "tap",  params: { selector: "[data-hub-idx='3']" } }
    ]
  }
← { results: [{ ok: true }, { ok: true }, { ok: true }] }

→ calls bh_session { sessionId: "a1b2c3", method: "awaitLoad" }
← { url: "https://shop.example.com/dashboard", title: "My Account" }

→ calls bh_session { sessionId: "a1b2c3", method: "navigate", params: { url: "https://shop.example.com/orders" } }
→ calls bh_session { sessionId: "a1b2c3", method: "capture" }
← { elements: [ { index: 1, tag: "h1", text: "Order History" }, { index: 2, text: "Order #1001 — 3 items — $149.99" }, ... ] }

AI: Your order history shows 3 recent orders. Order #1001 contains 3 items totalling $149.99...

→ calls bh_session { sessionId: "a1b2c3", method: "end" }
← { closed: true }
```
