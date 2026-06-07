'use strict';

// ── page-scraper.js ─────────────────────────────────────────────────────────
// Browser-pool scraper with full stealth layer.
// Stealth capabilities provided by browser/stealth.js:
//   • playwright-extra + puppeteer-extra-plugin-stealth
//   • Canvas fingerprint noise injection
//   • WebGL GPU vendor spoof
//   • Consistent UA / viewport / locale / timezone per domain
//   • navigator.webdriver removed
//
// Proxy rotation: each URL picks a proxy from the pool independently,
// not just per-worker — maximises IP diversity across a large URL list.

const { launchStealth, newStealthContext } = require('../browser/stealth');

// ── Bot-detection response detection ───────────────────────────────────────
// These HTTP status codes and content patterns indicate a bot-wall response.

const BOT_STATUS_CODES = new Set([403, 429, 503, 521, 523, 525]);

const BOT_BODY_PATTERNS = [
    /access denied/i,
    /captcha/i,
    /cloudflare/i,
    /just a moment/i,          // Cloudflare challenge page
    /ray id:/i,                // Cloudflare Ray ID
    /please enable cookies/i,
    /you have been blocked/i,
    /detected as a bot/i,
    /unusual traffic/i,        // Google's anti-scrape
    /are you a robot/i,
    /security check/i,
    /ddos-guard/i,
    /bot detected/i,
    /verifying you are human/i,
];

function looksLikeBotWall(status, bodyText) {
    if (BOT_STATUS_CODES.has(status)) return true;
    return BOT_BODY_PATTERNS.some(p => p.test(bodyText));
}

// ── Human-like delay ────────────────────────────────────────────────────────
// Adds Gaussian-ish jitter to avoid constant-interval request fingerprints.

function humanDelay(baseMs = 800, jitterMs = 600) {
    const delay = baseMs + Math.random() * jitterMs;
    return new Promise(r => setTimeout(r, delay));
}

// ── Proxy rotation ──────────────────────────────────────────────────────────

function pickProxy(proxies, urlIndex) {
    if (!proxies || !proxies.length) return null;
    // Rotate by URL index (deterministic) + small random offset each call
    // so the same URL retried gets a fresh proxy.
    const offset = Math.floor(Math.random() * proxies.length);
    const raw    = proxies[(urlIndex + offset) % proxies.length];
    return parseProxy(raw);
}

/**
 * Parse a proxy string into a Playwright proxy object.
 * Supported formats:
 *   http://host:port
 *   http://user:pass@host:port
 *   socks5://host:port
 *   host:port  (assumes http)
 */
function parseProxy(raw) {
    if (!raw) return null;
    let str = raw.trim();
    if (!/^[a-z]+:\/\//i.test(str)) str = 'http://' + str;
    try {
        const u = new URL(str);
        const proxy = { server: `${u.protocol}//${u.hostname}:${u.port}` };
        if (u.username) proxy.username = decodeURIComponent(u.username);
        if (u.password) proxy.password = decodeURIComponent(u.password);
        return proxy;
    } catch {
        return { server: str };
    }
}

// ── Extraction helpers ──────────────────────────────────────────────────────

async function autoExtract(page, url) {
    try {
        return await page.evaluate((pageUrl) => {
            const $$ = (sel) => [...document.querySelectorAll(sel)];
            const text = (sel) => $$(sel).map(e => e.textContent.trim()).filter(Boolean);
            const metaContent = (name) =>
                document.querySelector(`meta[name="${name}"]`)?.content ||
                document.querySelector(`meta[property="${name}"]`)?.content || '';

            const bodyClone = document.body ? document.body.cloneNode(true) : null;
            if (bodyClone) bodyClone.querySelectorAll('script,style,noscript,svg').forEach(el => el.remove());
            const bodyText = bodyClone
                ? (bodyClone.innerText || bodyClone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 8000)
                : '';

            const links = $$('a[href]').slice(0, 500).map(a => ({
                text: a.textContent.trim().slice(0, 200),
                href: a.href,
            })).filter(l => l.href && !l.href.startsWith('javascript'));

            const images = $$('img[src]').slice(0, 100).map(img => ({
                src: img.src, alt: img.alt || '',
            }));

            let jsonLd = [];
            try {
                $$('script[type="application/ld+json"]').forEach(s => {
                    jsonLd.push(JSON.parse(s.textContent));
                });
            } catch { /* ignore */ }

            return {
                url:         pageUrl,
                status:      'ok',
                title:       document.title || '',
                description: metaContent('description') || metaContent('og:description'),
                h1:          text('h1'),
                h2:          text('h2'),
                h3:          text('h3'),
                paragraphs:  text('p').slice(0, 30),
                bodyText,
                links,
                images,
                meta: {
                    ogTitle:   metaContent('og:title'),
                    ogImage:   metaContent('og:image'),
                    keywords:  metaContent('keywords'),
                    author:    metaContent('author'),
                    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
                    robots:    metaContent('robots'),
                },
                jsonLd,
                scrapedAt: new Date().toISOString(),
            };
        }, url);
    } catch (err) {
        return { url, status: 'error', error: `Evaluation failed: ${err.message}`, scrapedAt: new Date().toISOString() };
    }
}

async function extractSelectors(page, url, selectors) {
    const result = { url, status: 'ok', scrapedAt: new Date().toISOString() };
    for (const { name, selector, attribute = 'text', multiple = false } of selectors) {
        try {
            result[name] = await page.evaluate((sel, attr, multi) => {
                const els = [...document.querySelectorAll(sel)];
                const pick = (el) => {
                    if (attr === 'text') return el.textContent.trim();
                    if (attr === 'html') return el.innerHTML.trim();
                    if (attr === 'href') return el.href || el.getAttribute('href') || '';
                    if (attr === 'src')  return el.src  || el.getAttribute('src')  || '';
                    return el.getAttribute(attr) || '';
                };
                return multi ? els.map(pick) : (els[0] ? pick(els[0]) : '');
            }, selector, attribute, multiple);
        } catch {
            result[name] = multiple ? [] : '';
        }
    }
    return result;
}

// ── Core scrape with retry ─────────────────────────────────────────────────

/**
 * Scrape a single URL with bot-detection retry logic.
 * Opens a fresh page per attempt; rotates proxy on retry.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string}   url
 * @param {object}   opts
 * @param {number}   opts.timeout
 * @param {string}   opts.waitUntil
 * @param {Array}    opts.selectors
 * @param {Array}    opts.proxies
 * @param {number}   opts.urlIndex    for proxy rotation
 * @param {number}   opts.maxRetries
 * @param {function} opts.onRetry
 * @returns {Promise<object>}
 */
async function scrapeOne(context, url, opts = {}) {
    const {
        timeout    = 30000,
        waitUntil  = 'networkidle',
        selectors  = null,
        maxRetries = 2,
        onRetry    = null,
    } = opts;

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const page = await context.newPage();
        try {
            // Abort image/font/media requests to speed up scraping and avoid
            // leaking our IP to third-party CDNs (do not block on first attempt
            // in case the site requires a resource for rendering)
            if (attempt > 0) {
                await page.route('**/*.{woff,woff2,ttf,otf,eot}', r => r.abort());
                await page.route('**/*.{mp4,mp3,ogg,wav,webm}',    r => r.abort());
            }

            let responseStatus = 200;
            page.on('response', r => {
                if (r.url() === url || r.url().startsWith(url.split('?')[0])) {
                    responseStatus = r.status();
                }
            });

            await page.goto(url, { waitUntil, timeout });

            // Human-like pause after page load
            await humanDelay(500, 800);

            // Check for bot-wall in rendered content
            const bodyText = await page.evaluate(() =>
                (document.body?.innerText || '').slice(0, 2000)
            ).catch(() => '');

            if (looksLikeBotWall(responseStatus, bodyText)) {
                throw Object.assign(new Error(`Bot-wall detected (HTTP ${responseStatus})`), { isBotWall: true });
            }

            const result = selectors
                ? await extractSelectors(page, url, selectors)
                : await autoExtract(page, url);

            return result;

        } catch (err) {
            lastError = err;
            if (onRetry) onRetry({ url, attempt, error: err.message, isBotWall: !!err.isBotWall });

            // Exponential back-off before retry
            if (attempt < maxRetries) {
                await humanDelay(2000 * Math.pow(2, attempt), 1000);
            }
        } finally {
            await page.close().catch(() => {});
        }
    }

    return {
        url,
        status: 'error',
        error: lastError?.message || 'Unknown error',
        scrapedAt: new Date().toISOString(),
    };
}

// ── Browser pool ────────────────────────────────────────────────────────────

/**
 * Scrape a list of URLs in parallel using a stealth browser pool.
 *
 * @param {string[]} urls
 * @param {object}   opts
 * @param {number}   opts.concurrency    Parallel browser count (default 4, max 16)
 * @param {number}   opts.timeout        Page load timeout ms (default 30000)
 * @param {string}   opts.waitUntil      'networkidle' | 'domcontentloaded' | 'load'
 * @param {Array|null} opts.selectors    null = auto extract; array = custom selectors
 * @param {string[]} opts.proxies        Proxy URLs to rotate (optional)
 * @param {object}   opts.cancelRef      { cancelled: false } — set true to abort
 * @param {function} opts.onProgress     Progress callback({type, url, workerId, ...})
 * @param {number}   opts.maxRetries     Retries per URL on bot-wall (default 2)
 * @returns {Promise<Array>}
 */
async function scrapeUrls(urls, opts = {}) {
    const {
        concurrency = 4,
        timeout     = 30000,
        waitUntil   = 'networkidle',
        selectors   = null,
        proxies     = [],
        cancelRef   = { cancelled: false },
        onProgress  = null,
        maxRetries  = 2,
    } = opts;

    const poolSize = Math.min(Math.max(1, concurrency), 16, urls.length);
    const queue    = [...urls.entries()];   // [[index, url], ...]
    const results  = new Array(urls.length).fill(null);
    let   active   = 0;

    // Launch all stealth browsers in parallel
    const browsers = await Promise.all(
        Array.from({ length: poolSize }, () => launchStealth())
    );

    const worker = async (browser, workerId) => {
        // Each worker gets one persistent context; proxy is applied at context level.
        // Workers with multiple proxies rotate context on retry inside scrapeOne.
        const proxyObj = proxies.length
            ? parseProxy(proxies[workerId % proxies.length])
            : null;

        // Extract hostname seed for deterministic fingerprint per domain
        const context = await newStealthContext(browser, {
            proxy: proxyObj,
            seed:  null,  // random per-worker; scrapeOne could pass URL host for per-domain consistency
        });

        try {
            while (true) {
                if (cancelRef.cancelled) break;
                const entry = queue.shift();
                if (!entry) break;
                const [idx, url] = entry;

                active++;
                if (onProgress) onProgress({
                    type: 'url-start', url, workerId, active, poolSize,
                    completed: urls.length - queue.length - active,
                    total: urls.length,
                });

                // Derive hostname seed so same domain always gets same UA/viewport
                let seed;
                try { seed = new URL(url).hostname; } catch { seed = null; }

                const result = await scrapeOne(context, url, {
                    timeout, waitUntil, selectors,
                    proxies, urlIndex: idx,
                    maxRetries,
                    onRetry: ({ attempt, error, isBotWall }) => {
                        if (onProgress) onProgress({
                            type: 'url-retry', url, workerId, attempt, error, isBotWall,
                            total: urls.length,
                        });
                    },
                });

                active--;
                results[idx] = result;

                if (result.status === 'error') {
                    if (onProgress) onProgress({
                        type: 'url-error', url, workerId, error: result.error,
                        completed: urls.length - queue.length, total: urls.length,
                    });
                } else {
                    if (onProgress) onProgress({
                        type: 'url-done', url, workerId, result,
                        completed: urls.length - queue.length, total: urls.length,
                    });
                }

                // Brief human-like gap between requests in the same browser
                await humanDelay(300, 500);
            }
        } finally {
            await context.close().catch(() => {});
        }
    };

    try {
        await Promise.all(browsers.map((b, i) => worker(b, i)));
    } finally {
        await Promise.all(browsers.map(b => b.close().catch(() => {})));
    }

    if (onProgress) onProgress({ type: 'done', total: urls.length });
    return results.filter(Boolean);
}

// ── Output formatters ───────────────────────────────────────────────────────

function toCSV(results) {
    if (!results.length) return '';
    const scalar = (v) => {
        if (v === null || v === undefined) return '';
        if (Array.isArray(v))   return v.map(i => typeof i === 'object' ? JSON.stringify(i) : String(i)).join(' | ');
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
    };
    const allKeys = new Set(['url', 'status', 'title', 'description']);
    results.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
    const headers = [...allKeys];
    const esc = (v) => '"' + scalar(v).replace(/"/g, '""') + '"';
    return [
        headers.map(h => `"${h}"`).join(','),
        ...results.map(r => headers.map(h => esc(r[h])).join(',')),
    ].join('\r\n');
}

function toMarkdown(results) {
    return results.map((r, i) => {
        const lines = [`## ${i + 1}. ${r.title || r.url}`, '', `**URL:** ${r.url}`, ''];
        if (r.status === 'error') { lines.push(`> **Error:** ${r.error}`); return lines.join('\n'); }
        if (r.description) lines.push(`**Description:** ${r.description}`, '');
        if (r.h1?.length)  lines.push(`**H1:** ${r.h1.join(' / ')}`, '');
        if (r.h2?.length)  lines.push(`**H2:** ${r.h2.slice(0, 5).join(' / ')}`, '');
        if (r.bodyText)    lines.push('**Content:**', '', r.bodyText.slice(0, 800), '');
        if (r.links?.length) {
            lines.push(`**Links (${r.links.length}):**`, '');
            r.links.slice(0, 5).forEach(l => lines.push(`- [${l.text || l.href}](${l.href})`));
            if (r.links.length > 5) lines.push(`- _(${r.links.length - 5} more)_`);
            lines.push('');
        }
        return lines.join('\n');
    }).join('\n\n---\n\n');
}

module.exports = { scrapeUrls, toCSV, toMarkdown, parseProxy };
