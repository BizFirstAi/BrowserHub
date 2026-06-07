# Browser Hub — C# Conversion Design
**Source:** Node.js/Express + Playwright + Socket.IO  
**Target:** ASP.NET Core 8 + Playwright for .NET + SignalR  
**Date:** 2026-06-06

---

## 1. Solution Structure

```
BizFirst.BrowserHub/
├── BizFirst.BrowserHub.Api/                  ← ASP.NET Core 8 WebAPI host
│   ├── Controllers/
│   │   ├── AuthController.cs
│   │   ├── ScansController.cs
│   │   ├── SlidesController.cs
│   │   ├── ScraperController.cs
│   │   ├── TtsController.cs
│   │   ├── StudioController.cs
│   │   ├── DataRecordsController.cs
│   │   ├── WebhooksController.cs
│   │   ├── ProxiesController.cs
│   │   ├── MetricsController.cs
│   │   ├── ResourcesController.cs
│   │   ├── AdminController.cs
│   │   └── CleanupController.cs
│   ├── Hubs/
│   │   └── BrowserHubSignalR.cs              ← replaces Socket.IO rooms
│   ├── Middleware/
│   │   ├── AdminKeyMiddleware.cs
│   │   └── JobRateLimitMiddleware.cs
│   ├── Program.cs
│   └── appsettings.json
│
├── BizFirst.BrowserHub.Core/                 ← domain, interfaces, models
│   ├── Models/
│   │   ├── Scan.cs
│   │   ├── ScanFinding.cs
│   │   ├── Rule.cs
│   │   ├── ScanSettings.cs
│   │   ├── SlidesJob.cs
│   │   ├── ScraperJob.cs
│   │   ├── TtsJob.cs
│   │   ├── Project.cs
│   │   ├── Slide.cs
│   │   ├── DataRecord.cs
│   │   ├── Webhook.cs
│   │   ├── Proxy.cs
│   │   └── AppConfig.cs
│   ├── Interfaces/
│   │   ├── IStorageProvider.cs               ← local + S3
│   │   ├── IBrowserService.cs                ← Playwright abstraction
│   │   ├── IScanService.cs
│   │   ├── IScraperService.cs
│   │   ├── ITtsService.cs
│   │   ├── IVideoService.cs
│   │   ├── IProjectManager.cs
│   │   ├── IWebhookService.cs
│   │   ├── IMetricsService.cs
│   │   └── IAppConfigRepository.cs
│   └── Results/
│       ├── CaptureResult.cs
│       └── ScraperResult.cs
│
├── BizFirst.BrowserHub.Infrastructure/       ← implementations
│   ├── Storage/
│   │   ├── LocalStorageProvider.cs
│   │   └── S3StorageProvider.cs
│   ├── Browser/
│   │   ├── PlaywrightBrowserService.cs
│   │   ├── StealthContextFactory.cs
│   │   └── SitemapParser.cs
│   ├── Scanning/
│   │   └── ScanEngine.cs
│   ├── Scraping/
│   │   └── PageScraperService.cs
│   ├── Tts/
│   │   ├── EdgeTtsService.cs
│   │   └── NarratedVideoGenerator.cs
│   ├── Video/
│   │   └── FfmpegVideoService.cs
│   ├── Projects/
│   │   └── FileSystemProjectManager.cs
│   ├── Webhooks/
│   │   └── WebhookService.cs
│   ├── Metrics/
│   │   └── InMemoryMetricsService.cs
│   ├── Config/
│   │   └── JsonAppConfigRepository.cs
│   └── Auth/
│       ├── JwtService.cs
│       ├── MetamaskVerifier.cs
│       ├── GoogleOAuthService.cs
│       └── ApiKeyRepository.cs
│
└── BizFirst.BrowserHub.Tests/
    ├── Unit/
    └── Integration/
```

**NuGet packages:**

| Package | Replaces |
|---|---|
| `Microsoft.Playwright` | playwright (Node.js) |
| `Microsoft.AspNetCore.SignalR` | socket.io |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | jsonwebtoken |
| `AWSSDK.S3` | — (new S3 support) |
| `Nethereum.Signer` | ethers.js Metamask verify |
| `Xabe.FFmpeg` | ffmpeg child_process |
| `System.IO.Compression` | zip-writer |
| `System.Xml.Linq` | xml2js (sitemap parsing) |
| `SixLabors.ImageSharp` | (image resize/convert if needed) |
| `Microsoft.Extensions.Caching.Memory` | in-process Map caches |

---

## 2. Authentication Design

### 2.1 Auth Middleware (`JwtBearerHandler`)

The JS `authMiddleware` accepts:
1. `X-Api-Key` header → look up in `apiKeys` array
2. `Authorization: Bearer <jwt>` header
3. `?token=<jwt>` query param (media streaming endpoints)

**C# mapping:**

```csharp
// Program.cs
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Events = new JwtBearerEvents
        {
            // Support ?token= for media streaming endpoints
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["token"].ToString();
                if (!string.IsNullOrEmpty(token))
                    ctx.Token = token;
                return Task.CompletedTask;
            }
        };
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKeyResolver = (_, _, _, _) =>
                [new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config.JwtSecret))],
            ValidateIssuer   = false,
            ValidateAudience = false,
        };
    });

// Custom X-Api-Key support — inject as scheme or via middleware:
// ApiKeyAuthMiddleware runs before UseAuthentication and sets ClaimsPrincipal directly.
```

```csharp
// Middleware/ApiKeyAuthMiddleware.cs
public class ApiKeyAuthMiddleware(RequestDelegate next, IApiKeyRepository keys)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        if (ctx.Request.Headers.TryGetValue("X-Api-Key", out var raw))
        {
            var entry = keys.Resolve(raw!);
            if (entry is null)
            {
                ctx.Response.StatusCode = 401;
                await ctx.Response.WriteAsJsonAsync(new { error = "Invalid API key" });
                return;
            }
            ctx.User = BuildPrincipal(entry.UserId, entry.Name, "apikey");
        }
        await next(ctx);
    }
}
```

### 2.2 Metamask Challenge-Response

```csharp
// Infrastructure/Auth/MetamaskVerifier.cs
public class MetamaskVerifier
{
    // In-memory nonce store with 5-minute TTL
    private readonly IMemoryCache _cache;

    public string GenerateNonce(string address)
    {
        var nonce = $"Sign in to BizFirst Browser Hub\nNonce: {DateTimeOffset.UtcNow.ToUnixTimeMilliseconds():x}_{Guid.NewGuid():N}";
        _cache.Set(address.ToLowerInvariant(), nonce, TimeSpan.FromMinutes(5));
        return nonce;
    }

    public bool Verify(string address, string nonce, string signature)
    {
        // Nethereum.Signer recovers the address from the EIP-191 signed message
        var signer   = new EthereumMessageSigner();
        var recovered = signer.EncodeUTF8AndEcRecover(nonce, signature);
        return recovered.Equals(address, StringComparison.OrdinalIgnoreCase);
    }
}
```

### 2.3 JWT Token Format

```csharp
public record UserClaims(string UserId, string DisplayName, string AuthMethod);

// Claims: sub = userId, displayName, authMethod — mirrors JS payload
// Expiry: 7 days (matches JS signJWT)
```

---

## 3. Core Domain Models

```csharp
// Core/Models/Scan.cs
public class Scan
{
    public Guid   Id          { get; init; } = Guid.NewGuid();
    public string Type        { get; set; } = ""; // "sitemap" | "urls"
    public string Input       { get; set; } = "";
    public ScanStatus Status  { get; set; } = ScanStatus.Queued;
    public DateTimeOffset StartedAt   { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }
    public ScanStats      Stats    { get; set; } = new();
    public List<ScanFinding> Findings { get; set; } = [];
    public List<ScanError>   Errors   { get; set; } = [];
}

public enum ScanStatus { Queued, Running, Complete, Cancelled, Error }

public class ScanStats
{
    public int Total    { get; set; }
    public int Scanned  { get; set; }
    public int Findings { get; set; }
    public int Errors   { get; set; }
}

public class Rule
{
    public string  Id          { get; set; } = "";
    public string  Name        { get; set; } = "";
    public string  Description { get; set; } = "";
    public bool    Enabled     { get; set; } = true;
    public string  Severity    { get; set; } = "medium"; // high|medium|low
    public string  Type        { get; set; } = "background-color"; // | custom-js
    public RuleConfig Config   { get; set; } = new();
}

public class Project
{
    public Guid   Id        { get; init; } = Guid.NewGuid();
    public string Name      { get; set; } = "";
    public string Type      { get; set; } = "video"; // video | datapond
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public List<string> SlideOrder  { get; set; } = [];
}

public class Slide
{
    public string Id          { get; init; } = Guid.NewGuid().ToString();
    public int    Order       { get; set; }
    public string? Title      { get; set; }
    public string? Script     { get; set; }
    public string? ImagePath  { get; set; }
    public string? ImageExt   { get; set; }
    public string? ClipPath   { get; set; }
    public double? AudioDuration { get; set; }
}

public class DataRecord
{
    public string Id        { get; init; } = Guid.NewGuid().ToString();
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public Dictionary<string, JsonElement> Data { get; set; } = [];
}
```

---

## 4. Storage Abstraction (Local + S3)

```csharp
// Core/Interfaces/IStorageProvider.cs
public interface IStorageProvider
{
    Task WriteAsync(string relativePath, byte[] data, CancellationToken ct = default);
    Task WriteAsync(string relativePath, Stream data, CancellationToken ct = default);
    Task<byte[]> ReadAsync(string relativePath, CancellationToken ct = default);
    Task<bool>   ExistsAsync(string relativePath, CancellationToken ct = default);
    Task DeleteAsync(string relativePath, CancellationToken ct = default);
    Task<IReadOnlyList<string>> ListAsync(string prefix, CancellationToken ct = default);
    string GetBaseUri(string relativePath); // for serving — local = file path, S3 = pre-signed URL
}

// Infrastructure/Storage/LocalStorageProvider.cs
public class LocalStorageProvider(string rootPath) : IStorageProvider
{
    public Task WriteAsync(string rel, byte[] data, CancellationToken ct = default)
    {
        var full = Resolve(rel);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        return File.WriteAllBytesAsync(full, data, ct);
    }
    // ... ReadAsync, ExistsAsync, DeleteAsync, ListAsync
    private string Resolve(string rel) => Path.Combine(rootPath, rel.Replace('/', Path.DirectorySeparatorChar));
}

// Infrastructure/Storage/S3StorageProvider.cs
public class S3StorageProvider(IAmazonS3 s3, string bucket, string prefix, bool sse) : IStorageProvider
{
    public async Task WriteAsync(string rel, byte[] data, CancellationToken ct = default)
    {
        var req = new PutObjectRequest
        {
            BucketName        = bucket,
            Key               = prefix + rel,
            InputStream       = new MemoryStream(data),
            ServerSideEncryptionMethod = sse ? ServerSideEncryptionMethod.AES256 : ServerSideEncryptionMethod.None,
        };
        await s3.PutObjectAsync(req, ct);
    }
    // ... ReadAsync, ExistsAsync, DeleteAsync, ListAsync
}
```

**DI registration (based on settings page selection):**

```csharp
// Program.cs
var storageSection = builder.Configuration.GetSection("Storage");
if (storageSection["Provider"] == "s3")
{
    builder.Services.AddSingleton<IAmazonS3>(sp =>
        new AmazonS3Client(
            storageSection["AccessKeyId"],
            storageSection["SecretAccessKey"],
            RegionEndpoint.GetBySystemName(storageSection["Region"])));
    builder.Services.AddSingleton<IStorageProvider>(sp =>
        new S3StorageProvider(
            sp.GetRequiredService<IAmazonS3>(),
            storageSection["Bucket"]!,
            storageSection["Prefix"] ?? "",
            storageSection.GetValue<bool>("Sse", true)));
}
else
{
    builder.Services.AddSingleton<IStorageProvider>(_ =>
        new LocalStorageProvider(storageSection["RootPath"] ?? "data"));
}
```

---

## 5. SignalR — Replaces Socket.IO Rooms

**JS rooms → SignalR groups:**

| Socket.IO room | SignalR group |
|---|---|
| `scan:{id}` | `scan-{id}` |
| `slides:{id}` | `slides-{id}` |
| `scraper:{id}` | `scraper-{id}` |
| `tts:{id}` | `tts-{id}` |
| `studio:{userId}:{projectId}` | `studio-{userId}-{projectId}` |
| `metrics` | `metrics` |

```csharp
// Hubs/BrowserHubSignalR.cs
public class BrowserHubSignalR : Hub
{
    public async Task JoinScan(string id)    => await Groups.AddToGroupAsync(Context.ConnectionId, $"scan-{id}");
    public async Task JoinSlides(string id)  => await Groups.AddToGroupAsync(Context.ConnectionId, $"slides-{id}");
    public async Task JoinScraper(string id) => await Groups.AddToGroupAsync(Context.ConnectionId, $"scraper-{id}");
    public async Task JoinTts(string id)     => await Groups.AddToGroupAsync(Context.ConnectionId, $"tts-{id}");
    public async Task JoinStudio(string userId, string projectId)
        => await Groups.AddToGroupAsync(Context.ConnectionId, $"studio-{userId}-{projectId}");
    public async Task JoinMetrics()          => await Groups.AddToGroupAsync(Context.ConnectionId, "metrics");
}
```

**Emitting from background services:**

```csharp
// Inject IHubContext<BrowserHubSignalR> — replaces io.to(...).emit(...)
await _hub.Clients.Group($"scan-{scanId}").SendAsync("scan:progress", new
{
    current = i + 1, total = urls.Count, url, percent = pct
});
```

---

## 6. Browser Service (Playwright)

```csharp
// Core/Interfaces/IBrowserService.cs
public interface IBrowserService
{
    Task<IPage> OpenPageAsync(string url, BrowserOptions? opts = null);
    Task<byte[]> ScreenshotAsync(string url, ScreenshotOptions opts);
    Task<List<ScanFinding>> EvaluateRulesAsync(IPage page, IReadOnlyList<Rule> rules);
    Task<List<CapturedImage>> CaptureSlideShowAsync(string url, CaptureOptions opts, Action<int, int>? onSlide = null);
    Task<byte[]> RecordPresentationAsync(string url, RecordOptions opts, Action<int, int>? onSlide = null);
}

// Infrastructure/Browser/PlaywrightBrowserService.cs
public class PlaywrightBrowserService : IBrowserService, IAsyncDisposable
{
    private IPlaywright? _playwright;
    private IBrowser?    _browser;

    public async Task InitAsync()
    {
        _playwright = await Playwright.CreateAsync();
        _browser    = await _playwright.Chromium.LaunchAsync(new() { Headless = true });
    }

    public async Task<List<ScanFinding>> EvaluateRulesAsync(IPage page, IReadOnlyList<Rule> rules)
    {
        // Inject rule evaluation script — same logic as JS evaluateRules()
        // Uses page.EvaluateAsync<List<ScanFinding>>(rulesScript, rules)
        var serialized = JsonSerializer.Serialize(rules);
        return await page.EvaluateAsync<List<ScanFinding>>(EvaluateRulesScript, serialized);
    }

    public async ValueTask DisposeAsync()
    {
        if (_browser is not null) await _browser.DisposeAsync();
        _playwright?.Dispose();
    }

    // The rule evaluation JS is embedded as a resource string — same algorithm as scanner.js evaluateRules()
    private const string EvaluateRulesScript = """
        (rulesJson) => {
            const rules = JSON.parse(rulesJson);
            function buildSelector(el) { /* ... same as JS */ }
            const findings = [];
            document.querySelectorAll('*').forEach(el => { /* ... same logic */ });
            return findings;
        }
        """;
}
```

---

## 7. Scan Engine

```csharp
// Infrastructure/Scanning/ScanEngine.cs
public class ScanEngine(
    IBrowserService browser,
    IScanRepository  repository,
    IHubContext<BrowserHubSignalR> hub,
    IWebhookService webhooks)
{
    // Active scan cancellation tokens
    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _active = new();

    public async Task RunAsync(Scan scan, IReadOnlyList<Rule> rules, ScanSettings settings)
    {
        var cts = new CancellationTokenSource();
        _active[scan.Id] = cts;
        var ct = cts.Token;

        scan.Status = ScanStatus.Running;
        await repository.SaveAsync(scan);
        await Emit(scan.Id, "scan:status", new { status = "running" });

        try
        {
            var urls = scan.Type == "sitemap"
                ? await SitemapParser.ParseAsync(scan.Input.Trim())
                : scan.Input.Split('\n', StringSplitOptions.RemoveEmptyEntries)
                            .Where(u => u.StartsWith("http"))
                            .ToList();

            scan.Stats.Total = urls.Count;
            await repository.SaveAsync(scan);
            await Emit(scan.Id, "scan:urls", new { total = urls.Count });

            using var pw  = await Playwright.CreateAsync();
            await using var br = await pw.Chromium.LaunchAsync(new() { Headless = settings.Headless });

            for (var i = 0; i < urls.Count; i++)
            {
                ct.ThrowIfCancellationRequested();
                var url = urls[i];
                await Emit(scan.Id, "scan:progress", new { current = i + 1, total = urls.Count, url });

                var page = await br.NewPageAsync();
                try
                {
                    await page.GotoAsync(url, new() { WaitUntil = WaitUntilState.NetworkIdle, Timeout = 60_000 });
                    var findings = await browser.EvaluateRulesAsync(page, rules);
                    foreach (var f in findings)
                    {
                        scan.Findings.Add(f with { Url = url });
                        scan.Stats.Findings++;
                        await Emit(scan.Id, "scan:finding", f);
                    }
                    scan.Stats.Scanned++;
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    scan.Errors.Add(new(url, ex.Message));
                    scan.Stats.Errors++;
                    await Emit(scan.Id, "scan:page-error", new { url, message = ex.Message });
                }
                finally { await page.CloseAsync(); }

                if (settings.PageDelayMs > 0)
                    await Task.Delay(settings.PageDelayMs, ct);

                await repository.SaveAsync(scan);
            }

            scan.Status = ct.IsCancellationRequested ? ScanStatus.Cancelled : ScanStatus.Complete;
        }
        catch (OperationCanceledException)
        {
            scan.Status = ScanStatus.Cancelled;
        }
        catch (Exception ex)
        {
            scan.Status = ScanStatus.Error;
            scan.Errors.Add(new("", ex.Message));
        }
        finally
        {
            scan.CompletedAt = DateTimeOffset.UtcNow;
            await repository.SaveAsync(scan);
            await Emit(scan.Id, "scan:complete", new { status = scan.Status.ToString(), stats = scan.Stats });
            _active.TryRemove(scan.Id, out _);
        }
    }

    public void Cancel(Guid scanId)
    {
        if (_active.TryGetValue(scanId, out var cts)) cts.Cancel();
    }

    private Task Emit(Guid id, string evt, object data)
        => hub.Clients.Group($"scan-{id}").SendAsync(evt, data);
}
```

---

## 8. Project Manager

Mirrors `video-studio/studio/project-manager.js` — file-based, one JSON per project/slide.

```csharp
// Infrastructure/Projects/FileSystemProjectManager.cs
public class FileSystemProjectManager(IStorageProvider storage) : IProjectManager
{
    // Path layout — same as JS:
    //   users/{userId}/projects.json           ← project list
    //   users/{userId}/projects/{pid}/project.json
    //   users/{userId}/projects/{pid}/slides/{sid}/slide.json
    //   users/{userId}/projects/{pid}/slides/{sid}/image.png
    //   users/{userId}/projects/{pid}/slides/{sid}/audio.mp3
    //   users/{userId}/projects/{pid}/records/{rid}.json

    public async Task<Project> CreateProjectAsync(string userId, string name, string type)
    {
        var project = new Project { Name = name, Type = type };
        await WriteProjectAsync(userId, project);
        return project;
    }

    public async Task<DataRecord> AddDataRecordAsync(string userId, string projectId, Dictionary<string, JsonElement> data)
    {
        var record = new DataRecord { Data = data };
        var path = $"users/{userId}/projects/{projectId}/records/{record.Id}.json";
        await storage.WriteAsync(path, JsonSerializer.SerializeToUtf8Bytes(record));
        return record;
    }

    public async Task<int> CleanupTempFilesAsync(string userId, TimeSpan retention)
    {
        // Delete audio/image temp files from slides where project is older than retention
        var deleted = 0;
        var projects = await ListProjectsAsync(userId, null);
        foreach (var p in projects.Where(p => DateTimeOffset.UtcNow - p.CreatedAt > retention))
        {
            // Walk slides, delete audio chunks
            var slides = await GetOrderedSlidesAsync(userId, p.Id.ToString());
            foreach (var s in slides)
            {
                var audioPath = $"users/{userId}/projects/{p.Id}/slides/{s.Id}/audio.mp3";
                if (await storage.ExistsAsync(audioPath))
                {
                    await storage.DeleteAsync(audioPath);
                    deleted++;
                }
            }
        }
        return deleted;
    }
}
```

---

## 9. TTS Service

```csharp
// Infrastructure/Tts/EdgeTtsService.cs
// Microsoft Edge TTS uses a WebSocket connection to speech.platform.bing.com
// The JS uses msedge-tts npm package — reimplement in C# using HttpClient + WebSocket
// Alternative: call msedge-tts via CLI wrapper or use Azure Cognitive Services TTS

public class EdgeTtsService(ILogger<EdgeTtsService> logger) : ITtsService
{
    // Edge TTS endpoint (same protocol as msedge-tts package)
    private const string WssEndpoint = "wss://speech.platform.bing.com/consumer/speech/synthesize/realtimesynthesis/cognitiveservices/v1";

    public async Task<byte[]> SynthesizeAsync(string text, string voice, CancellationToken ct = default)
    {
        // Build SSML
        var ssml = $"""
            <speak version='1.0' xml:lang='en-US'>
              <voice name='{voice}'>{System.Security.SecurityElement.Escape(text)}</voice>
            </speak>
            """;

        using var ws = new ClientWebSocket();
        ws.Options.SetRequestHeader("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
        ws.Options.SetRequestHeader("Pragma", "no-cache");
        await ws.ConnectAsync(new Uri(WssEndpoint + $"?TrustedClientToken={TrustedClientToken}"), ct);

        // Send config frame then SSML — returns audio/mpeg chunks
        // Accumulate all chunks, return concatenated MP3 buffer
        // Full protocol documented at: https://github.com/rany2/edge-tts
        var audio = new MemoryStream();
        // ... WebSocket frame protocol implementation
        return audio.ToArray();
    }

    // Known trusted token (public, same across msedge-tts implementations)
    private const string TrustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
}
```

**Alternative:** Use `Microsoft.CognitiveServices.Speech` SDK with a free Azure Speech subscription (60 min/month free), which gives identical neural voices.

---

## 10. Video Generation (ffmpeg)

```csharp
// Infrastructure/Video/FfmpegVideoService.cs
public class FfmpegVideoService(IOptions<FfmpegOptions> opts) : IVideoService
{
    private readonly string _ffmpegPath = opts.Value.Path ?? "ffmpeg";

    public async Task<byte[]> GenerateSlideshowAsync(
        IReadOnlyList<(string filename, byte[] data)> images,
        int durationPerSlide, int fps, CancellationToken ct = default)
    {
        var tmpDir = Path.Combine(Path.GetTempPath(), $"slides-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tmpDir);
        try
        {
            // Write PNG frames to temp dir
            for (var i = 0; i < images.Count; i++)
            {
                var fname = $"frame-{i + 1:D4}.png";
                await File.WriteAllBytesAsync(Path.Combine(tmpDir, fname), images[i].data, ct);
            }

            // Build concat.txt
            var lines = images.Select((img, i) =>
                $"file 'frame-{i + 1:D4}.png'\nduration {durationPerSlide}").ToList();
            lines.Add($"file 'frame-{images.Count:D4}.png'"); // last frame (no duration)
            await File.WriteAllTextAsync(Path.Combine(tmpDir, "concat.txt"), string.Join('\n', lines), ct);

            var outPath = Path.Combine(tmpDir, "slideshow.mp4");
            await RunFfmpegAsync(
                ["-f", "concat", "-safe", "0", "-i", "concat.txt",
                 "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p",
                 "-c:v", "libx264", "-r", fps.ToString(), "-movflags", "+faststart", "-y", "slideshow.mp4"],
                tmpDir, ct);

            return await File.ReadAllBytesAsync(outPath, ct);
        }
        finally
        {
            Directory.Delete(tmpDir, recursive: true);
        }
    }

    private async Task RunFfmpegAsync(string[] args, string workDir, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(_ffmpegPath)
        {
            WorkingDirectory       = workDir,
            RedirectStandardError  = true,
            UseShellExecute        = false,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var proc = Process.Start(psi)!;
        await proc.WaitForExitAsync(ct);
        if (proc.ExitCode != 0)
            throw new InvalidOperationException("ffmpeg failed: " + await proc.StandardError.ReadToEndAsync(ct));
    }

    public bool IsAvailable()
    {
        try
        {
            var p = Process.Start(new ProcessStartInfo(_ffmpegPath, "-version") { RedirectStandardOutput = true, UseShellExecute = false })!;
            p.WaitForExit(3000);
            return p.ExitCode == 0;
        }
        catch { return false; }
    }
}
```

---

## 11. Cleanup Endpoint

Implements the "Clean temp files now" button from the settings pages.

```csharp
// Controllers/CleanupController.cs
[ApiController]
[Route("api/cleanup")]
[Authorize]
public class CleanupController(IProjectManager projects, IStorageProvider storage) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> CleanAsync([FromBody] CleanupRequest req)
    {
        var userId    = User.GetUserId();
        var retention = TimeSpan.FromDays(req.RetentionDays > 0 ? req.RetentionDays : 30);
        var deleted   = 0;

        if (req.Scope is "extractor" or "all")
            deleted += await projects.CleanupTempFilesAsync(userId, retention);

        if (req.Scope is "video" or "all")
            deleted += await CleanVideoTempAsync(userId, retention);

        return Ok(new { deleted });
    }

    private async Task<int> CleanVideoTempAsync(string userId, TimeSpan retention)
    {
        // Delete TTS job directories older than retention
        var deleted = 0;
        var prefix  = $"data/tts/";
        var files   = await storage.ListAsync(prefix);
        foreach (var f in files.Where(f => f.EndsWith("job.json")))
        {
            // Read created-at, delete folder if older than retention
            // ... implementation
        }
        return deleted;
    }
}

public record CleanupRequest(string Scope, int RetentionDays);
```

---

## 12. Rate Limiting

JS uses an in-memory Map per IP. C# uses `Microsoft.AspNetCore.RateLimiting` (built-in since .NET 7):

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("JobPolicy", ctx =>
        RateLimitPartition.GetSlidingWindowLimiter(
            partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit    = cfg.RateLimits.MaxJobsPerHour,
                Window         = TimeSpan.FromHours(1),
                SegmentsPerWindow = 4,
            }));
});

// Apply to job-creation endpoints:
app.MapPost("/api/scans",          ...).RequireRateLimiting("JobPolicy");
app.MapPost("/api/slides/jobs",    ...).RequireRateLimiting("JobPolicy");
app.MapPost("/api/scraper/jobs",   ...).RequireRateLimiting("JobPolicy");
```

---

## 13. appsettings.json Structure

```json
{
  "App": {
    "Title":       "Browser Hub",
    "LogoUrl":     "",
    "AdminKey":    "change-me-in-production",
    "JwtSecret":   "change-me-in-production"
  },
  "Google": {
    "ClientId":     "",
    "ClientSecret": "",
    "RedirectUri":  "https://localhost:5001/api/auth/google/callback"
  },
  "Storage": {
    "Provider":     "local",
    "RootPath":     "data",
    "Bucket":       "",
    "Region":       "us-east-1",
    "Prefix":       "",
    "AccessKeyId":  "",
    "Sse":          true
  },
  "RateLimits": {
    "MaxUrlsPerJob":   500,
    "MaxFileSizeMb":   10,
    "MaxConcurrency":  16,
    "MaxJobsPerHour":  100,
    "ScrapeTimeoutMs": 60000
  },
  "Ffmpeg": {
    "Path": "ffmpeg"
  },
  "Playwright": {
    "Headless": true
  }
}
```

---

## 14. API Route Map (JS → C#)

| JS route | C# controller | Action |
|---|---|---|
| `GET /api/scans` | `ScansController` | `List()` |
| `GET /api/scans/:id` | `ScansController` | `Get(Guid id)` |
| `POST /api/scans` | `ScansController` | `Create(CreateScanDto)` |
| `POST /api/scans/:id/cancel` | `ScansController` | `Cancel(Guid id)` |
| `DELETE /api/scans/:id` | `ScansController` | `Delete(Guid id)` |
| `GET /api/rules` | `ScansController` | `GetRules()` |
| `PUT /api/rules` | `ScansController` | `UpdateRules(Rule[])` [admin] |
| `GET /api/settings` | `ScansController` | `GetSettings()` |
| `PUT /api/settings` | `ScansController` | `UpdateSettings(ScanSettings)` |
| `POST /api/slides/jobs` | `SlidesController` | `StartJob(SlidesJobRequest)` |
| `GET /api/slides/jobs/:id/images` | `SlidesController` | `GetImages(Guid id)` |
| `GET /api/slides/jobs/:id/image/:si/:ii` | `SlidesController` | `GetImage(Guid,int,int)` |
| `GET /api/slides/jobs/:id/pdf/:si` | `SlidesController` | `GetPdf(Guid,int)` |
| `GET /api/slides/jobs/:id/video/:si` | `SlidesController` | `GetVideo(Guid,int)` |
| `GET /api/slides/jobs/:id/download/:si` | `SlidesController` | `Download(Guid,string)` |
| `GET /api/slides/ffmpeg` | `SlidesController` | `FfmpegStatus()` |
| `POST /api/scraper/jobs` | `ScraperController` | `Start(ScraperRequest)` |
| `GET /api/scraper/jobs/:id` | `ScraperController` | `Get(Guid id)` |
| `GET /api/scraper/jobs/:id/download/:fmt` | `ScraperController` | `Download(Guid,string)` |
| `POST /api/scraper/jobs/:id/cancel` | `ScraperController` | `Cancel(Guid id)` |
| `POST /api/auth/challenge` | `AuthController` | `Challenge(string address)` |
| `POST /api/auth/verify` | `AuthController` | `Verify(VerifyDto)` |
| `POST /api/auth/test` | `AuthController` | `TestLogin()` |
| `GET /api/auth/google` | `AuthController` | `GoogleRedirect()` |
| `GET /api/auth/google/callback` | `AuthController` | `GoogleCallback(string code)` |
| `GET /api/auth/me` | `AuthController` | `Me()` [authorized] |
| `GET /api/auth/api-keys` | `AuthController` | `ListKeys()` [authorized] |
| `POST /api/auth/api-keys` | `AuthController` | `CreateKey(string name)` [authorized] |
| `DELETE /api/auth/api-keys/:kid` | `AuthController` | `RevokeKey(string kid)` [authorized] |
| `GET /api/studio/projects` | `StudioController` | `ListProjects(string? type)` |
| `POST /api/studio/projects` | `StudioController` | `CreateProject(CreateProjectDto)` |
| `GET /api/studio/projects/:pid` | `StudioController` | `GetProject(string pid)` |
| `PATCH /api/studio/projects/:pid` | `StudioController` | `UpdateProject(string pid, ...)` |
| `DELETE /api/studio/projects/:pid` | `StudioController` | `DeleteProject(string pid)` |
| `GET /api/studio/projects/:pid/slides` | `StudioController` | `GetSlides(string pid)` |
| `POST /api/studio/projects/:pid/slides` | `StudioController` | `AddSlide(string pid, ...)` |
| `PATCH /api/studio/projects/:pid/slides/:sid` | `StudioController` | `UpdateSlide(...)` |
| `DELETE /api/studio/projects/:pid/slides/:sid` | `StudioController` | `DeleteSlide(...)` |
| `POST /api/studio/projects/:pid/slides/reorder` | `StudioController` | `Reorder(...)` |
| `POST /api/studio/projects/:pid/slides/:sid/audio` | `StudioController` | `GenerateAudio(...)` |
| `GET /api/studio/projects/:pid/slides/:sid/audio` | `StudioController` | `ServeAudio(...)` |
| `GET /api/studio/projects/:pid/records` | `DataRecordsController` | `List(...)` |
| `POST /api/studio/projects/:pid/records` | `DataRecordsController` | `Add(...)` |
| `GET /api/studio/projects/:pid/records/:rid` | `DataRecordsController` | `Get(...)` |
| `PATCH /api/studio/projects/:pid/records/:rid` | `DataRecordsController` | `Update(...)` |
| `DELETE /api/studio/projects/:pid/records/:rid` | `DataRecordsController` | `Delete(...)` |
| `DELETE /api/studio/projects/:pid/records` | `DataRecordsController` | `Clear(...)` |
| `POST /api/tts/jobs` | `TtsController` | `Start(TtsRequest)` |
| `GET /api/tts/jobs/:id` | `TtsController` | `Get(Guid id)` |
| `GET /api/tts/jobs/:id/audio/:slide` | `TtsController` | `ServeAudio(Guid,int)` |
| `GET /api/tts/jobs/:id/download` | `TtsController` | `DownloadZip(Guid)` |
| `POST /api/tts/jobs/:id/video` | `TtsController` | `StartVideo(Guid, ...)` |
| `GET /api/tts/jobs/:id/video` | `TtsController` | `ServeVideo(Guid)` |
| `GET /api/tts/voices` | `TtsController` | `Voices()` |
| `GET /api/webhooks` | `WebhooksController` | `List()` [admin] |
| `POST /api/webhooks` | `WebhooksController` | `Create(...)` [admin] |
| `PATCH /api/webhooks/:id` | `WebhooksController` | `Update(...)` [admin] |
| `DELETE /api/webhooks/:id` | `WebhooksController` | `Delete(string id)` [admin] |
| `POST /api/webhooks/:id/test` | `WebhooksController` | `Test(string id)` [admin] |
| `GET /api/proxies` | `ProxiesController` | `List()` [admin] |
| `POST /api/proxies` | `ProxiesController` | `Add(ProxyDto)` [admin] |
| `PATCH /api/proxies/:id` | `ProxiesController` | `Update(...)` [admin] |
| `DELETE /api/proxies/:id` | `ProxiesController` | `Delete(string id)` [admin] |
| `POST /api/proxies/:id/test` | `ProxiesController` | `Test(string id)` [admin] |
| `GET /api/resources` | `ResourcesController` | `Get()` |
| `GET /api/metrics` | `MetricsController` | `Snapshot()` [admin] |
| `GET /api/metrics/log` | `MetricsController` | `Log(int limit, string? type)` [admin] |
| `GET /api/config` | `AdminController` | `PublicConfig()` |
| `GET /api/admin/config` | `AdminController` | `FullConfig()` [admin] |
| `POST /api/admin/config` | `AdminController` | `SaveConfig(AppConfig)` [admin] |
| `POST /api/admin/upload` | `AdminController` | `Upload(IFormFile)` [admin] |
| `POST /api/cleanup` | `CleanupController` | `Clean(CleanupRequest)` [authorized] |

---

## 15. Program.cs Skeleton

```csharp
var builder = WebApplication.CreateBuilder(args);

// Services
builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(/* ... */);
builder.Services.AddAuthorization();
builder.Services.AddMemoryCache();
builder.Services.AddRateLimiter(/* ... */);

// Core services
builder.Services.AddSingleton<IAppConfigRepository, JsonAppConfigRepository>();
builder.Services.AddSingleton<IMetricsService, InMemoryMetricsService>();
builder.Services.AddSingleton<IWebhookService, WebhookService>();
builder.Services.AddSingleton<ScanEngine>();
builder.Services.AddSingleton<IProjectManager, FileSystemProjectManager>();
builder.Services.AddSingleton<IVideoService, FfmpegVideoService>();
builder.Services.AddSingleton<ITtsService, EdgeTtsService>();
builder.Services.AddSingleton<IApiKeyRepository, JsonApiKeyRepository>();
builder.Services.AddSingleton<MetamaskVerifier>();
builder.Services.AddSingleton<GoogleOAuthService>();

// Storage — Local or S3 depending on config
RegisterStorage(builder);

// Playwright (browser pool) — singleton, dispose on shutdown
builder.Services.AddSingleton<IBrowserService, PlaywrightBrowserService>();
builder.Host.UseWindowsService(); // optional: run as Windows Service

var app = builder.Build();

// Middleware order
app.UseMiddleware<ApiKeyAuthMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.UseStaticFiles();         // serves /browser-studio/** HTML files
app.MapControllers();
app.MapHub<BrowserHubSignalR>("/hub");

// Init Playwright browser on startup
await app.Services.GetRequiredService<IBrowserService>().CastTo<PlaywrightBrowserService>().InitAsync();

app.Run();
```

---

## 16. Migration Notes

| Concern | JS | C# |
|---|---|---|
| Persistence | JSON flat files on disk | Same (via `IStorageProvider`) — swap to DB later |
| Job state | In-memory Map | `ConcurrentDictionary<Guid, TJob>` |
| Real-time events | Socket.IO rooms | SignalR groups (same semantics) |
| Background work | `async/await` in route handler | `Task.Run` + `IHubContext` injection |
| Playwright | `playwright` npm | `Microsoft.Playwright` NuGet (same API) |
| Auth | jsonwebtoken + ethers | `System.IdentityModel.Tokens.Jwt` + Nethereum |
| File uploads | multer | `IFormFile` + `[RequestSizeLimit]` |
| ZIP | custom zip-writer | `System.IO.Compression.ZipArchive` |
| PDF | pdfkit (imagesToPdf) | `PdfSharpCore` or `iText7.pdfhtml` |
| Edge TTS | msedge-tts npm | WebSocket client or Azure Speech SDK |
| ffmpeg | `child_process.execFile` | `Process.Start` or `Xabe.FFmpeg` |
| Concurrency guard | `safeConcurrency()` | Same logic using `GC.GetTotalMemory()` + `Environment.ProcessorCount` |

### Breaking changes to watch

1. **`X-Admin-Key` header** — JS checks this on every admin route. In C#, use a policy-based `[Authorize(Policy = "AdminKey")]` attribute with a custom requirement.
2. **`?token=` query param** — must be handled in `OnMessageReceived` JWT event (shown above) for media-serving endpoints.
3. **Scan findings stored in flat JSON** — the JS `store.json` grows unbounded. In C# migration phase 2, replace with SQLite via EF Core.
4. **`slidesJobs` in-memory** — on server restart all slide job buffers are lost. Consider writing them to `IStorageProvider` if jobs take >30 sec.
5. **Google OAuth redirect URI** — must be updated from `localhost:3000` to the new .NET host port.
