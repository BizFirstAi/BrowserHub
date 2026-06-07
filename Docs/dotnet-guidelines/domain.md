# Domain Layer Guidelines (`BrowserHub.Domain`)

## 1. Global Using.cs

One `Using.cs` at project root — all `global using` directives, no per-file usings.

```csharp
global using System.ComponentModel.DataAnnotations;
global using System.ComponentModel.DataAnnotations.Schema;
global using BrowserHub.Domain.Entities;
global using BrowserHub.Domain.Interfaces.Repositories;
global using BrowserHub.Domain.Interfaces.Services;
global using BrowserHub.Domain.WebRequests.Scan;
global using BrowserHub.Domain.WebRequests.Pipeline;
// ... all WebRequest namespaces
```

## 2. Entities

One file per entity. Filename: `{Entity}.cs`. Location: `Entities/` folder.

- Primary key property: `{Entity}ID` (not `Id`). Decorated with `[Key]`.
- Required string columns: `[Required]` + `[StringLength(N)]` + default `= string.Empty`.
- Nullable columns: use nullable type (`string?`, `int?`) — no `[Required]` on nullable.
- Boolean flags default inline: `= true` or `= false`.
- XML `<summary>` on the class and on every property.

```csharp
/// <summary>
/// Represents a browser scan job.
/// Database table: BH_Scans
/// </summary>
public class Scan
{
    [Key]
    public Guid ScanID { get; set; } = Guid.NewGuid();

    /// <summary>Type of scan: "sitemap" or "urls"</summary>
    [Required]
    [StringLength(20)]
    public string ScanType { get; set; } = string.Empty;

    /// <summary>Comma-separated URLs or sitemap URL</summary>
    [Required]
    public string Input { get; set; } = string.Empty;

    /// <summary>Current status of the scan job</summary>
    [Required]
    [StringLength(20)]
    public string Status { get; set; } = "queued";

    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }

    [Required]
    public bool IsDeleted { get; set; } = false;
}
```

## 3. Repository Interfaces

One file per entity. Location: `Interfaces/Repositories/`.

- Inherits `IRepository<TEntity, TKey>` — standard CRUD methods come from base.
- Declare only domain-specific query methods beyond standard CRUD.
- All methods: `async Task<T>` with typed request + `CancellationToken`.
- XML `<summary>` on the interface and on each method.

```csharp
/// <summary>Repository interface for Scan entities</summary>
public interface IScanRepository : IRepository<Scan, Guid>
{
    /// <summary>Returns scans filtered by status</summary>
    Task<IReadOnlyList<Scan>> GetByStatusAsync(string status, CancellationToken ct = default);

    /// <summary>Returns paginated scan list for a user</summary>
    Task<PagedResult<Scan>> GetPagedAsync(ScanListRequest request, CancellationToken ct = default);
}
```

## 4. Service Interfaces

One file per entity. Location: `Interfaces/Services/`.

- Inherits `IBaseService<TEntity, TKey>`.
- Declare only domain-specific service methods.
- Group methods in `#region` blocks.
- XML `<summary>`, `<param>`, `<returns>` on every method.

```csharp
public interface IScanService : IBaseService<Scan, Guid>
{
    #region Scan Queries
    /// <summary>Returns scans filtered by status</summary>
    Task<IReadOnlyList<Scan>> GetByStatusAsync(string status, CancellationToken ct = default);
    #endregion

    #region Scan Operations
    /// <summary>Cancels a running scan</summary>
    Task<bool> CancelAsync(Guid scanId, CancellationToken ct = default);
    #endregion
}
```

## 5. WebRequests

One subfolder per entity under `WebRequests/{Entity}/`.

One file per request type. All request classes inherit `BaseWebRequest`.

```csharp
namespace BrowserHub.Domain.WebRequests.Scan;

public class CreateScanRequest : BaseWebRequest
{
    [Required]
    public string ScanType { get; set; } = string.Empty;  // "sitemap" | "urls"

    [Required]
    public string Input { get; set; } = string.Empty;
}

public class ScanListRequest : BaseWebRequest
{
    public string? Status { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
}
```

## 6. No Infrastructure in Domain

The Domain project has **zero** references to EF Core, `DbContext`, or any infrastructure package.

```
// WRONG — never in Domain
using Microsoft.EntityFrameworkCore;

// CORRECT — Domain only defines contracts
using System.ComponentModel.DataAnnotations;
```
