# BrowserHub — REST API Reference

All endpoints require a `Authorization: Bearer <token>` header unless noted. Tokens are obtained via `/api/auth/login` or `/api/auth/google`.

For programmatic access, pass `X-Api-Key: <key>` instead of a Bearer token.

Base URL: `http://localhost:3000` (development)

---

## Authentication

### POST `/api/auth/login`

**No auth required.**

Request:
```json
{
  "email": "user@example.com",
  "password": "your-password"
}
```

Response `200`:
```json
{
  "token": "<jwt>",
  "user": { "id": "...", "email": "user@example.com", "role": "admin" }
}
```

Response `401`:
```json
{ "error": "Invalid credentials" }
```

---

### POST `/api/auth/logout`

Response `200`:
```json
{ "ok": true }
```

---

## Projects

### GET `/api/studio/projects`

List all projects for the authenticated user.

Response `200`:
```json
[
  {
    "id": "proj_abc123",
    "name": "Dental Leads Austin",
    "createdAt": "2026-01-15T10:00:00Z",
    "datasetCount": 3
  }
]
```

---

### POST `/api/studio/projects`

Create a project.

Request:
```json
{ "name": "Dental Leads Austin" }
```

Response `201`:
```json
{ "id": "proj_abc123", "name": "Dental Leads Austin", "createdAt": "2026-01-15T10:00:00Z" }
```

---

### GET `/api/studio/projects/:id`

Get a single project.

---

### DELETE `/api/studio/projects/:id`

Delete a project and all its datasets.

Response `204` (no body).

---

## Datasets

### GET `/api/studio/projects/:projectId/datasets`

List datasets in a project.

Response `200`:
```json
[
  {
    "id": "ds_xyz789",
    "name": "BBB Results 2026-01",
    "recordCount": 87,
    "createdAt": "2026-01-20T08:00:00Z"
  }
]
```

---

### POST `/api/studio/projects/:projectId/datasets`

Create a dataset.

Request:
```json
{ "name": "BBB Results 2026-01" }
```

Response `201`:
```json
{ "id": "ds_xyz789", "name": "BBB Results 2026-01", "recordCount": 0 }
```

---

### GET `/api/studio/datasets/:id/records`

Get records in a dataset. Supports pagination.

Query params:
- `page` (default: 1)
- `pageSize` (default: 50, max: 500)

Response `200`:
```json
{
  "total": 87,
  "page": 1,
  "pageSize": 50,
  "records": [
    { "name": "Thiel Pediatric Dentistry", "phone": "512-555-0100", "address": "123 Main St, Austin TX", "grade": "A+" }
  ]
}
```

---

### POST `/api/studio/datasets/:id/records`

Append records to a dataset.

Request:
```json
{
  "records": [
    { "name": "ABC Dentistry", "phone": "512-555-0200" }
  ]
}
```

Response `201`:
```json
{ "appended": 1, "total": 88 }
```

---

### GET `/api/studio/datasets/:id/export`

Export all records.

Query params:
- `format`: `csv` (default) or `json`

Response: file download.

---

## Pipeline (Lead Discovery)

### GET `/api/pipeline/sources`

List available pipeline sources.

Response `200`:
```json
[
  { "id": "yellowpages", "label": "Yellow Pages", "status": "active" },
  { "id": "bbb",         "label": "BBB",          "status": "active" },
  { "id": "manta",       "label": "Manta",         "status": "needs-work" }
]
```

---

### POST `/api/pipeline/run`

Start a pipeline run.

Request:
```json
{
  "keyword": "dentist",
  "location": "Austin TX",
  "sources": ["yellowpages", "bbb"],
  "saveToDatasetId": "ds_xyz789"
}
```

Response `202`:
```json
{ "runId": "run_20260120_abc" }
```

Progress is streamed via Socket.io event `pipeline-progress` in room `pipeline-{runId}`.

Socket.io events:
- `pipeline-progress` → `{ runId, source, fetched }`
- `pipeline-done` → `{ runId, records[], rawFetched, total }`
- `pipeline-error` → `{ runId, error }`

---

### GET `/api/pipeline/run/:runId`

Poll pipeline run status (alternative to Socket.io).

Response `200`:
```json
{
  "runId": "run_20260120_abc",
  "status": "done",
  "records": [...],
  "rawFetched": 46,
  "total": 44
}
```

Status values: `running` | `done` | `error`

---

## Scan

### POST `/api/scan`

Start a visual/accessibility scan.

Request:
```json
{
  "urls": ["https://example.com", "https://example.com/about"],
  "rules": {
    "checkBrokenImages": true,
    "checkBackgroundColor": true
  }
}
```

Response `202`:
```json
{ "jobId": "scan_abc123" }
```

---

### GET `/api/scan/:jobId`

Get scan results.

Response `200`:
```json
{
  "jobId": "scan_abc123",
  "status": "done",
  "results": [
    {
      "url": "https://example.com",
      "screenshot": "/data/jobs/scan_abc123/example-com.png",
      "issues": []
    }
  ]
}
```

---

## Text-to-Speech (TTS)

### POST `/api/tts/jobs`

Create a TTS narration job.

Request:
```json
{
  "url": "https://example.com",
  "voice": "en-US-AriaNeural",
  "rate": "+0%",
  "outputFolder": "C:\\Users\\me\\Desktop\\output"
}
```

`url` can be `https://`, `http://`, or `file:///C:/path/to/file.html`.
`outputFolder` is optional — if supplied, MP3 files are copied there on completion.

Response `202`:
```json
{ "jobId": "tts_abc123" }
```

Socket.io events in room `tts:{jobId}`:
- `tts-progress` → `{ jobId, slideIndex, total, file }`
- `tts-done` → `{ jobId, files[] }`
- `tts-error` → `{ jobId, error }`

---

### GET `/api/tts/jobs/:jobId`

Get TTS job status.

Response `200`:
```json
{
  "jobId": "tts_abc123",
  "status": "done",
  "files": ["slide-01.mp3", "slide-02.mp3"]
}
```

---

### GET `/api/tts/jobs/:jobId/audio`

Download all MP3 files as a zip archive.

Response: `application/zip` file download.

---

### GET `/api/tts/voices`

List available TTS voices.

Response `200`:
```json
[
  { "name": "en-US-AriaNeural",   "locale": "en-US", "gender": "Female" },
  { "name": "en-US-GuyNeural",    "locale": "en-US", "gender": "Male"   },
  { "name": "en-GB-SoniaNeural",  "locale": "en-GB", "gender": "Female" }
]
```

---

## Web Extractor

### POST `/api/extract`

Scrape metadata and structured data from a URL.

Request:
```json
{
  "url": "https://example.com",
  "options": {
    "screenshot": true,
    "pdf": false,
    "jsonld": true,
    "opengraph": true,
    "links": true
  }
}
```

Response `200`:
```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "description": "...",
  "jsonld": [...],
  "opengraph": { "title": "...", "image": "..." },
  "links": ["https://example.com/about", ...],
  "screenshot": "/data/screenshots/example-com-1234.png"
}
```

---

## Admin

### GET `/api/admin/stats`

**Admin role required.**

Response `200`:
```json
{
  "totalJobs": 142,
  "activeJobs": 3,
  "totalRecords": 8400,
  "storageUsedMb": 12.4
}
```

---

## Error Format

All errors return a JSON body:

```json
{ "error": "Human-readable error message" }
```

Common status codes:

| Code | Meaning |
|------|---------|
| 400 | Invalid request (missing field, bad format) |
| 401 | Not authenticated |
| 403 | Authenticated but not authorised |
| 404 | Resource not found |
| 409 | Conflict (duplicate name, job already running) |
| 500 | Internal server error |
