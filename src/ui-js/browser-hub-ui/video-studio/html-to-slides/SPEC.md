# HTML Presentation Spec — BizFirst Slide Format

This spec defines the exact HTML structure required for a file to be
convertible by `convert.js`. When asking Claude (or any AI) to generate
a new presentation, include this spec in the prompt.

---

## Required Structure

### 1. Slide Elements

Every slide **must** be a direct child of `#deck` and carry the `.slide` class.
The currently visible slide carries `.active`.

```html
<div id="deck">
  <div class="slide active" data-slide="1"> ... </div>
  <div class="slide"        data-slide="2"> ... </div>
  <div class="slide"        data-slide="3"> ... </div>
</div>
```

| Attribute / Class | Required | Purpose |
|---|---|---|
| `id="deck"` | Yes | Container — converter scopes detection here |
| `.slide` | Yes | Marks each slide — converter counts these |
| `.active` | Yes | Only one at a time — the visible slide |
| `data-slide="N"` | Recommended | 1-based index, used for debugging |

---

### 2. Navigation Function

The converter calls `go(index)` (0-based) to activate each slide.
This function **must** exist in the page's JavaScript.

```javascript
// Minimum required implementation
function go(n) {
  const slides = document.querySelectorAll('.slide');
  slides.forEach((el, i) => el.classList.toggle('active', i === n));
}
```

The full BizFirst pattern also updates the counter and progress bar:

```javascript
const slides = document.querySelectorAll('.slide');
const total  = slides.length;
let cur = 0;

function go(n) {
  slides[cur].classList.remove('active');
  cur = Math.max(0, Math.min(total - 1, n));
  slides[cur].classList.add('active');
  // Optional UI updates:
  document.getElementById('counter').textContent = (cur + 1) + ' / ' + total;
  document.getElementById('progress').style.width = ((cur + 1) / total * 100) + '%';
}
```

---

### 3. CSS — Slide Visibility

Slides are hidden/shown via the `.active` class. The converter
relies on this pattern — do not use `display:none` directly on elements
without toggling `.active`.

```css
.slide        { display: none;  }
.slide.active { display: flex;  }   /* or block / grid */
```

---

### 4. Recommended Elements (Optional but Standard)

```html
<!-- Top navigation bar -->
<div id="topbar">
  <div class="tb-left">
    <img src="https://bizfirstai.com/website/assets/Logo/logo-m.png"
         alt="BizFirstAI" onerror="this.style.display='none'">
    <span class="tb-title">Presentation Title</span>
  </div>
  <div class="tb-right">
    <span class="tb-series">Series N of 3 — Subtitle</span>
    <span id="counter">1 / 17</span>
  </div>
</div>

<!-- Progress bar -->
<div id="progress"></div>

<!-- Navigation buttons -->
<div id="nav-btns">
  <button id="btn-prev">←</button>
  <button id="btn-next">→</button>
</div>
```

---

### 5. Complete Minimal Template

Copy this as the starting point for any new BizFirst presentation:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Title</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary:        #16A34A;
      --primary-light:  #22C55E;
      --primary-subtle: rgba(22,163,74,0.12);
      --bg-base:        #080F08;
      --bg-raised:      #0C150C;
      --bg-surface:     #172017;
      --text-primary:   #F0FDF4;
      --text-secondary: #D1FAE5;
      --text-muted:     #86EFAC;
      --text-dim:       #4B7055;
      --border-default: rgba(22,163,74,0.15);
      --border-primary: rgba(22,163,74,0.50);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; background: var(--bg-base); color: var(--text-primary); font-family: 'Inter', sans-serif; }

    /* ── Progress bar ── */
    #progress { position: fixed; top: 0; left: 0; height: 3px; background: linear-gradient(90deg, var(--primary), var(--primary-light)); transition: width .3s ease; z-index: 1000; }

    /* ── Top bar ── */
    #topbar { position: fixed; top: 0; left: 0; right: 0; height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 40px; background: rgba(8,15,8,0.96); border-bottom: 1px solid var(--border-default); z-index: 999; }
    .tb-left  { display: flex; align-items: center; gap: 12px; }
    .tb-logo  { height: 26px; }
    .tb-title { font-size: 12px; font-weight: 500; color: var(--text-muted); }
    .tb-right { display: flex; align-items: center; gap: 16px; }
    #counter  { font-size: 13px; color: var(--text-muted); }

    /* ── Deck & Slides ── (REQUIRED) */
    #deck { position: fixed; top: 52px; left: 0; right: 0; bottom: 0; }
    .slide { position: absolute; inset: 0; padding: 48px 64px; display: none; flex-direction: column; justify-content: center; overflow: hidden; }
    .slide.active { display: flex; }

    /* ── Nav buttons ── */
    #nav-btns { position: fixed; bottom: 28px; right: 40px; display: flex; gap: 8px; z-index: 999; }
    .nbtn { width: 38px; height: 38px; border-radius: 8px; border: 1px solid var(--border-default); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .nbtn svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    /* ── Slide fade-in ── */
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .slide.active > * { animation: fadeIn 0.35s ease both; }
  </style>
</head>
<body>

<div id="progress"></div>

<div id="topbar">
  <div class="tb-left">
    <img class="tb-logo"
         src="https://bizfirstai.com/website/assets/Logo/logo-m.png"
         alt="BizFirstAI"
         onerror="this.style.display='none'">
    <span class="tb-title">YOUR PRESENTATION TITLE</span>
  </div>
  <div class="tb-right">
    <span id="counter">1 / 3</span>
  </div>
</div>

<!-- ═══ DECK (required wrapper) ═══ -->
<div id="deck">

  <div class="slide active" data-slide="1">
    <h1>Slide 1 Title</h1>
    <p>Slide 1 content goes here.</p>
  </div>

  <div class="slide" data-slide="2">
    <h1>Slide 2 Title</h1>
    <p>Slide 2 content goes here.</p>
  </div>

  <div class="slide" data-slide="3">
    <h1>Slide 3 Title</h1>
    <p>Slide 3 content goes here.</p>
  </div>

</div><!-- /deck -->

<div id="nav-btns">
  <button class="nbtn" id="btn-prev"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
  <button class="nbtn" id="btn-next"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>
</div>

<script>
const slides = document.querySelectorAll('.slide');
const total  = slides.length;
let cur = 0;

// REQUIRED: go(n) — activates slide at 0-based index n
function go(n) {
  slides[cur].classList.remove('active');
  cur = Math.max(0, Math.min(total - 1, n));
  slides[cur].classList.add('active');
  document.getElementById('counter').textContent = (cur + 1) + ' / ' + total;
  document.getElementById('progress').style.width = ((cur + 1) / total * 100) + '%';
}

document.getElementById('btn-next').addEventListener('click', () => go(cur + 1));
document.getElementById('btn-prev').addEventListener('click', () => go(cur - 1));
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(cur + 1); }
  if (e.key === 'ArrowLeft')                   { e.preventDefault(); go(cur - 1); }
  if (e.key === 'f' || e.key === 'F')          { document.documentElement.requestFullscreen?.(); }
});
document.getElementById('deck').addEventListener('click', e => {
  if (e.target.closest('#nav-btns')) return;
  if (e.clientX > window.innerWidth / 2) go(cur + 1); else go(cur - 1);
});

go(0);
</script>
</body>
</html>
```

---

## Converter Detection Logic

When `convert.js` opens an HTML file it:

1. Counts `.slide` elements → total slides
2. Calls `go(i)` for each `i` from `0` to `total - 1`
3. Waits 400ms for transitions
4. Screenshots the full viewport at 1920 × 1080

**The converter will fail if:**
- No `.slide` elements exist
- The `go()` function is not defined (falls back to manual class toggle)
- Slides are hidden with `visibility:hidden` instead of `display:none`

---

## Prompt for Claude to Generate a New Presentation

```
Generate a BizFirst HTML presentation with [N] slides about [TOPIC].

Requirements:
- Follow the BizFirst Slide Format Spec exactly (SPEC.md)
- Use the BizFirst dark green CSS variables:
    --primary: #16A34A, --primary-light: #22C55E
    --bg-base: #080F08, --bg-surface: #172017
    --text-primary: #F0FDF4, --text-muted: #86EFAC
- Include the go(n) navigation function (required for converter)
- Include #deck wrapper with .slide elements
- SVG icons only — no emoji
- Font: Inter + JetBrains Mono (Google Fonts)
- Logo: https://bizfirstai.com/website/assets/Logo/logo-m.png
- No n8n mentions
- Self-contained single HTML file
```
