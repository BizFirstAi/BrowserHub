# BrowserHub .NET Guidelines — Index

These guidelines define the coding standards for the BrowserHub ASP.NET Core 9 implementation (`src/api-dot-net/`). They are based on enterprise .NET patterns and are adapted for the open source project.

All contributors to the .NET version must read these before submitting a PR.

## Documents

| File | Scope |
|------|-------|
| [domain.md](./domain.md) | Domain models, interfaces, repository contracts, web request objects |
| [infrastructure.md](./infrastructure.md) | DbContext, EF Core, repository implementations, DI registration |
| [services.md](./services.md) | Service layer, guard validations, logging, orchestrators |
| [api-layer.md](./api-layer.md) | Controllers, route conventions, rate limiting, auth attributes |
| [extended-service.md](./extended-service.md) | Cross-module orchestration |

## Quick Summary

```
BrowserHub.Domain          ← models, interfaces — no EF, no ASP.NET
BrowserHub.Infrastructure  ← DbContext, EF, repositories
BrowserHub.Service         ← business logic, orchestrators
BrowserHub.Api.Base        ← abstract base controllers
BrowserHub.Api             ← concrete controllers (thin adapters only)
```

The domain layer has zero infrastructure dependencies. The service layer has zero EF Core types. Controllers have zero business logic. Each layer only depends on the layer directly below it via interfaces.

## Key Rules at a Glance

1. **One file per class.** No exceptions.
2. **One global `Using.cs` per project.** No per-file `using` directives.
3. **Guard every injected dependency** with `?? throw new ArgumentNullException(...)`.
4. **All service methods:** guard inputs → log → delegate to repository. Three lines per method in most cases.
5. **Controllers return `IActionResult` only.** No model types, no exceptions, no business logic.
6. **Repositories do data access only.** No business rules, no cross-entity joins.
7. **Async all the way down.** No `.Result`, no `.Wait()`, no synchronous EF queries.
8. **CancellationToken on every async method.** Default value `= default`.
