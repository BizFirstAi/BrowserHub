/**
 * html-to-slides/url-convert.js
 *
 * URL-based converter — screenshot slides, generate PDF.
 * Accepts http/https and file:// URLs.
 */

'use strict';

const { chromium } = require('playwright');
const { launchStealth, newStealthContext } = require('../../browser-studio/browser/stealth');

// Use stealth browser for external HTTP/HTTPS URLs; plain chromium for file://
function isExternalUrl(url) { return /^https?:\/\//i.test(url); }

const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };

/**
 * Convert a URL to slide images (or a full-page screenshot).
 *
 * @param {string} url
 * @param {object} opts
 * @param {boolean} opts.autoDetect       detect .slide elements (default true)
 * @param {boolean} opts.fullPageFallback full-page screenshot if not a presentation (default true)
 * @param {number}  opts.width            viewport width (default 1920)
 * @param {number}  opts.height           viewport height (default 1080)
 * @param {number}  opts.delay            ms to wait per slide (default 400)
 * @param {string}  opts.format           'png' | 'jpeg' | 'webp' (default 'png')
 * @param {number}  opts.quality          JPEG/WebP quality 1–100 (default 92)
 * @param {function} opts.onSlide         callback(index, total) after each slide
 * @returns {Promise<{isPresentation, slideCount, images: Array<{filename,buffer}>}>}
 */
async function convertUrl(url, opts = {}) {
  const {
    autoDetect       = true,
    fullPageFallback = true,
    width            = 1920,
    height           = 1080,
    delay            = 400,
    format           = 'png',
    quality          = 92,
    onSlide          = null,
  } = opts;

  const ext            = EXT[format] || 'png';
  const screenshotOpts = { type: format, fullPage: false };
  if (format === 'jpeg' || format === 'webp') screenshotOpts.quality = quality;

  const usesStealth = isExternalUrl(url);
  const browser = usesStealth
      ? await launchStealth()
      : await chromium.launch({ headless: true });
  const context = usesStealth
      ? await newStealthContext(browser, { viewport: { width, height }, seed: (() => { try { return new URL(url).hostname; } catch { return null; } })() })
      : await browser.newContext({ viewport: { width, height } });
  const page    = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);

    const slideCount = autoDetect
      ? await page.evaluate(() => document.querySelectorAll('.slide').length)
      : 0;

    const isPresentation = slideCount > 0;
    const images = [];

    if (isPresentation) {
      for (let i = 0; i < slideCount; i++) {
        await page.evaluate((idx) => {
          if (typeof go === 'function') { go(idx); return; }
          document.querySelectorAll('.slide').forEach((el, j) =>
            el.classList.toggle('active', j === idx));
        }, i);

        await page.waitForTimeout(delay);

        const filename = `slide-${String(i + 1).padStart(2, '0')}.${ext}`;
        const buffer   = await page.screenshot(screenshotOpts);
        images.push({ filename, buffer });

        if (onSlide) onSlide(i + 1, slideCount);
      }
    } else if (fullPageFallback) {
      const buffer = await page.screenshot({ ...screenshotOpts, fullPage: true });
      const safe   = url.replace(/[^a-z0-9]/gi, '_').slice(-40);
      images.push({ filename: `screenshot-${safe}.${ext}`, buffer });
    }

    return { isPresentation, slideCount: images.length, images };

  } finally {
    await browser.close();
  }
}

/**
 * Generate a single PDF from a presentation URL.
 * Each slide becomes one landscape A4 page.
 * Requires the images to already be captured (pass them in).
 *
 * @param {Array<{filename,buffer}>} images  PNG buffers from convertUrl
 * @returns {Promise<Buffer>} PDF buffer
 */
async function imagesToPdf(images) {
  if (!images || images.length === 0) throw new Error('No images to convert to PDF');

  // Build a print-ready HTML page with each image on its own @page
  const imgTags = images.map(img => {
    const b64 = img.buffer.toString('base64');
    // Detect format from filename extension
    const ext = img.filename.split('.').pop().toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
               : ext === 'webp' ? 'image/webp'
               : 'image/png';
    return `<div class="pg"><img src="data:${mime};base64,${b64}"></div>`;
  }).join('\n');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
@page { size: A4 landscape; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; background: #000; }
.pg {
  width: 297mm; height: 210mm;
  display: flex; align-items: center; justify-content: center;
  page-break-after: always; overflow: hidden; background: #000;
}
.pg:last-child { page-break-after: auto; }
img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
</style></head><body>${imgTags}</body></html>`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      format:          'A4',
      landscape:       true,
      printBackground: true,
      margin:          { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

/**
 * Record a live browser session of a BizFirst presentation as a WebM video.
 * Playwright navigates each slide and holds for `duration` seconds so
 * CSS transitions and animations are captured in real time.
 *
 * @param {string} url
 * @param {object} opts
 * @param {boolean} opts.autoDetect   detect .slide elements (default true)
 * @param {number}  opts.width        viewport width (default 1920)
 * @param {number}  opts.height       viewport height (default 1080)
 * @param {number}  opts.duration     seconds to hold each slide (default 3)
 * @param {function} opts.onSlide     callback(index, total) after each slide
 * @returns {Promise<{buffer:Buffer, filename:string, isPresentation:bool, slideCount:number}>}
 */
async function recordPresentation(url, opts = {}) {
  const {
    autoDetect = true,
    width      = 1920,
    height     = 1080,
    duration   = 3,
    onSlide    = null,
  } = opts;

  const os   = require('os');
  const fs   = require('fs');
  const path = require('path');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-rec-'));

  // --use-gl=swiftshader forces software OpenGL so the compositor renders correctly
  // in headless mode on Windows (without it, recordVideo produces blank white frames)
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--disable-gpu-sandbox'],
  });
  const context = await browser.newContext({
    viewport:    { width, height },
    recordVideo: { dir: tmpDir, size: { width, height } },
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200); // fonts + initial paint

    const slideCount = autoDetect
      ? await page.evaluate(() => document.querySelectorAll('.slide').length)
      : 0;

    const isPresentation = slideCount > 0;

    if (isPresentation) {
      for (let i = 0; i < slideCount; i++) {
        await page.evaluate((idx) => {
          if (typeof go === 'function') { go(idx); return; }
          document.querySelectorAll('.slide').forEach((el, j) =>
            el.classList.toggle('active', j === idx));
        }, i);

        // Hold the slide so the animation completes and the user can "read" it
        await page.waitForTimeout(duration * 1000);
        if (onSlide) onSlide(i + 1, slideCount);
      }
    } else {
      // Regular page — just record for `duration` seconds
      await page.waitForTimeout(duration * 1000);
    }

    // context.close() finalises the video file
    await context.close();

    const videoPath = await page.video().path();
    const buffer    = fs.readFileSync(videoPath);

    return {
      buffer,
      filename:       'recording.webm',
      isPresentation,
      slideCount:     isPresentation ? slideCount : 1,
    };

  } finally {
    await browser.close();
    // Clean up temp dir (best-effort — video buffer already read)
    try { require('fs').rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = { convertUrl, imagesToPdf, recordPresentation };
