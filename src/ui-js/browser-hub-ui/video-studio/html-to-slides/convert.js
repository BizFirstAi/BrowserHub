/**
 * html-to-slides/convert.js
 *
 * Converts any BizFirst HTML presentation to PNG slide images using Playwright.
 * Playwright is already installed in the parent project — no extra install needed.
 *
 * Usage (single file):
 *   node html-to-slides/convert.js <html-path> [output-dir] [--width=1920] [--height=1080] [--delay=400]
 *
 * Examples:
 *   node html-to-slides/convert.js "C:\...\Presentation_01_Introduction.html"
 *   node html-to-slides/convert.js presentation.html ./out/p01 --width=1280 --height=720
 */

'use strict';

const { chromium } = require('playwright');
const path  = require('path');
const fs    = require('fs');

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const [,, htmlFile, ...rest] = argv;
  let outputDir = null;
  const opts = { width: 1920, height: 1080, delay: 400 };

  rest.forEach(arg => {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      opts[k] = isNaN(v) ? v : Number(v);
    } else if (!outputDir) {
      outputDir = arg;
    }
  });

  return { htmlFile, outputDir, opts };
}

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

// ── Core converter ────────────────────────────────────────────────────────────

async function convertToSlides(htmlFile, outputDir, opts = {}) {
  const { width = 1920, height = 1080, delay = 400 } = opts;

  const absHtml = path.resolve(htmlFile);
  if (!fs.existsSync(absHtml)) {
    throw new Error(`File not found: ${absHtml}`);
  }

  // Default output dir: <html-filename>-slides/ next to the source file
  const baseName = path.basename(absHtml, path.extname(absHtml));
  const absOut   = path.resolve(outputDir || path.join(path.dirname(absHtml), `${baseName}-slides`));
  fs.mkdirSync(absOut, { recursive: true });

  console.log(`\nConverting: ${absHtml}`);
  console.log(`Output:     ${absOut}`);
  console.log(`Viewport:   ${width} × ${height}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  const page    = await context.newPage();

  // Load the HTML file
  const fileUrl = 'file:///' + absHtml.replace(/\\/g, '/');
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  // Wait for fonts + CSS animations to settle
  await page.waitForTimeout(1200);

  // Detect total slide count
  const totalSlides = await page.evaluate(() =>
    document.querySelectorAll('.slide').length
  );

  if (totalSlides === 0) {
    await browser.close();
    throw new Error(
      'No .slide elements found.\n' +
      'See html-to-slides/SPEC.md for the required HTML structure.'
    );
  }

  console.log(`Slides detected: ${totalSlides}`);
  console.log('─'.repeat(40));

  const saved = [];

  for (let i = 0; i < totalSlides; i++) {
    // Activate slide using the standard go(n) function, or fallback to class toggle
    await page.evaluate((idx) => {
      if (typeof go === 'function') {
        go(idx);
        return;
      }
      // Fallback: manual .active toggle
      document.querySelectorAll('.slide').forEach((el, j) => {
        el.classList.toggle('active', j === idx);
      });
    }, i);

    // Wait for transition
    await page.waitForTimeout(delay);

    const filename = `slide-${pad(i + 1)}.png`;
    const filepath = path.join(absOut, filename);
    await page.screenshot({ path: filepath, type: 'png', fullPage: false });

    saved.push(filename);
    process.stdout.write(`  [${pad(i + 1)}/${totalSlides}] ${filename} ✓\n`);
  }

  await browser.close();

  console.log('─'.repeat(40));
  console.log(`\nDone — ${totalSlides} slides saved to:\n${absOut}\n`);

  return { totalSlides, outputDir: absOut, files: saved };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  const { htmlFile, outputDir, opts } = parseArgs(process.argv);

  if (!htmlFile) {
    console.log([
      '',
      'Usage:',
      '  node html-to-slides/convert.js <html-file> [output-dir] [options]',
      '',
      'Options:',
      '  --width=N    Viewport width  (default: 1920)',
      '  --height=N   Viewport height (default: 1080)',
      '  --delay=N    ms to wait per slide transition (default: 400)',
      '',
      'Examples:',
      '  node html-to-slides/convert.js presentation.html',
      '  node html-to-slides/convert.js presentation.html ./out --width=1280 --height=720',
      '',
    ].join('\n'));
    process.exit(0);
  }

  convertToSlides(htmlFile, outputDir, opts)
    .catch(err => {
      console.error('\nError:', err.message);
      process.exit(1);
    });
}

module.exports = { convertToSlides };
