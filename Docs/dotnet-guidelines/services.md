# Service Layer Guidelines (`BrowserHub.Service`)

## 1. Global Using.cs

```csharp
global using System;
global using System.Collections.Generic;
global using System.Linq;
global using System.Threading;
global using System.Threading.Tasks;
global using Microsoft.Extensions.Logging;
global using Microsoft.Extensions.DependencyInjection;
global using BrowserHub.Domain.Entities;
global using BrowserHub.Domain.Interfaces.Repositories;
global using BrowserHub.Domain.Interfaces.Services;
global using BrowserHub.Domain.WebRequests.Scan;
global using BrowserHub.Domain.WebRequests.Pipeline;
// ... all WebRequest namespaces
```

## 2. Service Implementation

One file per entity. Location: `Services/{Entity}Service.cs`.

- Inherits `BaseService<TEntity, TKey>`. Implements `I{Entity}Service`.
- Private readonly `_repository` field.
- XML `<summary>` on class listing standards applied.

```csharp
/// <summary>
/// Service for Scan entity.
/// Standards: BaseService inheritance, Guard validations, Async + CancellationToken
/// </summary>
public class ScanService : BaseService<Scan, Guid>, IScanService
{
    private readonly IScanRepository _repository;

    public ScanService(IScanRepository repository, ILogger<ScanService> logger)
        : base(repository, logger)
    {
        _repository = repository;
    }
}
```

## 3. Method Pattern

Every service method must follow this exact pattern:

1. **Guard inputs** — validate before doing anything.
2. **Log** — one `LogInformation` line.
3. **Delegate** — one line calling the repository.

```csharp
public async Task<IReadOnlyList<Scan>> GetByStatusAsync(string status, CancellationToken ct = default)
{
    Guard.NotNullOrWhiteSpace(status, nameof(status));           // 1. Guard
    Logger.LogInformation("Getting Scans by Status: {Status}", status);  // 2. Log
    return await _repository.GetByStatusAsync(status, ct);      // 3. Delegate
}
```

Methods are `async Task<T>` with `CancellationToken cancellationToken = default`.

Group methods in `#region` blocks matching the interface.

## 4. Entity Validation

Override `ValidateAsync` in every service to enforce entity-level business rules:

```csharp
protected override async Task ValidateAsync(Scan entity, CancellationToken ct = default)
{
    await Task.CompletedTask;
    Guard.NotNullOrWhiteSpace(entity.ScanType, nameof(entity.ScanType));
    Guard.NotNullOrWhiteSpace(entity.Input, nameof(entity.Input));

    if (entity.ScanType != "sitemap" && entity.ScanType != "urls")
        throw new ArgumentException("ScanType must be 'sitemap' or 'urls'.");
}
```

This is called automatically by `BaseService.CreateAsync` and `UpdateAsync`.

## 5. DependencyInjection.cs

```csharp
public static class DependencyInjection
{
    public static IServiceCollection AddBrowserHubServices(this IServiceCollection services)
    {
        // Scanning
        services.AddScoped<IScanService, ScanService>();
        services.AddScoped<IScanFindingService, ScanFindingService>();

        // Pipeline
        services.AddScoped<IPipelineRunService, PipelineRunService>();

        // Studio
        services.AddScoped<IProjectService, ProjectService>();
        services.AddScoped<IDataRecordService, DataRecordService>();

        return services;
    }
}
```

## 6. Guard Class

```csharp
public static class Guard
{
    public static void NotNull<T>(T value, string paramName) where T : class
    {
        if (value is null)
            throw new ArgumentNullException(paramName);
    }

    public static void NotNullOrWhiteSpace(string? value, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new ArgumentException($"'{paramName}' cannot be null or whitespace.", paramName);
    }

    public static void PositiveInt(int value, string paramName)
    {
        if (value <= 0)
            throw new ArgumentOutOfRangeException(paramName, $"'{paramName}' must be positive.");
    }
}
```

## 7. General Rules

- Services may only call repositories from their own domain module.
- To call another module, use its **service interface** (never its repository).
- Never use EF Core types (`DbSet`, `IQueryable`, `DbContext`) in the service layer.
- Services are stateless and thread-safe — no mutable instance fields beyond readonly injected dependencies.
