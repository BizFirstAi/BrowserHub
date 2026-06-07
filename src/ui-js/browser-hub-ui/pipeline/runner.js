'use strict';

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { HtmlScrapeStep } = require('./steps/html-scrape');
const { ApiCallStep }    = require('./steps/api-call');
const { normalize }      = require('./steps/normalize');
const { dedupe }         = require('./steps/dedupe');

const SOURCES_DIR = path.join(__dirname, 'sources');
const STEP_MAP    = { html: HtmlScrapeStep, api: ApiCallStep };

function getSources() {
    try {
        return fs.readdirSync(SOURCES_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                try { return JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, f), 'utf8')); }
                catch { return null; }
            })
            .filter(Boolean);
    } catch { return []; }
}

function getSource(id) {
    return getSources().find(s => s.id === id) || null;
}

function saveSource(manifest) {
    if (!manifest || !manifest.id) throw new Error('manifest.id required');
    if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true });
    fs.writeFileSync(path.join(SOURCES_DIR, `${manifest.id}.json`), JSON.stringify(manifest, null, 2));
}

function deleteSource(id) {
    const p = path.join(SOURCES_DIR, `${id}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
}

class PipelineRunner {
    static getSources() { return getSources(); }
    static getSource(id) { return getSource(id); }
    static saveSource(m) { return saveSource(m); }
    static deleteSource(id) { return deleteSource(id); }

    constructor(sourceId, params, opts = {}) {
        this.sourceId   = sourceId;
        this.params     = { maxResults: 100, ...params };
        this.onProgress = opts.onProgress || (() => {});
    }

    async run() {
        const manifest = getSource(this.sourceId);
        if (!manifest) throw new Error(`Source not found: ${this.sourceId}`);

        const StepClass = STEP_MAP[manifest.type];
        if (!StepClass) throw new Error(`Unknown step type: ${manifest.type}`);

        const runId = uuidv4();
        const start = Date.now();
        const raw   = [];

        const step = new StepClass(manifest, this.params);
        try {
            for await (const batch of step.pages()) {
                raw.push(...batch);
                this.onProgress({ fetched: raw.length, source: this.sourceId, runId });
                if (this.params.maxResults && raw.length >= this.params.maxResults) break;
            }
        } catch (e) {
            console.error('[pipeline:runner] step error', e.message);
        }

        const normalized = normalize(raw, manifest.outputMap, this.sourceId);
        normalized.forEach(r => { r.meta.runId = runId; });
        const deduped = dedupe(normalized);

        return {
            runId,
            source:     this.sourceId,
            query:      this.params.query,
            location:   this.params.location,
            rawFetched: raw.length,
            total:      deduped.length,
            durationMs: Date.now() - start,
            records:    deduped,
        };
    }
}

module.exports = { PipelineRunner, getSources, getSource, saveSource, deleteSource };