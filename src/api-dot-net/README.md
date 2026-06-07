# BrowserHub — .NET 9 / ASP.NET Core MVC API

> **Status: Not Yet Started — Community Contributions Welcome**

This folder will contain a full .NET 9 implementation of the BrowserHub REST API using ASP.NET Core MVC and SQL Server (or SQLite for local development). It exposes the same API surface as the Node.js versions so any BrowserHub frontend works against it unchanged.

## Why a .NET version?

Many enterprise teams standardise on .NET. For them, a Node.js dependency is a political blocker even when the technology is technically sound. The .NET version exists so those teams can:

- Deploy to IIS, Azure App Service, or on-premise Windows Server without installing Node.js
- Use SQL Server (or PostgreSQL/SQLite) instead of JSON files for persistence
- Integrate with Azure Active Directory for auth
- Use the ASP.NET Core middleware pipeline they already know (rate limiting, logging, health checks)
- Write C# unit and integration tests with xUnit

The Playwright automation layer still requires Chromium (downloaded via the Playwright .NET NuGet package), but everything else is native .NET.

## Planned Stack

| Layer | Technology |
|-------|-----------|
| Framework | ASP.NET Core MVC 9 |
| Language | C# 13 |
| ORM | Entity Framework Core 9 |
| Database | SQL Server 2022 (SQLite for local dev) |
| Browser automation | Microsoft.Playwright (official .NET binding) |
| Auth | ASP.NET Core Identity + JWT bearer tokens |
| Realtime | SignalR (replaces Socket.io) |
| TTS | Microsoft Cognitive Services Speech SDK (or msedge-tts via Node subprocess) |
| Testing | xUnit, Moq, Playwright.NUnit |
| Containerisation | Docker (mcr.microsoft.com/dotnet/aspnet:9.0) |

## Planned Project Structure

```
browser-hub-dotnet/
├── BrowserHub.sln
├── src/
│   ├── BrowserHub.Api/             # ASP.NET Core MVC controllers + middleware
│   ├── BrowserHub.Core/            # Domain models + interfaces
│   ├── BrowserHub.Infrastructure/  # EF Core, SQL Server repos, Playwright service
│   └── BrowserHub.Shared/          # DTOs shared between API and clients
└── tests/
    ├── BrowserHub.Api.Tests/        # Controller + integration tests
    └── BrowserHub.Core.Tests/       # Domain logic unit tests
```

## Key API Equivalences

| Node.js route | .NET controller action |
|--------------|----------------------|
| `POST /api/pipeline/run` | `PipelineController.Run()` |
| `GET /api/pipeline/run/:id` | `PipelineController.GetRun(string id)` |
| `POST /api/tts/jobs` | `TtsController.CreateJob()` |
| `GET /api/tts/jobs/:id` | `TtsController.GetJob(string id)` |
| `POST /api/scan` | `ScanController.StartScan()` |
| `GET /api/studio/projects` | `ProjectsController.List()` |

## Database Schema

SQL Server migrations will be managed by EF Core. Phase 1 tables:

- `Jobs` — all async jobs (scan, pipeline, TTS, video)
- `Projects` — project/dataset hierarchy
- `Records` — scraped data records (JSON column for flexible schema)
- `ApiKeys` — user API keys
- `AuditLog` — auth and job events

## How to Contribute

1. Fork the repository
2. Install .NET 9 SDK and SQL Server (or use the included Docker Compose for a local SQL Server)
3. Create your implementation in `src/api-dot-net/browser-hub-dotnet/`
4. Implement the routes from [`../../Docs/api-reference.md`](../../Docs/api-reference.md)
5. All controllers should return the **same JSON shape** as the Node.js API
6. Open a PR against the `dev` branch with passing tests

## Realtime: SignalR vs Socket.io

The Node.js version uses Socket.io. The .NET version uses **SignalR**, which is Microsoft's equivalent. The browser client library differs, so the React UI will need a small adapter layer (`@microsoft/signalr` instead of `socket.io-client`). The Vanilla JS UI includes a thin compatibility shim at `browser-studio/realtime-adapter.js` (planned).

## Phase 1 Scope

Phase 1 of the .NET version covers:

- [ ] Project + Dataset CRUD (`/api/studio/projects`)
- [ ] Pipeline run API (`/api/pipeline/run`)
- [ ] TTS job API (`/api/tts/jobs`)
- [ ] Auth: JWT bearer + API keys
- [ ] SQL Server persistence via EF Core
- [ ] Docker Compose (app + SQL Server)

AI features are explicitly **out of scope** for Phase 1. See [`../../Ai/README.md`](../../Ai/README.md).
