# BrowserHub — Node.js REST API (Dedicated Server)

> **Status: Not Yet Started — Community Contributions Welcome**

This folder will contain a standalone Node.js REST API for BrowserHub — with no embedded UI, no session state, and no HTML pages. It is designed to be deployed as a headless microservice behind an API gateway or load balancer.

## Why a dedicated API server?

The all-in-one version in `../ui-js/browser-hub-ui/` bundles the API and the UI into a single process. That is the right choice for local use and small deployments.

For production at scale, you want to separate concerns:

- **API server** (this folder) — handles Playwright jobs, TTS, pipeline runs, auth. Stateless where possible. Horizontally scalable.
- **Frontend** (`../ui-react/` or `../ui-js/`) — deployed as static files on a CDN or any static host.

This separation also makes it straightforward to put an API gateway, rate limiter, or WAF in front of the scraping service without touching the UI.

## Planned Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | Express 4 |
| Realtime | Socket.io 4 |
| Browser automation | Playwright (Chromium) |
| Auth | JWT, API keys (no sessions) |
| Storage | Pluggable — JSON files by default, MongoDB adapter planned |
| Process management | PM2 |
| Containerisation | Docker |

## Planned API Routes

Identical to the routes in `../ui-js/browser-hub-ui/server.js`. See [`../../Docs/api-reference.md`](../../Docs/api-reference.md) for the full specification.

## How to Contribute

1. Fork the repository
2. Create your implementation in `src/api-node-server/browser-hub-server/`
3. Implement the routes documented in `../../Docs/api-reference.md`
4. Write tests using Vitest or Jest
5. Include a `Dockerfile`
6. Open a PR against the `dev` branch

The goal is that the React UI and the Vanilla JS UI both work identically against this server and against the all-in-one server in `ui-js`.

## Key Differences from the All-In-One Version

| Concern | All-In-One (`ui-js`) | This version |
|---------|---------------------|-------------|
| Serves HTML | Yes | No (API only) |
| Static file serving | Yes | No |
| CORS | Not needed | Required |
| Sessions | Cookie-based option | JWT only |
| Horizontal scaling | Single process | Multi-process / container fleet |
| Deployment | `node server.js` | `pm2 start` / Docker |
