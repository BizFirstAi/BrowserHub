'use strict';

// ── Stealth browser factory ─────────────────────────────────────────────────
// Wraps playwright-extra + puppeteer-extra-plugin-stealth to produce a
// chromium browser instance that passes common bot-detection checks:
//   • Canvas / WebGL fingerprint randomisation
//   • navigator.webdriver = false
//   • chrome runtime object present
//   • realistic plugin/mimeType arrays
//   • WebRTC IP leak suppression
//   • Consistent UA / platform / language across all browser signals
//
// Usage:
//   const { launchStealth, newStealthContext } = require('./browser/stealth');
//   const browser = await launchStealth();
//   const ctx     = await newStealthContext(browser, { proxy, fingerprint });

const { chromium: chromiumExtra } = require('playwright-extra');
const StealthPlugin               = require('puppeteer-extra-plugin-stealth');
const { pickFingerprint }         = require('./user-agents');

// Apply stealth plugin once at module load — safe to call multiple times
chromiumExtra.use(StealthPlugin());

// ── Launch args that reduce bot-detection surface ───────────────────────────
const STEALTH_ARGS = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',  // removes navigator.webdriver flag
    '--disable-infobars',
    '--window-size=1920,1080',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-features=TranslateUI',
    '--lang=en-US',
    // WebRTC: prevent real IP leaks through WebRTC when using proxies
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
];

// ── Canvas noise injection ──────────────────────────────────────────────────
// Applied via page.addInitScript — subtly shifts canvas pixel values by ±1 so
// each session has a unique fingerprint without visually altering screenshots.
const CANVAS_NOISE_SCRIPT = `
(function () {
    const origToDataURL     = HTMLCanvasElement.prototype.toDataURL;
    const origGetImageData  = CanvasRenderingContext2D.prototype.getImageData;
    const origToBlob        = HTMLCanvasElement.prototype.toBlob;

    function noise() { return (Math.random() * 2 - 1) * 0.5; }

    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
        const ctx = this.getContext('2d');
        if (ctx) {
            const imageData = origGetImageData.call(ctx, 0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
                imageData.data[i]     = Math.min(255, Math.max(0, imageData.data[i]     + noise()));
                imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + noise()));
                imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + noise()));
            }
            ctx.putImageData(imageData, 0, 0);
        }
        return origToDataURL.call(this, type, quality);
    };

    CanvasRenderingContext2D.prototype.getImageData = function (sx, sy, sw, sh) {
        const imageData = origGetImageData.call(this, sx, sy, sw, sh);
        for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i]     = Math.min(255, Math.max(0, imageData.data[i]     + noise()));
            imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + noise()));
            imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + noise()));
        }
        return imageData;
    };
})();
`;

// ── WebGL fingerprint spoof ─────────────────────────────────────────────────
// Reports a generic GPU vendor/renderer so WebGL-based fingerprinting fails.
const WEBGL_SPOOF_SCRIPT = `
(function () {
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParam.call(this, parameter);
    };
    const getParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParam2.call(this, parameter);
    };
})();
`;

// ── Launch ─────────────────────────────────────────────────────────────────

/**
 * Launch a stealth Chromium browser.
 * @param {object} [opts]
 * @param {boolean} [opts.headless=true]
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchStealth(opts = {}) {
    const { headless = true } = opts;
    return chromiumExtra.launch({
        headless,
        args: STEALTH_ARGS,
        ignoreDefaultArgs: ['--enable-automation'],
    });
}

// ── Context ────────────────────────────────────────────────────────────────

/**
 * Create a new browser context with a full stealth fingerprint.
 *
 * @param {import('playwright').Browser} browser
 * @param {object} [opts]
 * @param {object}  [opts.proxy]        { server, username, password } — Playwright proxy object
 * @param {string}  [opts.seed]         Domain seed for deterministic fingerprint
 * @param {object}  [opts.viewport]     Override viewport (skips fingerprint viewport)
 * @param {boolean} [opts.canvasNoise]  Inject canvas noise script (default true)
 * @param {boolean} [opts.webglSpoof]   Inject WebGL spoof script (default true)
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function newStealthContext(browser, opts = {}) {
    const {
        proxy,
        seed,
        viewport:   viewportOverride,
        canvasNoise = true,
        webglSpoof  = true,
    } = opts;

    const fp = pickFingerprint(seed);
    const viewport = viewportOverride || fp.viewport;

    const ctxOpts = {
        userAgent:          fp.ua,
        viewport,
        locale:             fp.locale,
        timezoneId:         fp.timezone,
        // Match HTTP headers to the UA (language)
        extraHTTPHeaders: {
            'Accept-Language': `${fp.locale},${fp.locale.split('-')[0]};q=0.9,en;q=0.8`,
        },
        // Suppress permission popups
        permissions: [],
        // Realistic color depth and device memory
        colorScheme: 'light',
        deviceScaleFactor: 1,
    };

    if (proxy) ctxOpts.proxy = proxy;

    const context = await browser.newContext(ctxOpts);

    // Override navigator properties that stealth plugin misses
    await context.addInitScript(`
        Object.defineProperty(navigator, 'platform',   { get: () => '${fp.platform}' });
        Object.defineProperty(navigator, 'vendor',     { get: () => '${fp.vendor}' });
        Object.defineProperty(navigator, 'languages',  { get: () => ['${fp.locale}', '${fp.locale.split('-')[0]}', 'en'] });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${[4,6,8,12,16][Math.floor(Math.random()*5)]} });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => ${[4,8,16][Math.floor(Math.random()*3)]} });
        // Remove traces of headless mode
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    `);

    if (canvasNoise) await context.addInitScript(CANVAS_NOISE_SCRIPT);
    if (webglSpoof)  await context.addInitScript(WEBGL_SPOOF_SCRIPT);

    return context;
}

module.exports = { launchStealth, newStealthContext, STEALTH_ARGS };
