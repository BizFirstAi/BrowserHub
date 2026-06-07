# Infrastructure Layer Guidelines (`BrowserHub.Infrastructure`)

## 1. Global Using.cs

```csharp
global using Microsoft.EntityFrameworkCore;
global using Microsoft.Extensions.Logging;
global using Microsoft.Extensions.DependencyInjection;
global using Microsoft.Extensions.Configuration;
global using BrowserHub.Domain.Entities;
global using BrowserHub.Domain.Interfaces.Repositories;
global using BrowserHub.Infrastructure.Data;
global using BrowserHub.Infrastructure.Repositories;
global using BrowserHub.Domain.WebRequests.Scan;
// ... all WebRequest namespaces
```

## 2. DbContext

One `DbContext` per module. Location: `Data/BrowserHubDbContext.cs`.

- Constructor takes `DbContextOptions<T>`.
- One `DbSet<T>` per entity, initialized to `null!`.
- Group `DbSet` properties with comment headers.
- `OnModelCreating` must configure every entity explicitly.

```csharp
public class BrowserHubDbContext : DbContext
{
    public BrowserHubDbContext(DbContextOptions<BrowserHubDbContext> options) : base(options) { }

    // Scanning
    public DbSet<Scan>        Scans        { get; set; } = null!;
    public DbSet<ScanFinding> ScanFindings { get; set; } = null!;

    // Pipeline
    public DbSet<PipelineRun>    PipelineRuns    { get; set; } = null!;
    public DbSet<PipelineRecord> PipelineRecords { get; set; } = null!;

    // Studio
    public DbSet<Project>    Projects    { get; set; } = null!;
    public DbSet<DataRecord> DataRecords { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Scan
        modelBuilder.Entity<Scan>(entity =>
        {
            entity.ToTable("BH_Scans");
            entity.HasKey(e => e.ScanID);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.StartedAt);
            entity.HasQueryFilter(e => !e.IsDeleted);  // global soft-delete filter
        });

        // ... configure each entity
    }
}
```

### OnModelCreating Rules

For **every** entity:
- `entity.ToTable("BH_{TableName}")` — always explicit table name.
- `entity.HasKey(e => e.{Entity}ID)` — explicit primary key.
- `entity.HasIndex(...)` for every foreign key and frequently-queried column.
- `entity.HasIndex(...).IsUnique()` for natural unique keys.
- `entity.HasQueryFilter(e => !e.IsDeleted)` — global soft-delete filter.

## 3. Repository Implementation

One file per entity. Location: `Repositories/{Entity}Repository.cs`.

- Inherits `Repository<TEntity, TKey>`. Implements `I{Entity}Repository`.
- Constructor takes `DbContext` + `ILogger<T>`.
- Use `DbSet.AsQueryable()` → `.Where(...)`.
- `LogDebug` at the start of every method.
- Use `#region Interface Methods` to group.

```csharp
public class ScanRepository : Repository<Scan, Guid>, IScanRepository
{
    public ScanRepository(BrowserHubDbContext context, ILogger<ScanRepository> logger)
        : base(context, logger) { }

    #region Interface Methods

    public async Task<IReadOnlyList<Scan>> GetByStatusAsync(string status, CancellationToken ct = default)
    {
        Logger.LogDebug("Getting Scans by Status: {Status}", status);
        return await DbSet.AsQueryable()
            .Where(s => s.Status == status)
            .OrderByDescending(s => s.StartedAt)
            .ToListAsync(ct);
    }

    public async Task<PagedResult<Scan>> GetPagedAsync(ScanListRequest request, CancellationToken ct = default)
    {
        Logger.LogDebug("Getting paged Scans, page {Page}", request.Page);
        var query = DbSet.AsQueryable();
        if (!string.IsNullOrEmpty(request.Status))
            query = query.Where(s => s.Status == request.Status);

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderByDescending(s => s.StartedAt)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .ToListAsync(ct);

        return new PagedResult<Scan>(items, total, request.Page, request.PageSize);
    }

    #endregion
}
```

## 4. DependencyInjection.cs

One static `DependencyInjection` class per project. Extension method: `AddBrowserHubInfrastructure`.

```csharp
public static class DependencyInjection
{
    public static IServiceCollection AddBrowserHubInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration,
        string connectionStringName = "DefaultConnection")
    {
        services.AddDbContext<BrowserHubDbContext>(options =>
            options.UseSqlServer(configuration.GetConnectionString(connectionStringName)));

        // Scanning
        services.AddScoped<IScanRepository, ScanRepository>();
        services.AddScoped<IScanFindingRepository, ScanFindingRepository>();

        // Pipeline
        services.AddScoped<IPipelineRunRepository, PipelineRunRepository>();
        services.AddScoped<IPipelineRecordRepository, PipelineRecordRepository>();

        // Studio
        services.AddScoped<IProjectRepository, ProjectRepository>();
        services.AddScoped<IDataRecordRepository, DataRecordRepository>();

        return services;
    }
}
```

## 5. General Rules

- No business logic in repositories — only data access (query, filter, paginate).
- Never call one repository from another repository. Cross-entity operations go in the service layer.
- All repository methods must be `async` with `CancellationToken`. No synchronous EF queries.
- Never call `.Result` or `.Wait()` on async methods.
