# BrowserHub LiveBrowser — Session Driver API
## Requirements v1 · Phase 2 · Remote Browser Module

---

## Overview

The Session Driver (`hub_browser`) is the stateful core of LiveBrowser. A caller creates a session, receives a `sessionId`, and uses that ID to send commands one at a time (or batched). The browser context — including cookies, local storage, and navigation history — persists across calls until the session is closed or times out.

All session routes require authentication. Include either:
- `Authorization: Bearer <jwt>` header
- `X-Api-Key: <key>` header

---

## Session Management Endpoints

### Create Session

```
POST /api/live-browser/sessions
```

Creates a new browser session. Launches a Playwright `BrowserContext` in headless Chromium.

**Request body:** (all optional)

```json
{
  "label": "Checkout automation test",
  "viewport": { "width": 1280, "height": 800 },
  "locale": "en-US",
  "timezone": "America/New_York",
  "userAgent": "custom UA string or omit for default rotation"
}
```

**Response 201:**

```json
{
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "active",
  "createdAt": "2026-06-16T09:00:00Z",
  "expiresAfterIdleMs": 600000
}
```

**Errors:**

| Code | HTTP | Meaning |
|------|------|---------|
| `SESSION_CAPACITY_REACHED` | 429 | Global session cap reached |
| `USER_SESSION_LIMIT` | 429 | Per-user session cap reached |

---

### List Sessions (current user)

```
GET /api/live-browser/sessions
```

Returns all active sessions owned by the authenticated user.

**Response 200:**

```json
{
  "sessions": [
    {
      "sessionId": "a1b2c3...",
      "status": "active",
      "createdAt": "2026-06-16T09:00:00Z",
      "lastActiveAt": "2026-06-16T09:14:00Z",
      "currentUrl": "https://example.com/dashboard",
      "historyLength": 3
    }
  ]
}
```

---

### Get Session

```
GET /api/live-browser/sessions/:sessionId
```

Returns the current state of a session.

**Response 200:**

```json
{
  "sessionId": "a1b2c3...",
  "status": "active",
  "createdAt": "2026-06-16T09:00:00Z",
  "lastActiveAt": "2026-06-16T09:14:00Z",
  "currentUrl": "https://example.com/dashboard",
  "history": [
    "https://example.com",
    "https://example.com/login",
    "https://example.com/dashboard"
  ]
}
```

---

### Run a Command

```
POST /api/live-browser/sessions/:sessionId/run
```

Executes a single command against the session, or a batch of commands.

**Single command:**

```json
{
  "method": "navigate",
  "params": { "url": "https://example.com" }
}
```

**Batch (array of commands):**

```json
{
  "commands": [
    { "method": "fill",   "params": { "selector": "[data-hub-idx='3']", "text": "user@example.com" } },
    { "method": "fill",   "params": { "selector": "[data-hub-idx='4']", "text": "mypassword" } },
    { "method": "tap",    "params": { "selector": "[data-hub-idx='5']" } }
  ]
}
```

Response shape is the same for both. A single command returns its own result object. A batch returns an array of result objects in order; execution stops at the first error.

---

### Close Session

```
DELETE /api/live-browser/sessions/:sessionId
```

Immediately closes the browser context and marks the session as closed.

**Response 200:**

```json
{ "closed": true, "sessionId": "a1b2c3..." }
```

---

## Command Reference

All commands are sent via `POST /api/live-browser/sessions/:sessionId/run`.

---

### Navigation

#### `navigate`

Navigate to a URL. Waits for the page to reach the requested ready state before returning.

**Params:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | Absolute URL to navigate to |
| `waitUntil` | string | No | `"load"` | When to consider navigation complete: `"load"`, `"domcontentloaded"`, `"networkidle"` |
| `timeoutMs` | number | No | 30000 | Navigation timeout in ms |

**Returns:**

```json
{
  "url": "https://example.com/dashboard",
  "title": "Dashboard — Example App",
  "status": 200
}
```

---

#### `goBack`

Navigate to the previous page in history.

**Params:**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `waitUntil` | string | No | `"load"` |

**Returns:** Same shape as `navigate`.

---

#### `goForward`

Navigate forward in history.

**Params:** Same as `goBack`.

**Returns:** Same shape as `navigate`.

---

#### `reload`

Reload the current page.

**Params:**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `waitUntil` | string | No | `"load"` |

**Returns:** Same shape as `navigate`.

---

### Observation

#### `capture`

Snapshot the page into a structured element list. This is the primary observation tool — call it after any navigation or page change before interacting.

**Params:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `maxElements` | number | No | 200 | Cap on elements returned |
| `includeHidden` | boolean | No | false | Include off-viewport elements |
| `types` | string[] | No | all | Filter by element types: `"interactive"`, `"text"`, `"image"`, `"heading"` |

**Returns:**

```json
{
  "url": "https://example.com/checkout",
  "title": "Checkout",
  "capturedAt": "2026-06-16T09:14:00Z",
  "elementCount": 12,
  "elements": [
    {
      "index": 1,
      "tag": "h1",
      "type": "heading",
      "text": "Checkout",
      "selector": "[data-hub-idx='1']",
      "visible": true,
      "interactive": false
    },
    {
      "index": 2,
      "tag": "input",
      "type": "email",
      "label": "Email address",
      "placeholder": "you@example.com",
      "selector": "[data-hub-idx='2']",
      "visible": true,
      "interactive": true
    },
    {
      "index": 3,
      "tag": "button",
      "text": "Continue to shipping",
      "selector": "[data-hub-idx='3']",
      "visible": true,
      "interactive": true
    }
  ],
  "pageText": "Checkout\nEmail address\nyou@example.com\nContinue to shipping"
}
```

---

#### `extract`

Read the text content of a specific element by selector.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | Yes | CSS selector or `[data-hub-idx='N']` from a capture |

**Returns:**

```json
{ "text": "Continue to shipping" }
```

---

#### `source`

Get the raw HTML of a section or the whole page.

**Params:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `selector` | string | No | — | Scope to an element. Omit for full-page HTML |

**Returns:**

```json
{ "html": "<div class=\"checkout\">...</div>" }
```

---

#### `execute`

Run arbitrary JavaScript inside the page context (Playwright `page.evaluate`). Runs in the browser sandbox, not in Node.js.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `script` | string | Yes | JavaScript expression or IIFE that returns a serializable value |

**Returns:**

```json
{ "result": 42 }
```

**Example:**

```json
{ "script": "(() => document.querySelectorAll('tr').length)()" }
```

---

### Interaction

#### `tap`

Click an element.

**Params:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `selector` | string | Yes | — | Element to click |
| `button` | string | No | `"left"` | `"left"`, `"right"`, `"middle"` |
| `clickCount` | number | No | 1 | 1 for click, 2 for double-click |
| `delayMs` | number | No | 0 | Delay between mousedown and mouseup |

**Returns:**

```json
{ "ok": true }
```

---

#### `fill`

Clear an input and type text into it.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | Yes | Input element |
| `text` | string | Yes | Text to enter |

**Returns:**

```json
{ "ok": true }
```

---

#### `choose`

Select an option in a `<select>` element.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | Yes | The `<select>` element |
| `value` | string | Yes | The `value` attribute of the option to select |

**Returns:**

```json
{ "selectedValue": "us-east-1" }
```

---

#### `toggle`

Check or uncheck a checkbox or radio button. Preferred over `tap` for checkboxes because it sets state explicitly rather than toggling blindly.

**Params:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `selector` | string | Yes | — | Checkbox or radio element |
| `checked` | boolean | No | true | Desired checked state |

**Returns:**

```json
{ "checked": true }
```

---

#### `point`

Move the mouse pointer over an element (hover). Useful for revealing tooltip content or triggering hover menus before capturing.

**Params:**

| Field | Type | Required |
|-------|------|----------|
| `selector` | string | Yes |

**Returns:**

```json
{ "ok": true }
```

---

#### `slide`

Scroll the page or a specific element.

**Params:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `selector` | string | No | — | Element to scroll inside. Omit to scroll the page |
| `direction` | string | No | `"down"` | `"up"`, `"down"`, `"left"`, `"right"` |
| `amount` | number | No | 400 | Pixels to scroll |

**Returns:**

```json
{ "ok": true }
```

---

### Waiting

#### `awaitElement`

Wait for a DOM element matching the selector to exist and be visible.

**Params:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `selector` | string | Yes | — | CSS selector to wait for |
| `timeoutMs` | number | No | 30000 | Max wait time |
| `state` | string | No | `"visible"` | `"visible"`, `"attached"`, `"detached"`, `"hidden"` |

**Returns:**

```json
{ "found": true, "selector": "[data-hub-idx='7']" }
```

---

#### `awaitLoad`

Wait for a page navigation to complete. Use after triggering an action that navigates (form submit, link click) to ensure the new page is ready before the next command.

**Params:**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `timeoutMs` | number | No | 30000 |
| `waitUntil` | string | No | `"load"` |

**Returns:**

```json
{ "url": "https://example.com/success", "title": "Order Confirmed" }
```

---

#### `awaitDelay`

Pause for a fixed duration. Use sparingly — prefer `awaitElement` or `awaitLoad` over fixed delays.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ms` | number | Yes | Milliseconds to wait. Maximum 10 000 |

**Returns:**

```json
{ "waited": 2000 }
```

---

#### `awaitRequest`

Wait for an outgoing network request matching a URL pattern.

**Params:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `urlPattern` | string | Yes | — | Glob pattern or substring to match against request URLs |
| `method` | string | No | any | HTTP method to match: `"GET"`, `"POST"`, etc. |
| `timeoutMs` | number | No | 15000 | Max wait |

**Returns:**

```json
{
  "url": "https://api.example.com/checkout",
  "method": "POST",
  "resourceType": "fetch"
}
```

---

#### `awaitResponse`

Wait for a network response matching a URL pattern and optional status code set.

**Params:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `urlPattern` | string | Yes | — | Glob pattern or substring |
| `statuses` | number[] | No | any | Acceptable HTTP status codes |
| `timeoutMs` | number | No | 15000 | Max wait |

**Returns:**

```json
{
  "url": "https://api.example.com/checkout",
  "status": 200,
  "contentType": "application/json"
}
```

---

### Session Utilities

#### `liveView`

Generate a shareable URL for a live view of the current browser session. The URL opens a real-time screenshot stream (MJPEG or periodic PNG refresh) that a human can watch.

**Params:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `timeoutMs` | number | No | 300000 | How long the view URL is valid |
| `refreshRateMs` | number | No | 1000 | Screenshot refresh interval |

**Returns:**

```json
{
  "viewUrl": "http://localhost:3000/api/live-browser/sessions/a1b2c3.../view",
  "expiresAt": "2026-06-16T09:19:00Z"
}
```

---

#### `end`

Close the session. Same as `DELETE /api/live-browser/sessions/:sessionId` but callable as a command within a batch.

**Params:** None.

**Returns:**

```json
{ "closed": true }
```

---

## Command Batching

Multiple commands that act on the same page state can be sent in a single request using the `commands` array. This is significantly faster than one round-trip per command.

```json
{
  "commands": [
    { "method": "fill", "params": { "selector": "[data-hub-idx='2']", "text": "alice@example.com" } },
    { "method": "fill", "params": { "selector": "[data-hub-idx='3']", "text": "hunter2" } },
    { "method": "toggle", "params": { "selector": "[data-hub-idx='4']", "checked": true } },
    { "method": "tap", "params": { "selector": "[data-hub-idx='5']" } }
  ]
}
```

**Batch response:**

```json
{
  "results": [
    { "method": "fill",   "ok": true },
    { "method": "fill",   "ok": true },
    { "method": "toggle", "checked": true },
    { "method": "tap",    "ok": true }
  ],
  "completedCount": 4,
  "errorIndex": null
}
```

**Batch rules:**

- Commands run sequentially in order
- On error, execution stops and `errorIndex` is set to the index of the failing command
- Safe to batch: `fill`, `toggle`, `choose`, `point`, `slide`, `extract`, `execute`, `awaitDelay`, `awaitElement`
- Page-changing commands (`tap` on a link/submit, `navigate`, `goBack`, `goForward`, `reload`) should only appear as the **last** command in a batch

---

## Error Response Format

All errors from session commands follow a consistent shape:

```json
{
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "No element matched selector [data-hub-idx='7']",
    "method": "tap",
    "selector": "[data-hub-idx='7']",
    "recoverySuggestion": "Call capture again — the page may have changed since your last snapshot.",
    "freshCapture": {
      "url": "https://example.com/checkout",
      "elementCount": 9,
      "elements": [ "..." ]
    }
  }
}
```

The `freshCapture` field is included automatically when an `ELEMENT_NOT_FOUND` error occurs, so the caller can re-plan without an extra round-trip.

**Error codes:**

| Code | HTTP | Meaning | Recovery |
|------|------|---------|----------|
| `ELEMENT_NOT_FOUND` | 422 | Selector matched nothing | Re-capture and re-plan |
| `NAVIGATION_TIMEOUT` | 422 | Page didn't reach ready state in time | Retry with longer `timeoutMs` or `"domcontentloaded"` |
| `ELEMENT_TIMEOUT` | 422 | `awaitElement` timed out | Element may not appear — re-capture |
| `SESSION_NOT_FOUND` | 404 | Session ID unknown or already closed | Create a new session |
| `SESSION_EXPIRED` | 410 | Session timed out due to inactivity | Create a new session |
| `SESSION_FORBIDDEN` | 403 | Caller doesn't own this session | Use the correct session ID |
| `EXECUTE_ERROR` | 422 | JavaScript in page context threw | Fix the script |
| `NAVIGATION_ERROR` | 422 | Page returned HTTP error or network failed | Check the URL |
| `BATCH_ERROR` | 422 | Error in a batch command | See `errorIndex` |
| `INVALID_PARAMS` | 400 | Missing or wrong parameters | Not retryable — fix the request |
| `BROWSER_CRASH` | 500 | Playwright context died unexpectedly | Create a new session |
