const { chromium } = require('playwright');
const xml2js = require('xml2js');
const https = require('https');
const http = require('http');

const activeScans = new Map();

function sleep(ms, ctrl) {
    return new Promise(resolve => {
        const end = Date.now() + ms;
        const tick = setInterval(() => {
            if (ctrl.cancelled || ctrl.skipDelay || Date.now() >= end) {
                ctrl.skipDelay = false;
                clearInterval(tick);
                resolve();
            }
        }, 100);
    });
}

function fetchText(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('Too many redirects'));
        const lib = url.startsWith('https://') ? https : http;
        const req = lib.get(url, { timeout: 30000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const next = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).toString();
                return resolve(fetchText(next, redirects + 1));
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    });
}

async function extractUrlsFromSitemap(sitemapUrl) {
    const xml = await fetchText(sitemapUrl);
    const result = await new xml2js.Parser().parseStringPromise(xml);

    if (result.urlset?.url) {
        return result.urlset.url.map(u => u.loc?.[0]).filter(Boolean);
    }
    if (result.sitemapindex?.sitemap) {
        const all = [];
        for (const s of result.sitemapindex.sitemap) {
            try { all.push(...await extractUrlsFromSitemap(s.loc[0])); }
            catch (e) { console.warn(`Skipping sub-sitemap: ${e.message}`); }
        }
        return all;
    }
    return [];
}

async function evaluateRules(page, rules) {
    return page.evaluate((rules) => {
        function buildSelector(el) {
            if (el.id) return `#${el.id}`;
            const parts = [];
            let node = el;
            while (node && node.nodeType === 1) {
                let seg = node.tagName.toLowerCase();
                if (node.className && typeof node.className === 'string') {
                    const cls = node.className.trim().split(/\s+/).slice(0, 2).join('.');
                    if (cls) seg += '.' + cls;
                }
                parts.unshift(seg);
                node = node.parentElement;
            }
            return parts.join(' > ');
        }

        const findings = [];
        document.querySelectorAll('*').forEach(el => {
            const st = window.getComputedStyle(el);
            if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return;

            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;

            for (const rule of rules) {
                if (!rule.enabled) continue;
                const cfg = rule.config;

                if (rule.type === 'background-color') {
                    if (area < cfg.minArea) continue;
                    const m = st.backgroundColor.match(/\d+/g);
                    if (!m || m.length < 3) continue;
                    const [r, g, b] = m.map(Number);
                    const minOk = r >= cfg.minR && g >= cfg.minG && b >= cfg.minB;
                    const maxOk = cfg.maxR === undefined || (r <= cfg.maxR && g <= cfg.maxG && b <= cfg.maxB);
                    if (minOk && maxOk) {
                        findings.push({
                            ruleId: rule.id, ruleName: rule.name,
                            severity: rule.severity, label: cfg.label,
                            selector: buildSelector(el),
                            backgroundColor: st.backgroundColor,
                            detail: '', r, g, b,
                            width: Math.round(rect.width), height: Math.round(rect.height),
                            area: Math.round(area)
                        });
                        break;
                    }

                } else if (rule.type === 'custom-js') {
                    try {
                        if (area < (cfg.minArea || 0)) continue;
                        // script runs in page context — new Function is intentional here
                        const fn = new Function('el', 'st', 'rect', 'area', cfg.script); // eslint-disable-line no-new-func
                        const result = fn(el, st, rect, area);
                        if (result) {
                            const m = st.backgroundColor.match(/\d+/g);
                            const [r, g, b] = m ? m.map(Number) : [128, 128, 128];
                            findings.push({
                                ruleId: rule.id, ruleName: rule.name,
                                severity: rule.severity, label: cfg.label || rule.name,
                                selector: buildSelector(el),
                                backgroundColor: st.backgroundColor,
                                detail: typeof result === 'string' ? result : (result.detail || ''),
                                r, g, b,
                                width: Math.round(rect.width), height: Math.round(rect.height),
                                area: Math.round(area)
                            });
                            break;
                        }
                    } catch { /* script errors silently skipped per element */ }
                }
            }
        });
        return findings;
    }, rules);
}

async function runScan(scan, rules, settings, io, onUpdate) {
    const ctrl = { cancelled: false, browser: null, skipDelay: false };
    activeScans.set(scan.id, ctrl);

    const emit = (ev, data) => io.to(`scan:${scan.id}`).emit(ev, data);

    scan.status = 'running';
    onUpdate(scan);
    emit('scan:status', { status: 'running' });

    try {
        let urls = [];
        if (scan.type === 'sitemap') {
            try {
                urls = await extractUrlsFromSitemap(scan.input.trim());
            } catch (err) {
                scan.status = 'error';
                scan.errors.push({ message: `Sitemap error: ${err.message}` });
                scan.completedAt = new Date().toISOString();
                onUpdate(scan);
                emit('scan:error', { message: err.message });
                return;
            }
        } else {
            urls = scan.input.split('\n').map(u => u.trim()).filter(u => /^https?:\/\//.test(u));
        }

        if (!urls.length) {
            scan.status = 'error';
            scan.errors.push({ message: 'No valid URLs found' });
            scan.completedAt = new Date().toISOString();
            onUpdate(scan);
            emit('scan:error', { message: 'No valid URLs found' });
            return;
        }

        scan.stats.total = urls.length;
        onUpdate(scan);
        emit('scan:urls', { total: urls.length });

        const browser = await chromium.launch({ headless: settings?.headless !== false });
        ctrl.browser = browser;
        browser.on('disconnected', () => { ctrl.skipDelay = true; });

        for (let i = 0; i < urls.length; i++) {
            if (ctrl.cancelled) break;
            const url = urls[i];

            emit('scan:progress', {
                current: i + 1, total: urls.length, url,
                percent: Math.round(((i + 1) / urls.length) * 100)
            });

            const page = await browser.newPage();
            let pageOk = false;
            try {
                await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
                const found = await evaluateRules(page, rules);
                for (const f of found) {
                    const record = { ...f, url, size: `${f.width}x${f.height}` };
                    scan.findings.push(record);
                    scan.stats.findings++;
                    emit('scan:finding', record);
                }
                scan.stats.scanned++;
                pageOk = true;
            } catch (err) {
                if (ctrl.cancelled) break;
                const e = { url, message: err.message };
                scan.errors.push(e);
                scan.stats.errors++;
                emit('scan:page-error', e);
            }

            if (pageOk && !ctrl.cancelled && settings?.pageDelay > 0) {
                await sleep(settings.pageDelay, ctrl);
            }

            try { await page.close(); } catch {}
            onUpdate(scan);
        }

        try { await browser.close(); } catch {}
        ctrl.browser = null;
        scan.status = ctrl.cancelled ? 'cancelled' : 'complete';
    } catch (err) {
        scan.status = 'error';
        scan.errors.push({ message: err.message });
    }

    scan.completedAt = new Date().toISOString();
    onUpdate(scan);
    emit('scan:complete', { status: scan.status, stats: scan.stats });
    activeScans.delete(scan.id);
}

function cancelScan(scanId) {
    const ctrl = activeScans.get(scanId);
    if (!ctrl) return;
    ctrl.cancelled = true;
    if (ctrl.browser) ctrl.browser.close().catch(() => {});
}

module.exports = { runScan, cancelScan };
