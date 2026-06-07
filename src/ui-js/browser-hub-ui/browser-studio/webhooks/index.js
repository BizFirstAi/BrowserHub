'use strict';

// ── Webhook dispatcher ──────────────────────────────────────────────────────
// Fires HTTP callbacks on scraper/slides/tts/studio job events.
// Config stored in app.config.json under the "webhooks" array.

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'app.config.json');

const EVENTS = {
    SCRAPER_DONE:       'scraper.done',
    SCRAPER_ERROR:      'scraper.error',
    SLIDES_DONE:        'slides.done',
    SLIDES_ERROR:       'slides.error',
    TTS_DONE:           'tts.done',
    TTS_ERROR:          'tts.error',
    TTS_VIDEO_DONE:     'tts.video.done',
    TTS_VIDEO_ERROR:    'tts.video.error',
    STUDIO_VIDEO_DONE:  'studio.video.done',
    STUDIO_VIDEO_ERROR: 'studio.video.error',
};

function readWebhooks() {
    try {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return Array.isArray(raw.webhooks) ? raw.webhooks : [];
    } catch { return []; }
}

function writeWebhooks(list) {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
    cfg.webhooks = list;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function sign(payload, secret) {
    if (!secret) return null;
    return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function deliver(webhookUrl, body, headers, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const u   = new URL(webhookUrl);
        const buf = Buffer.from(body, 'utf8');
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.request({
            hostname: u.hostname,
            port:     u.port || (u.protocol === 'https:' ? 443 : 80),
            path:     u.pathname + u.search,
            method:   'POST',
            headers:  { 'Content-Type': 'application/json', 'Content-Length': buf.length,
                        'User-Agent': 'BizFirstStudio-Webhook/1.0', ...headers },
            timeout: timeoutMs,
        }, res => {
            res.resume();
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.statusCode);
            else reject(new Error(`HTTP ${res.statusCode}`));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        req.write(buf);
        req.end();
    });
}

async function deliverWithRetry(webhook, eventName, payload) {
    const body = JSON.stringify({ event: eventName, ...payload, deliveredAt: new Date().toISOString() });
    const sig  = sign(body, webhook.secret);
    const hdrs = { 'X-Webhook-Event': eventName, 'X-Webhook-Id': webhook.id,
                   ...(sig ? { 'X-Webhook-Signature': sig } : {}) };
    for (let i = 0; i < 3; i++) {
        try { await deliver(webhook.url, body, hdrs); return { success: true, attempt: i + 1 }; }
        catch (err) {
            if (i < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
            else return { success: false, error: err.message, attempt: 3 };
        }
    }
}

async function fire(eventName, payload) {
    const webhooks = readWebhooks().filter(w =>
        w.enabled !== false && w.url &&
        Array.isArray(w.events) && w.events.includes(eventName)
    );
    if (!webhooks.length) return [];
    return Promise.all(webhooks.map(w => deliverWithRetry(w, eventName, payload)));
}

function listWebhooks()           { return readWebhooks(); }
function getWebhook(id)           { return readWebhooks().find(w => w.id === id) || null; }
function addWebhook(data)         {
    const list = readWebhooks();
    const entry = { id: Date.now().toString(36), enabled: true, ...data };
    list.push(entry); writeWebhooks(list); return entry;
}
function updateWebhook(id, patch) {
    const list = readWebhooks();
    const idx  = list.findIndex(w => w.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], ...patch }; writeWebhooks(list); return list[idx];
}
function deleteWebhook(id)        { writeWebhooks(readWebhooks().filter(w => w.id !== id)); }
async function testWebhook(id) {
    const wh = getWebhook(id);
    if (!wh) return { success: false, error: 'Webhook not found' };
    return deliverWithRetry(wh, 'webhook.test', { message: 'Test delivery from BizFirst Studio' });
}

module.exports = { fire, EVENTS, listWebhooks, getWebhook, addWebhook, updateWebhook, deleteWebhook, testWebhook };
