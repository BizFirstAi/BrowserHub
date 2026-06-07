# BrowserHub — AI Plugin Architecture


Youtube video
https://www.youtube.com/watch?v=pf8SQZXrcl4

Github
https://github.com/BizFirstAi/BrowserHub



> **Phase 1 ships with zero AI dependencies.** AI features are a Phase 2 addition designed to be plugged in on top of the existing platform without modifying core code.

## Why AI is a Plugin, Not Core

The core platform — scraping, screenshots, TTS, dataset management — is valuable on its own. Making AI optional means:

- Teams with strict data privacy requirements can run BrowserHub with no external API calls.
- The platform is deployable on air-gapped networks.
- Contributors can work on core features without needing LLM API keys.
- AI features can evolve independently on forks without breaking the base platform.

---

## Phase 1 (Current — No AI)

The Node.js reference implementation does:

- Headless Chromium scraping via Playwright
- Visual scanning and regression detection
- Lead discovery via JSON source manifests
- Dataset storage and export
- TTS narration via Microsoft Edge neural voices (offline, no cloud API)
- Video generation via ffmpeg
- JWT + Google OAuth auth

None of these require an LLM or ML model. The TTS uses a local Microsoft library, not a cloud speech API.

---

## Phase 2 — AI as Plugin

AI features will be added as **opt-in modules** that augment the core platform. Each module:

1. Reads data that already exists (scraped records, screenshots, TTS jobs)
2. Calls an LLM or ML model API
3. Writes results back as enriched fields on the same records

Core platform code does not import or depend on any AI module.

### Planned AI Modules

#### 1. Lead Scoring (`ai/lead-scorer`)

After a pipeline run, classify each record by relevance to the user's search intent.

```javascript
// Example output per record
{
  "name": "Thiel Pediatric Dentistry",
  "aiScore": 0.91,
  "aiTags": ["pediatric", "highly-rated", "accredited"],
  "aiSummary": "Specialised children's dentistry, A+ BBB rating, established 2008."
}
```

Plugin point: `POST /api/pipeline/run` response enrichment hook.

#### 2. Content Classifier (`ai/content-classifier`)

Auto-tag scraped records using a zero-shot classifier (e.g. OpenAI, Anthropic Claude, or a local model via Ollama).

Plugin point: Dataset record save hook.

#### 3. Intelligent Wait Strategy (`ai/smart-wait`)

Ask the LLM: "Given this page HTML, what CSS selector should I wait for before scraping?" This replaces the manual `waitForSelector` field in source manifests.

Plugin point: `pipeline/steps/html-scrape.js` — `getWaitSelector()` function.

#### 4. Narration Script Writer (`ai/narration-writer`)

Given a page title and headings, generate a narration script before passing to TTS. Currently the TTS reads the raw page text — an LLM can produce cleaner, shorter scripts.

Plugin point: `video-studio/tts/edge-tts-service.js` — `buildScript()` function.

#### 5. Conversational Search (`ai/chat-search`)

Natural-language query interface over stored datasets ("find me all A+ rated dentists in Austin with reviews"). Uses embeddings + vector search.

Plugin point: New endpoint `POST /api/datasets/:id/query`.

---

## Fork Strategy for AI Contributors

We want the open source community to build these AI modules. Here is how:

### Step 1: Fork the repository

Fork `browser-hub` on GitHub.

### Step 2: Create your AI module

Create a folder under `src/ui-js/browser-hub-ui/ai/your-module-name/`:

```
ai/
└── lead-scorer/
    ├── index.js          # module entry point
    ├── config.example.json
    └── README.md
```

Your module should:
- Export a single `async function enrich(records, config)` (or equivalent)
- Be imported lazily in `server.js` only if `app.config.json` has the module's key configured
- Never be imported if the key is absent — this is what makes it opt-in

### Step 3: Wire the plugin point

Plugin points are marked with a comment in `server.js`:

```javascript
// [AI_PLUGIN_POINT: lead-scoring] — enrich records here if ai.leadScorer is configured
```

Wrap your module call:

```javascript
if (config.ai && config.ai.leadScorer) {
    const scorer = require('./ai/lead-scorer');
    records = await scorer.enrich(records, config.ai.leadScorer);
}
```

### Step 4: Document your module

Add a `README.md` to your module folder with:
- What it does
- Which LLM / model it uses
- Required `app.config.json` keys
- Example output

### Step 5: Open a PR

Submit your PR against the `dev` branch. Include:
- The module code under `ai/`
- The plugin point hook in `server.js`
- Updated `config/app.config.example.json` with the new keys

---

## Plugin Point Reference

The following locations in the Node.js codebase are designated AI plugin points:

| File | Location | Plugin Point ID | Description |
|------|----------|----------------|-------------|
| `server.js` | After `pipeline-done` emit | `lead-scoring` | Enrich pipeline records before saving |
| `server.js` | After dataset record insert | `content-classification` | Tag records on save |
| `pipeline/steps/html-scrape.js` | Before `waitForSelector` | `smart-wait` | Ask AI for the right wait selector |
| `video-studio/tts/edge-tts-service.js` | Before TTS call | `narration-writer` | Replace raw text with LLM-written script |
| `server.js` | New route `/api/datasets/:id/query` | `chat-search` | Natural-language query over records |

---

## Supported AI Backends

AI modules should be designed to work with any of these backends (configurable):

| Backend | Notes |
|---------|-------|
| OpenAI GPT-4o | Most capable, requires API key |
| Anthropic Claude | Strong reasoning, requires API key |
| Ollama (local) | No API key, runs fully offline |
| Azure OpenAI | For enterprises with Azure agreements |
| Hugging Face Inference | Open source models |

Use the backend as a configuration value, not a hard import:

```json
{
  "ai": {
    "leadScorer": {
      "backend": "ollama",
      "model": "llama3",
      "baseUrl": "http://localhost:11434"
    }
  }
}
```

---

## Calling All Contributors

If you are interested in building an AI module for BrowserHub:

1. Open a GitHub issue to claim the module you want to work on.
2. Discuss the design in the issue before starting implementation.
3. Fork, build, and open a PR.

The core team will review PRs that follow the plugin architecture above. Well-designed AI modules that work with the existing plugin points and do not modify core platform code will be merged.
