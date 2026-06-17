# BrowserHub — Pipeline Sources

The Lead Discovery pipeline discovers business records from public directories. Each source is defined by a JSON manifest file in `pipeline/sources/`. No code change is required to add a new source.

## Current Sources

| Source ID | Label | Status | Notes |
|-----------|-------|--------|-------|
| `yellowpages` | Yellow Pages | Working | 33 results/page |
| `bbb` | Better Business Bureau | Working | 13 results/page, grade + accreditation |
| `manta` | Manta | Needs work | Selectors need update |
| `tripadvisor` | TripAdvisor | Needs work | JS-rendered, slow load |
| `angi` | Angi (Angie's List) | Needs work | Auth wall on some searches |
| `yelp` | Yelp | Placeholder | Not yet implemented |
| `google` | Google Maps | Not started | Requires more work to avoid detection |
| `citysearch` | CitySearch | Not started | |

---

## Manifest Schema

```json
{
  "id": "string — unique identifier, filename without .json",
  "label": "string — human-readable name shown in UI",
  "type": "html-scrape | api-call",
  "enabled": true,
  "search": {
    "urlTemplate": "string — {keyword} and {location} are replaced at runtime",
    "waitForSelector": "string — CSS selector to wait for before extracting (optional but recommended)",
    "waitTimeout": 8000
  },
  "extract": {
    "listSelector": "string — CSS selector for each result card",
    "fields": {
      "fieldName": {
        "sel": "string — CSS selector relative to the list item",
        "attr": "text | href | src | alt | data-* | any attribute name",
        "transform": "string — optional named transform (see Transforms)"
      }
    }
  },
  "pagination": {
    "nextSelector": "string — CSS selector for 'next page' link (optional)",
    "maxPages": 1
  }
}
```

### Field Attribute Values

| Value | Meaning |
|-------|---------|
| `text` | `element.innerText.trim()` |
| `href` | `element.getAttribute('href')` |
| `src` | `element.getAttribute('src')` |
| `alt` | `element.getAttribute('alt')` |
| `data-foo` | `element.getAttribute('data-foo')` |

### Named Transforms

| Transform | Effect |
|-----------|--------|
| `bbb_url` | Resolves a relative BBB URL to an absolute URL |
| `normalize_phone` | Strips formatting → `5125550100` |
| `strip_whitespace` | Collapses internal whitespace |

You can add custom transforms in `pipeline/steps/html-scrape.js` under the `TRANSFORMS` object.

---

## Full Example: Yellow Pages

```json
{
  "id": "yellowpages",
  "label": "Yellow Pages",
  "type": "html-scrape",
  "enabled": true,
  "search": {
    "urlTemplate": "https://www.yellowpages.com/search?search_terms={keyword}&geo_location_terms={location}",
    "waitForSelector": "div.result"
  },
  "extract": {
    "listSelector": "div.result",
    "fields": {
      "name":     { "sel": "a.business-name span",           "attr": "text" },
      "phone":    { "sel": "div.phones.phone.primary",       "attr": "text" },
      "address":  { "sel": "span.street-address",            "attr": "text" },
      "city":     { "sel": "span.locality",                  "attr": "text" },
      "category": { "sel": "div.categories a",               "attr": "text" },
      "url":      { "sel": "a.business-name",                "attr": "href" },
      "website":  { "sel": "a.track-visit-website",          "attr": "href" }
    }
  }
}
```

## Full Example: BBB

```json
{
  "id": "bbb",
  "label": "Better Business Bureau",
  "type": "html-scrape",
  "enabled": true,
  "search": {
    "urlTemplate": "https://www.bbb.org/search?find_text={keyword}&find_loc={location}",
    "waitForSelector": "div.card.result-card"
  },
  "extract": {
    "listSelector": "div.card.result-card",
    "fields": {
      "name":       { "sel": "h3.result-business-name a span, h3.result-business-name a", "attr": "text" },
      "category":   { "sel": "p.text-size-4",                                              "attr": "text" },
      "grade":      { "sel": "span.result-rating, summary.result-rating, .result-rating",  "attr": "text" },
      "accredited": { "sel": "img.dtm-search-listing-seal",                                "attr": "alt"  },
      "phone":      { "sel": "a[href^='tel:']",                                            "attr": "text" },
      "address":    { "sel": "p.text-size-5[translate], p[translate='no']",                "attr": "text" },
      "url":        { "sel": "h3.result-business-name > a",                                "attr": "href", "transform": "bbb_url" }
    }
  }
}
```

---

## Adding a New Source

1. Find the directory listing page for the source (e.g. `https://newdirectory.com/search?q={keyword}&loc={location}`).
2. Open Chrome DevTools and inspect the HTML for one result card.
3. Identify the stable CSS selector for the card container (avoid CSS module hashes — use BEM class names or `data-*` attributes).
4. For each field you want, find the selector relative to the card container.
5. Create `pipeline/sources/newsource.json` following the manifest schema above.
6. Add `"waitForSelector"` to ensure the scraper waits for results to render (important for JavaScript-rendered pages).
7. Test by running a pipeline from the Lead Discovery UI.

### Tips for JS-Rendered Pages

Many modern directories render their results with React or Next.js. In that case:

- `waitForSelector` is essential — without it the scraper reads the page before hydration.
- If the page uses infinite scroll, set `maxPages: 1` to avoid running forever.
- Use `networkidle` wait: the pipeline runner already does this automatically (10-second timeout).
- If the page requires login to view results, the source is not suitable for the public pipeline.

### Finding Stable Selectors

Avoid:
- CSS module hashes: `div.Card_card__xK9pQ` — these change with every build.
- Deeply nested selectors: `main > div > ul > li:nth-child(2) > div > span` — fragile.
- Generic tags: `p:first-child` — matches too many elements.

Prefer:
- BEM class names: `div.result-card`, `h3.result-business-name`
- `data-*` attributes: `div[data-testid="business-card"]`
- ARIA attributes: `[role="listitem"]`
- Schema.org: `[itemtype*="LocalBusiness"]` (for microdata, not JSON-LD)

---

## API-Type Sources

For directories that expose a public JSON API instead of HTML, use `"type": "api-call"`:

```json
{
  "id": "openfda",
  "label": "OpenFDA",
  "type": "api-call",
  "search": {
    "urlTemplate": "https://api.fda.gov/drug/event.json?search={keyword}&limit=20"
  },
  "extract": {
    "recordsPath": "results",
    "fields": {
      "reportId":    { "path": "safetyreportid" },
      "seriousness": { "path": "serious" }
    }
  }
}
```

The `recordsPath` is a dot-path into the JSON response to the array of records. Each `path` is a dot-path into each record object.

The `api-call` step type is implemented in `pipeline/steps/api-call.js`.
