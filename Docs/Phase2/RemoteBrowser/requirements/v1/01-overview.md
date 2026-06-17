# BrowserHub LiveBrowser — Feature Overview
## Requirements v1 · Phase 2 · Remote Browser Module

---

## 1. What Is LiveBrowser?

**LiveBrowser** is a stateful, session-aware browser control layer built natively into BrowserHub. It turns BrowserHub's existing Playwright engine into an interactive, multi-step automation surface that an AI assistant — or any external tool — can drive across many turns without losing page state between calls.

Unlike BrowserHub's existing single-shot scraping (`/api/scan`, pipeline sources), LiveBrowser keeps a real Chromium browser context alive between requests. Cookies, local storage, session tokens, and navigation history persist until the caller explicitly closes the session or it times out.

The module ships two capability tiers:

| Tier | Tool Name | Style | Best For |
|------|-----------|-------|----------|
| **Session Driver** | `hub_browser` | Stateful, multi-turn | Logins, multi-step forms, paginated flows, reactive navigation |
| **Page Tools** | `hub_fetch`, `hub_crawl`, `hub_audit`, `hub_map`, `hub_export`, `hub_search`, `hub_download`, `hub_script` | Stateless, one-shot | Single-page content, site audits, batch crawls, file downloads |

---

## 2. Why This Belongs in BrowserHub

BrowserHub Phase 1 is a batch-oriented scraper. Every job starts fresh — a new Chromium page, no prior state, no interaction. That is the right model for reading public data.

But a large class of real-world automation tasks require *interaction over time*:

- Signing into a web application and then reading protected pages
- Filling multi-step forms (checkout flows, onboarding wizards, application portals)
- Navigating paginated search results where each page requires a button click
- Responding to dynamic content — consent dialogs, lazy-loaded widgets, captchas that appear mid-session
- Allowing an AI assistant to reason about what it sees, decide what to do, and act — repeatedly

None of these are possible with a stateless scrape. LiveBrowser fills that gap by extending BrowserHub's Playwright engine with persistent browser sessions, an element-capture protocol, and a command interface that can be driven turn-by-turn by any caller: the BrowserHub UI, a REST client, an AI assistant via MCP, or another service.

---

## 3. Design Goals

### 3.1 Fit Naturally Into BrowserHub

- Reuse the existing Playwright installation — no second browser engine
- Plug into BrowserHub's existing authentication (JWT, API keys)
- Stream real-time events over the existing Socket.io channel
- Store session metadata in BrowserHub's JSON file store (same pattern as scan jobs)
- Follow the same code conventions as the rest of the codebase

### 3.2 AI-Ready But Not AI-Only

LiveBrowser is a general-purpose stateful browser API. An AI assistant is one consumer; a CI/CD script, a no-code integration, or a human-driven test runner are equally valid consumers. AI integration is handled at the MCP layer (Document 05) and is optional.

### 3.3 Capture-First Interaction Model

Every interaction is grounded in a **capture** — a structured snapshot of every meaningful element currently visible on the page. The caller always knows what is on the page before deciding what to act on. This prevents acting on stale selectors and gives AI assistants the context they need to reason and plan.

### 3.4 Minimal External Dependencies

Session Driver is built entirely on top of Playwright's existing API (`BrowserContext`, `Page`). No additional headless cloud service is required. BrowserHub remains fully self-contained and self-hosted.

### 3.5 Safe Defaults

- Sessions time out automatically after a configurable idle period (default: 10 minutes)
- Maximum concurrent sessions are capped per-user and globally
- All commands run inside the BrowserHub process; no shell execution from user input
- Session isolation: each session gets its own `BrowserContext` — cookies and storage are not shared between sessions

---

## 4. Scope for This Requirements Document Set

This document set covers the initial `v1` specification of the LiveBrowser module. It is written for a **community developer** who will implement LiveBrowser as a self-contained addition to BrowserHub's existing Node.js codebase.

### In Scope (v1)

- Stateful `hub_browser` session API — full command set
- Session lifecycle management (create, run, inspect, close, timeout)
- Element capture protocol — structured page snapshots with stable selectors
- Eight stateless Page Tools (`hub_fetch`, `hub_crawl`, `hub_audit`, `hub_map`, `hub_export`, `hub_search`, `hub_download`, `hub_script`)
- Command batching for same-page multi-action sequences
- Structured error codes with recovery hints
- MCP server definition — expose LiveBrowser as a Model Context Protocol tool set
- Integration with BrowserHub's existing auth, Socket.io, and data store
- Live view URL generation (shareable Chromium DevTools Protocol port or screenshot stream)

### Out of Scope (v1)

- GUI management of sessions in the BrowserHub web UI (a future Phase 2 task)
- Session recording/replay
- Distributed session routing across multiple BrowserHub instances
- Cloud proxy integration beyond what BrowserHub's existing stealth layer provides
- CAPTCHA solving (may be added in v2 as a plugin)
- Mobile browser emulation profiles (layout-aware capture only in v1)

---

## 5. Success Criteria

A v1 implementation is complete when:

1. A caller can create a session, navigate to a URL, capture the page, click an element by its captured selector, and read the resulting page — all via REST API calls
2. Sessions survive across multiple REST calls (cookies, storage, history are maintained)
3. Sessions time out and are cleaned up when idle
4. All eight stateless Page Tools return structured results via their respective REST endpoints
5. The MCP server starts correctly and exposes all tools to an MCP-compatible client (Claude Desktop, Claude Code, VS Code, Cursor)
6. BrowserHub's existing routes and features are not broken by the addition
7. Session events (navigation, capture, errors) are emitted over Socket.io
8. The module works with BrowserHub's existing JWT and API key authentication

---

## 6. Document Map

| Doc | Title | Contents |
|-----|-------|----------|
| `01-overview.md` | This file | Goals, scope, success criteria |
| `02-architecture.md` | System Architecture | Components, data flow, session lifecycle, integration points |
| `03-session-api.md` | Session Driver API | All `hub_browser` methods, parameters, return shapes |
| `04-page-tools-api.md` | Page Tools API | Eight stateless tools, endpoints, schemas |
| `05-mcp-integration.md` | MCP Server Spec | Tool definitions, auth, transport, client setup |
| `06-implementation-guide.md` | Developer Guide | File layout, step-by-step build order, testing checklist |
