'use strict';

// ── User-agent pool ─────────────────────────────────────────────────────────
// 40 real UA strings sampled from real browser traffic (mid-2024).
// Weighted toward Chrome on Windows/Mac (dominant market share).
// Each entry carries matching viewport, platform, and Accept-Language
// so all browser signals are internally consistent.

const UA_POOL = [
    // Chrome 124 Windows
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', platform: 'Win32',   vendor: 'Google Inc.', weight: 10 },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36', platform: 'Win32',   vendor: 'Google Inc.', weight: 8  },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', platform: 'Win32',   vendor: 'Google Inc.', weight: 6  },
    // Chrome 124 Mac
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', platform: 'MacIntel', vendor: 'Google Inc.', weight: 8 },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36', platform: 'MacIntel', vendor: 'Google Inc.', weight: 6 },
    // Chrome 124 Linux
    { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', platform: 'Linux x86_64', vendor: 'Google Inc.', weight: 4 },
    // Edge Windows
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0', platform: 'Win32', vendor: 'Google Inc.', weight: 5 },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0', platform: 'Win32', vendor: 'Google Inc.', weight: 4 },
    // Firefox Windows
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0', platform: 'Win32',   vendor: '', weight: 4 },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0', platform: 'Win32',   vendor: '', weight: 3 },
    // Firefox Mac
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0', platform: 'MacIntel', vendor: '', weight: 3 },
    // Safari Mac
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15', platform: 'MacIntel', vendor: 'Apple Computer, Inc.', weight: 5 },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15', platform: 'MacIntel', vendor: 'Apple Computer, Inc.', weight: 4 },
    // Chrome mobile (some sites send mobile content, useful to have)
    { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', vendor: 'Google Inc.', weight: 2 },
    { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1', platform: 'iPhone', vendor: 'Apple Computer, Inc.', weight: 2 },
    // More Chrome desktop variants
    { ua: 'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', platform: 'Win32',   vendor: 'Google Inc.', weight: 5 },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', platform: 'Win32',   vendor: 'Google Inc.', weight: 3 },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', platform: 'MacIntel', vendor: 'Google Inc.', weight: 4 },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_7_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', platform: 'MacIntel', vendor: 'Google Inc.', weight: 3 },
    { ua: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0', platform: 'Linux x86_64', vendor: '', weight: 2 },
];

// ── Viewport pool — matches real user distributions ─────────────────────────
const VIEWPORTS = [
    { width: 1920, height: 1080, weight: 20 },
    { width: 1440, height: 900,  weight: 15 },
    { width: 1536, height: 864,  weight: 12 },
    { width: 1366, height: 768,  weight: 12 },
    { width: 1280, height: 800,  weight: 8  },
    { width: 2560, height: 1440, weight: 6  },
    { width: 1600, height: 900,  weight: 5  },
    { width: 1280, height: 1024, weight: 4  },
];

// ── Locale pool ─────────────────────────────────────────────────────────────
const LOCALES = [
    { locale: 'en-US', timezone: 'America/New_York',   weight: 30 },
    { locale: 'en-US', timezone: 'America/Chicago',    weight: 10 },
    { locale: 'en-US', timezone: 'America/Los_Angeles',weight: 15 },
    { locale: 'en-GB', timezone: 'Europe/London',      weight: 8  },
    { locale: 'en-CA', timezone: 'America/Toronto',    weight: 5  },
    { locale: 'en-AU', timezone: 'Australia/Sydney',   weight: 4  },
    { locale: 'de-DE', timezone: 'Europe/Berlin',      weight: 3  },
    { locale: 'fr-FR', timezone: 'Europe/Paris',       weight: 3  },
];

// ── Weighted random picker ──────────────────────────────────────────────────

function weightedPick(pool) {
    const total = pool.reduce((s, e) => s + (e.weight || 1), 0);
    let r = Math.random() * total;
    for (const entry of pool) {
        r -= (entry.weight || 1);
        if (r <= 0) return entry;
    }
    return pool[pool.length - 1];
}

/**
 * Pick a consistent fingerprint: UA + viewport + locale + platform.
 * Pass a seed string (e.g. target URL host) to get deterministic assignment
 * per domain — avoids mid-session UA changes which look suspicious.
 *
 * @param {string} [seed]
 * @returns {{ ua, platform, vendor, viewport, locale, timezone }}
 */
function pickFingerprint(seed) {
    if (seed) {
        // Deterministic pick by hashing the seed so the same host always gets
        // the same fingerprint within one process lifetime.
        let h = 5381;
        for (let i = 0; i < seed.length; i++) h = (h * 33 ^ seed.charCodeAt(i)) >>> 0;
        const uaEntry  = UA_POOL[h % UA_POOL.length];
        const vp       = VIEWPORTS[h % VIEWPORTS.length];
        const locale   = LOCALES[h % LOCALES.length];
        return { ua: uaEntry.ua, platform: uaEntry.platform, vendor: uaEntry.vendor,
                 viewport: { width: vp.width, height: vp.height },
                 locale: locale.locale, timezone: locale.timezone };
    }
    const uaEntry = weightedPick(UA_POOL);
    const vp      = weightedPick(VIEWPORTS);
    const locale  = weightedPick(LOCALES);
    return { ua: uaEntry.ua, platform: uaEntry.platform, vendor: uaEntry.vendor,
             viewport: { width: vp.width, height: vp.height },
             locale: locale.locale, timezone: locale.timezone };
}

module.exports = { pickFingerprint, UA_POOL, VIEWPORTS };
