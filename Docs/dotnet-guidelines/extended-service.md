# Extended Service (Orchestrator) Guidelines

An orchestrator coordinates logic that spans multiple services or subsystems.

## 1. Core Rule

- An orchestrator must **never access infrastructure directly**. No repository injections, no `DbContext`, no EF Core.
- It must only call **service interfaces** (e.g. `IScanService`, `IPipelineRunService`).
- Never inject a repository from a different module — always go through that module's service layer.

## 2. Naming and Scope

- Name the class `{Domain}Orchestrator` — e.g. `ScanOrchestrator`, `PipelineOrchestrator`.
- Declare as `internal sealed` — Orchestrators are implementation details, not public API.
- Implement a matching interface: `I{Domain}Orchestrator`.
- Location: `Orchestrators/` subfolder.

## 3. Constructor and Dependencies

- Inject all dependencies via constructor — no service locator, no static access.
- Guard **every** injected dependency with `?? throw new ArgumentNullException(...)`.

```csharp
internal sealed class PipelineOrchestrator : IPipelineOrchestrator
{
    private readonly IPipelineRunService  _pipelineRunService;
    private readonly IProjectService      _projectService;
    private readonly IDataRecordService   _recordService;
    private readonly ILogger<PipelineOrchestrator> _logger;

    public PipelineOrchestrator(
        IPipelineRunService  pipelineRunService,
        IProjectService      projectService,
        IDataRecordService   recordService,
        ILogger<PipelineOrchestrator> logger)
    {
        _pipelineRunService = pipelineRunService ?? throw new ArgumentNullException(nameof(pipelineRunService));
        _projectService     = projectService     ?? throw new ArgumentNullException(nameof(projectService));
        _recordService      = recordService      ?? throw new ArgumentNullException(nameof(recordService));
        _logger             = logger             ?? throw new ArgumentNullException(nameof(logger));
    }
}
```

## 4. Business Logic Placement

All conditional logic (flow control, access checks, tenant isolation) lives **in the Orchestrator**, not in the controller.

Use numbered comments to document each step of a multi-step flow:

```csharp
public async Task<PipelineResult> RunAsync(RunPipelineRequest request, CancellationToken ct = default)
{
    // Step 1 — Validate sources
    // Step 2 — Create run record
    // Step 3 — Execute each source
    // Step 4 — Normalize and deduplicate
    // Step 5 — Save to dataset if requested
}
```

## 5. Error Handling

Wrap the entire orchestration flow in a `try/catch` that converts unexpected errors to a safe result:

```csharp
public async Task<PipelineResult> RunAsync(RunPipelineRequest request, CancellationToken ct = default)
{
    try
    {
        return await RunInternalAsync(request, ct);
    }
    catch (OperationCanceledException)
    {
        throw;  // let the framework return 499/408
    }
    catch (ValidationException ex)
    {
        _logger.LogWarning(ex, "Validation failed for pipeline run");
        return PipelineResult.Failed(ex.Message);
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Unexpected error in PipelineOrchestrator");
        return PipelineResult.Failed("An unexpected error occurred.");
    }
}
```

- `OperationCanceledException` → rethrow (let the framework handle 408/499).
- Domain validation exceptions → log warning + return domain failure result.
- All other exceptions → log error + return generic failure result.
- Never propagate internal error details to the HTTP response.

## 6. Audit Logging

Wrap audit calls in a helper that **never throws** — audit failures must not break the primary flow:

```csharp
private async Task AuditAsync(string action, string detail)
{
    try
    {
        await _auditService.LogAsync(action, detail);
    }
    catch (OperationCanceledException ex)
    {
        _logger.LogInformation(ex, "Audit cancelled.");
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Audit failed — flow continues.");
    }
}
```

## 7. General Rules

- Orchestrators are stateless — no mutable fields beyond readonly injected dependencies.
- Never use `[Route]`, `[HttpGet]`, or any HTTP attributes.
- All methods must be `async Task<T>` with `CancellationToken ct = default`.
- If a method has more than ~10 steps, extract the steps into a private `{MethodName}InternalAsync`.
