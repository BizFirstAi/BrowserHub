'use strict';

const { chromium } = require('playwright-extra');
const stealth      = require('puppeteer-extra-plugin-stealth');

chromium.use(stealth());

const TRANSFORMS = {
    yp_rating(val) {
        const m = (val || '').match(/rating-([\d-]+)/);
        if (!m) return null;
        return parseFloat(m[1].replace('-', '.')) || null;
    },
    yp_url(val) {
        if (!val) return '';
        if (val.startsWith('http')) return val;
        return 'https://www.yellowpages.com' + val;
    },
    ta_url(val) {
        if (!val) return '';
        if (val.startsWith('http')) return val;
        return 'https://www.tripadvisor.com' + val;
    },
    manta_url(val) {
        if (!val) return '';
        if (val.startsWith('http')) return val;
        return 'https://www.manta.com' + val;
    },
    bbb_url(val) {
        if (!val) return '';
        if (val.startsWith('http')) return val;
        return 'https://www.bbb.org' + val;
    },
    angi_url(val) {
        if (!val) return '';
        if (val.startsWith('http')) return val;
        return 'https://www.angi.com' + val;
    },
};

async function extractFromPage(page, listSelector, fieldDefs) {
    return page.$$eval(listSelector, (els, defs) => {
        return els.map(el => {
            const out = {};
            for (const [key, def] of Object.entries(defs)) {
                try {
                    const node = def.sel ? el.querySelector(def.sel) : el;
                    if (!node) { out[key] = ''; continue; }
                    if (def.attr === 'text') out[key] = node.innerText?.trim() || '';
                    else out[key] = node.getAttribute(def.attr)?.trim() || '';
                } catch { out[key] = ''; }
            }
            return out;
        });
    }, fieldDefs);
}

// Log the page state when 0 results to assist selector debugging
async function logPageDiagnostics(page, url, listSelector) {
    try {
        const title    = await page.title().catch(() => '?');
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '').catch(() => '');
        console.warn(`[pipeline:html] 0 results on "${title}" — selector: ${listSelector}`);
        console.warn(`[pipeline:html] url: ${url}`);
        console.warn(`[pipeline:html] body sample: ${bodyText.replace(/\s+/g, ' ').slice(0, 300)}`);
        if (process.env.PIPELINE_DEBUG) {
            const html = await page.content().catch(() => '');
            console.warn(`[pipeline:html] HTML (first 3000):\n${html.slice(0, 3000)}`);
        }
    } catch { /* non-fatal */ }
}

class HtmlScrapeStep {
    constructor(manifest, params) {
        this.manifest = manifest;
        this.params   = params;
    }

    async *pages() {
        const { manifest, params } = this;
        const s          = manifest.search;
        const maxPages   = s.maxPages || 5;
        const delay      = manifest.rateLimit?.delayMs || 3000;
        // Manifest can declare a stable sentinel selector to wait for (vs. the data selector)
        const waitForSel = s.waitForSelector || null;
        let   collected  = 0;

        const browser = await chromium.launch({ headless: true });
        try {
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
            });
            const page = await context.newPage();

            for (let p = s.startPage || 1; p <= s.startPage - 1 + maxPages; p++) {
                const url = (s.urlTemplate || '')
                    .replace(/{{query}}/g,    encodeURIComponent(params.query || ''))
                    .replace(/{{location}}/g, encodeURIComponent(params.location || ''))
                    .replace(/{{page}}/g,     String(p));

                try {
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                } catch (e) {
                    console.warn('[pipeline:html] goto failed', url, e.message);
                    break;
                }

                // Phase 1: wait for networkidle so JS-rendered content can mount
                try {
                    await page.waitForLoadState('networkidle', { timeout: 10000 });
                } catch {
                    // networkidle timed out (heavy pages); continue with what we have
                    await page.waitForTimeout(2000);
                }

                // Phase 2: wait for the sentinel selector (explicit) or the data selector itself
                const targetSel = waitForSel || manifest.extract.listSelector;
                // Use a simple heuristic selector when the list selector is complex (commas → use first fragment)
                const simpleSel = targetSel.split(',')[0].trim();
                try {
                    await page.waitForSelector(simpleSel, { timeout: 8000 });
                } catch {
                    // Selector never appeared; diagnostics after extraction attempt
                }

                let raw;
                try {
                    raw = await extractFromPage(page, manifest.extract.listSelector, manifest.extract.fields);
                } catch (e) {
                    console.warn('[pipeline:html] extract failed', e.message);
                    break;
                }

                if (!raw || raw.length === 0) {
                    await logPageDiagnostics(page, url, manifest.extract.listSelector);
                    break;
                }

                const batch = raw.map(item => {
                    const out = {};
                    for (const [key, def] of Object.entries(manifest.extract.fields)) {
                        let val = item[key];
                        if (def.transform && TRANSFORMS[def.transform]) {
                            val = TRANSFORMS[def.transform](val);
                        }
                        out[key] = val;
                    }
                    return out;
                });

                yield batch;
                collected += batch.length;
                if (params.maxResults && collected >= params.maxResults) break;

                await page.waitForTimeout(delay + Math.random() * 1000);
            }
        } finally {
            await browser.close().catch(() => {});
        }
    }
}

module.exports = { HtmlScrapeStep };
