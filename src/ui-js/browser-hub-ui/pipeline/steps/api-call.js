'use strict';

const fs   = require('fs');
const path = require('path');

function getPath(obj, dotPath) {
    return dotPath.split('.').reduce((o, k) => {
        if (o === null || o === undefined) return undefined;
        const idx = parseInt(k, 10);
        return Number.isNaN(idx) ? o[k] : o[idx];
    }, obj);
}

function resolveApiKey(manifest) {
    const envKey = manifest.auth?.envKey;
    if (!envKey) return null;
    if (process.env[envKey]) return process.env[envKey];
    try {
        const cfgPath = path.join(__dirname, '../../config/app.config.json');
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        return cfg.apiKeys?.[envKey] || null;
    } catch { return null; }
}

function buildUrl(manifest, page) {
    const s      = manifest.search;
    const url    = new URL(s.url);
    const offset = (page - 1) * (s.pageSize || 50);
    for (const [k, v] of Object.entries(s.params || {})) {
        url.searchParams.set(k, String(v));
    }
    if (s.offsetParam) url.searchParams.set(s.offsetParam, String(offset));
    return url.toString();
}

function extractFields(item, fieldDefs) {
    const out = {};
    for (const [key, dotPath] of Object.entries(fieldDefs)) {
        out[key] = getPath(item, dotPath);
    }
    return out;
}

class ApiCallStep {
    constructor(manifest, params) {
        this.manifest = manifest;
        this.params   = params;
    }

    async *pages() {
        const { manifest, params } = this;
        const apiKey = resolveApiKey(manifest);
        if (!apiKey) {
            console.warn(`[pipeline] No API key for ${manifest.id} (${manifest.auth?.envKey}) — skipping`);
            return;
        }

        const s        = manifest.search;
        const maxPages = Math.min(s.maxPages || 10, Math.ceil((params.maxResults || 200) / (s.pageSize || 50)));

        for (let page = s.startPage || 1; page <= s.startPage - 1 + maxPages; page++) {
            let url = buildUrl(manifest, page);
            url = url.replace(/{{query}}/g,    encodeURIComponent(params.query || ''))
                     .replace(/{{location}}/g, encodeURIComponent(params.location || ''));

            const headers = { 'Accept': 'application/json' };
            if (manifest.auth?.type === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`;

            let json;
            try {
                const res = await fetch(url, { headers });
                if (!res.ok) { console.warn(`[pipeline:yelp] HTTP ${res.status}`); break; }
                json = await res.json();
            } catch (e) {
                console.error('[pipeline:api] fetch error', e.message);
                break;
            }

            const items = s.responsePath ? getPath(json, s.responsePath) : json;
            if (!Array.isArray(items) || items.length === 0) break;

            const batch = items.map(item => extractFields(item, manifest.extract.fields));
            yield batch;

            const total = s.totalPath ? getPath(json, s.totalPath) : null;
            if (total !== null && page * (s.pageSize || 50) >= total) break;

            if (manifest.rateLimit?.delayMs) {
                await new Promise(r => setTimeout(r, manifest.rateLimit.delayMs));
            }
        }
    }
}

module.exports = { ApiCallStep };