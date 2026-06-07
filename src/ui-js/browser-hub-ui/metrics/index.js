'use strict';

// ── In-process metrics collector ────────────────────────────────────────────
// Lightweight, zero-dependency observability for the Browser Automation server.
// All state lives in memory — restarts clear the counters (by design; this is
// a development/single-node deployment, not a distributed system).
//
// Tracks:
//   • Job counters per type (scraper, slides, tts, studio)
//   • Success / error / retry counts
//   • Per-run duration and error log
//   • Real-time event log (last N entries, streamed via Socket.io)

const os = require('os');

// ── Run log — circular buffer of last 500 events ───────────────────────────
const RUN_LOG_MAX = 500;
const _runLog = [];

function _push(entry) {
    _runLog.push({ ...entry, at: new Date().toISOString() });
    if (_runLog.length > RUN_LOG_MAX) _runLog.shift();
    // Notify listeners (set externally by server.js so metrics doesn't depend on io)
    if (_push._emit) _push._emit(entry);
}

// ── Counters ────────────────────────────────────────────────────────────────
const _counts = {
    scraper: { started: 0, done: 0, error: 0, retries: 0 },
    slides:  { started: 0, done: 0, error: 0, retries: 0 },
    tts:     { started: 0, done: 0, error: 0, retries: 0 },
    studio:  { started: 0, done: 0, error: 0, retries: 0 },
};

// Jobs in-flight
const _active = { scraper: 0, slides: 0, tts: 0, studio: 0 };

// Durations (ms) — circular buffer of last 100 per type
const _durations = { scraper: [], slides: [], tts: [], studio: [] };
const DUR_MAX = 100;

function _pushDuration(type, ms) {
    const arr = _durations[type];
    arr.push(ms);
    if (arr.length > DUR_MAX) arr.shift();
}

function _avg(arr) {
    if (!arr.length) return null;
    return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
}

// ── Process start time ──────────────────────────────────────────────────────
const _startedAt = Date.now();

// ── Public API ──────────────────────────────────────────────────────────────

const jobStart = (type, meta = {}) => {
    if (_counts[type]) { _counts[type].started++; _active[type] = (_active[type] || 0) + 1; }
    _push({ type: 'job.start', jobType: type, ...meta });
    return Date.now();
};

const jobDone = (type, startedAt, meta = {}) => {
    if (_counts[type]) { _counts[type].done++; _active[type] = Math.max(0, (_active[type] || 0) - 1); }
    const ms = Date.now() - startedAt;
    _pushDuration(type, ms);
    _push({ type: 'job.done', jobType: type, durationMs: ms, ...meta });
};

const jobError = (type, startedAt, error, meta = {}) => {
    if (_counts[type]) { _counts[type].error++; _active[type] = Math.max(0, (_active[type] || 0) - 1); }
    const ms = startedAt ? Date.now() - startedAt : null;
    if (ms !== null) _pushDuration(type, ms);
    _push({ type: 'job.error', jobType: type, error, durationMs: ms, ...meta });
};

const jobRetry = (type, meta = {}) => {
    if (_counts[type]) _counts[type].retries++;
    _push({ type: 'job.retry', jobType: type, ...meta });
};

const logEvent = (message, level = 'info', meta = {}) => {
    _push({ type: 'log', level, message, ...meta });
};

/**
 * Full metrics snapshot for the dashboard.
 */
function snapshot() {
    const mem = process.memoryUsage();
    const sys = {
        uptimeSeconds: Math.floor((Date.now() - _startedAt) / 1000),
        nodeUptimeSeconds: Math.floor(process.uptime()),
        heapUsedMB:  +(mem.heapUsed  / 1e6).toFixed(1),
        heapTotalMB: +(mem.heapTotal / 1e6).toFixed(1),
        rssMB:       +(mem.rss       / 1e6).toFixed(1),
        systemMemFreeGB:  +(os.freemem()  / 1e9).toFixed(1),
        systemMemTotalGB: +(os.totalmem() / 1e9).toFixed(1),
        cpuCores: os.cpus().length,
    };

    const jobs = {};
    for (const [type, c] of Object.entries(_counts)) {
        jobs[type] = {
            ...c,
            active:      _active[type] || 0,
            successRate: c.done + c.error > 0
                ? +(c.done / (c.done + c.error) * 100).toFixed(1)
                : null,
            avgDurationMs: _avg(_durations[type]),
        };
    }

    return { sys, jobs, startedAt: new Date(_startedAt).toISOString() };
}

/**
 * Recent log entries, newest first.
 * @param {number} limit  Max entries to return (default 100)
 * @param {string} [type] Filter by entry type (optional)
 */
function recentLog(limit = 100, type = null) {
    let log = [..._runLog].reverse();
    if (type) log = log.filter(e => e.type === type || e.jobType === type);
    return log.slice(0, limit);
}

/**
 * Register the Socket.io emit function so metrics pushes events in real time.
 * Called once from server.js after io is initialised.
 * @param {function} emitFn  (entry) => void
 */
function setEmitter(emitFn) { _push._emit = emitFn; }

module.exports = { jobStart, jobDone, jobError, jobRetry, logEvent, snapshot, recentLog, setEmitter };
