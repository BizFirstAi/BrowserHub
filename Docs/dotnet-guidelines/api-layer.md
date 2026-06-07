# API Layer Guidelines (`BrowserHub.Api` + `BrowserHub.Api.Base`)

## 1. Two-Project Split

**`BrowserHub.Api.Base`** — abstract base controllers with routes, HTTP attributes, rate limiting, auth attributes. Depends only on Domain.

**`BrowserHub.Api`** — concrete controllers that inherit from base. Contains DI registration, Swagger config, Program.cs. No business logic.

## 2. Global Using.cs

```csharp
// BrowserHub.Api/Using.cs
global using Microsoft.AspNetCore.Mvc;
global using Microsoft.AspNetCore.Http;
global using Microsoft.Extensions.Logging;
global using Microsoft.AspNetCore.Authorization;
global using BrowserHub.Api.Base.Controllers;
global using BrowserHub.Domain.Interfaces.Services;
global using BrowserHub.Domain.Entities;
global using BrowserHub.Domain.WebRequests.Scan;
global using BrowserHub.Domain.WebRequests.Pipeline;
```

## 3. Base Controller Structure

```csharp
[Route("api/v1/browser-hub/scans")]
[ApiController]
public abstract class BaseScanController : ControllerBase
{
    protected readonly IScanService ScanService;
    protected readonly ILogger Logger;

    protected BaseScanController(IScanService scanService, ILogger logger)
    {
        ScanService = scanService ?? throw new ArgumentNullException(nameof(scanService));
        Logger      = logger     ?? throw new ArgumentNullException(nameof(logger));
    }
}
```

- Class is `abstract` — never instantiated directly.
- Route format: `api/v1/{domain}/{resource-kebab-case}`.
- Guard every injected service with `?? throw new ArgumentNullException(...)`.

## 4. Standard CRUD Endpoints

All methods are `virtual` so the concrete controller can override if needed.

```csharp
[HttpGet]
[Authorize]
public virtual async Task<IActionResult> GetAll([FromQuery] ScanListRequest request, CancellationToken ct = default)
{
    var result = await ScanService.GetPagedAsync(request, ct);
    return Ok(result);
}

[HttpGet("{id:guid}")]
[Authorize]
public virtual async Task<IActionResult> GetById(Guid id, CancellationToken ct = default)
{
    var item = await ScanService.GetByIdAsync(id, ct);
    if (item is null) return NotFound();
    return Ok(item);
}

[HttpPost]
[Authorize]
public virtual async Task<IActionResult> Create([FromBody] CreateScanRequest request, CancellationToken ct = default)
{
    var result = await ScanService.CreateAsync(request, ct);
    return CreatedAtAction(nameof(GetById), new { id = result.ScanID }, result);
}

[HttpPut("{id:guid}")]
[Authorize]
public virtual async Task<IActionResult> Update(Guid id, [FromBody] UpdateScanRequest request, CancellationToken ct = default)
{
    if (id != request.ScanID) return BadRequest("ID mismatch.");
    var result = await ScanService.UpdateAsync(request, ct);
    return Ok(result);
}

[HttpDelete("{id:guid}")]
[Authorize]
public virtual async Task<IActionResult> Delete(Guid id, CancellationToken ct = default)
{
    await ScanService.SoftDeleteAsync(id, ct);
    return NoContent();
}
```

## 5. Concrete Controller

```csharp
public class ScanController : BaseScanController
{
    public ScanController(IScanService scanService, ILogger<ScanController> logger)
        : base(scanService, logger) { }

    // All methods inherited — override only if specific behaviour differs in this deployment
}
```

- No route, HTTP verb, or authorization attributes on the concrete class.
- Constructor only passes dependencies up to base.
- No business logic, no service calls, no validation.

## 6. Rate Limiting

Use ASP.NET Core's built-in rate limiter (`.NET 7+`):

```csharp
// Program.cs
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("ReadPolicy", ctx =>
        RateLimitPartition.GetSlidingWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
            _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = 100, Window = TimeSpan.FromMinutes(1), SegmentsPerWindow = 4
            }));

    options.AddPolicy("WritePolicy", ctx =>
        RateLimitPartition.GetSlidingWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
            _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = 20, Window = TimeSpan.FromMinutes(1), SegmentsPerWindow = 4
            }));
});

// On endpoints
app.MapGet("/api/v1/...", ...).RequireRateLimiting("ReadPolicy");
app.MapPost("/api/v1/...", ...).RequireRateLimiting("WritePolicy");
```

## 7. Error Response Format

All controllers rely on a global exception handler — never catch exceptions and return `500` manually.

```csharp
// Program.cs
app.UseExceptionHandler(app => app.Run(async ctx =>
{
    ctx.Response.ContentType = "application/json";
    ctx.Response.StatusCode  = 500;
    await ctx.Response.WriteAsJsonAsync(new { error = "An unexpected error occurred." });
}));
```

For business rule violations, throw domain exceptions from the service layer:

```csharp
// Service layer throws
throw new ValidationException("ScanType must be 'sitemap' or 'urls'.");

// Global handler in Program.cs catches and returns 400 for ValidationException
```

## 8. General Rules

- All methods are `async Task<IActionResult>` with `CancellationToken ct = default`.
- Always use `[FromBody]` for complex types; route params only for ID matching.
- Never throw exceptions in controller methods — let the global handler deal with it.
- Use `#region` to group CRUD and custom query methods.
