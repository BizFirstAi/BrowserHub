const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { runScan, cancelScan } = require('./browser-studio/scanner');
const { convertUrl, imagesToPdf, recordPresentation } = require('./video-studio/html-to-slides/url-convert');
const { buildZip }                = require('./video-studio/html-to-slides/zip-writer');
const { scrapeUrls, toCSV, toMarkdown } = require('./browser-studio/scraper/page-scraper');
const { execFile, execFileSync }  = require('child_process');
const os                          = require('os');
const auth                        = require('./auth');
const pm                          = require('./video-studio/studio/project-manager');
const videoStudio                 = require('./video-studio/studio/video-studio');
const webhooks                    = require('./browser-studio/webhooks');
const metrics                     = require('./metrics');
const { parseProxy }              = require('./browser-studio/scraper/page-scraper');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Wire metrics emitter so every job event streams to the observability room
metrics.setEmitter(entry => io.to('metrics').emit('metrics-event', entry));
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STORE = path.join(DATA_DIR, 'store.json');
const CONFIG_PATH = path.join(__dirname, 'config', 'app.config.json');
const UPLOADS_DIR = path.join(__dirname, 'assets', 'uploads');

if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });

// ── App config (branding, ads, rate limits) ───────────────────────────────────

const DEFAULT_CONFIG = {
    appTitle:          'Browser Automation',
    logoUrl:           '',
    adminKey:          'change-me-in-production',
    jwtSecret:         'change-me-in-production-set-jwtSecret-in-config',
    googleClientId:    '',
    googleClientSecret:'',
    googleRedirectUri: 'http://localhost:3000/api/auth/google/callback',
    ads:               [],
    rateLimits: {
        maxUrlsPerJob:    500,    // maximum URLs in a single job
        maxFileSizeMB:    10,     // maximum upload file size (MB)
        maxConcurrency:   16,     // maximum browser pool size
        maxJobsPerHour:   100,    // simple in-process request counter
        scrapeTimeoutMs:  60000,  // max page load timeout for scraper
    },
};

function readAppConfig() {
    try {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        // Deep-merge rateLimits so partial config files still work
        raw.rateLimits = { ...DEFAULT_CONFIG.rateLimits, ...(raw.rateLimits || {}) };
        return raw;
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

function writeAppConfig(cfg) {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// Ensure config file exists
if (!fs.existsSync(CONFIG_PATH)) writeAppConfig(DEFAULT_CONFIG);

// ── Simple hourly rate limiter ────────────────────────────────────────────────
const _jobCounts = new Map(); // IP → { count, windowStart }
function checkJobRateLimit(ip) {
    const cfg  = readAppConfig();
    const max  = cfg.rateLimits?.maxJobsPerHour ?? 100;
    const now  = Date.now();
    const hour = 3600_000;
    const rec  = _jobCounts.get(ip) || { count: 0, windowStart: now };
    if (now - rec.windowStart > hour) { rec.count = 0; rec.windowStart = now; }
    rec.count++;
    _jobCounts.set(ip, rec);
    return rec.count <= max;
}

// ── Multer setup for admin uploads ────────────────────────────────────────────
const _multerStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename:    (_req, file, cb) => {
        const ext  = path.extname(file.originalname).toLowerCase() || '.png';
        const safe = file.fieldname.replace(/[^a-z0-9-]/gi, '_');
        cb(null, `${safe}-${Date.now()}${ext}`);
    },
});
function multerUpload(req, res, next) {
    const cfg     = readAppConfig();
    const maxMB   = cfg.rateLimits?.maxFileSizeMB ?? 10;
    const upload  = multer({
        storage:  _multerStorage,
        limits:   { fileSize: maxMB * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            const allowed = /\.(png|jpg|jpeg|webp|svg|gif)$/i;
            cb(null, allowed.test(file.originalname));
        },
    }).single('file');
    upload(req, res, next);
}

function defaultRules() {
    return [
        {
            id: 'white-bg',
            name: 'Large White Background',
            description: 'Elements with white/near-white backgrounds (RGB ≥ 240) larger than 50,000 px²',
            enabled: true,
            severity: 'high',
            type: 'background-color',
            config: { minR: 240, minG: 240, minB: 240, minArea: 50000, label: 'White Background' }
        },
        {
            id: 'light-bg',
            name: 'Light Gray Background',
            description: 'Elements with light gray backgrounds (RGB 200–239) larger than 50,000 px²',
            enabled: true,
            severity: 'medium',
            type: 'background-color',
            config: { minR: 200, minG: 200, minB: 200, maxR: 239, maxG: 239, maxB: 239, minArea: 50000, label: 'Light Background' }
        }
    ];
}

function defaultSettings() {
    return { headless: true, pageDelay: 0 };
}

function readStore() {
    try {
        const data = JSON.parse(fs.readFileSync(STORE, 'utf8'));
        data.settings = { ...defaultSettings(), ...(data.settings || {}) };
        return data;
    } catch { return { scans: [], rules: defaultRules(), settings: defaultSettings() }; }
}

function writeStore(data) {
    fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

if (!fs.existsSync(STORE)) writeStore({ scans: [], rules: defaultRules() });

// ── Slides jobs — in-memory store (ephemeral, not persisted) ─────────────────
const slidesJobs = new Map();

// ── ffmpeg availability ───────────────────────────────────────────────────────
function ffmpegAvailable() {
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' }); return true; }
    catch { return false; }
}

/**
 * Generate an MP4 slideshow from an array of {filename, buffer} images.
 * Saves images to a temp dir, runs ffmpeg, returns the video Buffer.
 * @param {Array<{filename,buffer}>} images
 * @param {object} opts  { duration: seconds per slide, fps: output fps }
 */
async function generateVideo(images, opts = {}) {
    const { duration = 3, fps = 30 } = opts;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-vid-'));
    try {
        // Write PNG frames (ffmpeg needs files on disk)
        const pngBuffers = [];
        for (let i = 0; i < images.length; i++) {
            const fname = `frame-${String(i + 1).padStart(4, '0')}.png`;
            // ffmpeg always needs png for image2 pipe; convert if needed
            // For simplicity we reuse existing buffer (Playwright png by default)
            fs.writeFileSync(path.join(tmpDir, fname), images[i].buffer);
            pngBuffers.push(fname);
        }

        // concat demuxer file — each image shown for <duration> seconds
        const concatLines = pngBuffers.map(f => `file '${f}'\nduration ${duration}`);
        // ffmpeg concat needs the last file listed again without duration
        concatLines.push(`file '${pngBuffers[pngBuffers.length - 1]}'`);
        const concatPath = path.join(tmpDir, 'concat.txt');
        fs.writeFileSync(concatPath, concatLines.join('\n'));

        const outPath = path.join(tmpDir, 'slideshow.mp4');

        await new Promise((resolve, reject) => {
            execFile('ffmpeg', [
                '-f', 'concat',
                '-safe', '0',
                '-i', concatPath,
                '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
                '-c:v', 'libx264',
                '-r', String(fps),
                '-movflags', '+faststart',
                '-y',
                outPath,
            ], { cwd: tmpDir }, (err, _stdout, stderr) => {
                if (err) reject(new Error('ffmpeg: ' + (stderr || err.message)));
                else resolve();
            });
        });

        const videoBuffer = fs.readFileSync(outPath);
        return videoBuffer;

    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/scans', (_req, res) => {
    const { scans } = readStore();
    res.json(scans.map(s => ({
        id: s.id, type: s.type, status: s.status,
        startedAt: s.startedAt, completedAt: s.completedAt, stats: s.stats,
        inputPreview: s.input.substring(0, 80)
    })).reverse());
});

app.get('/api/scans/:id', (req, res) => {
    const { scans } = readStore();
    const scan = scans.find(s => s.id === req.params.id);
    if (!scan) return res.status(404).json({ error: 'Not found' });
    res.json(scan);
});

app.post('/api/scans', (req, res) => {
    const { type, input } = req.body;
    if (!type || !input) return res.status(400).json({ error: 'type and input required' });

    const store = readStore();
    const scan = {
        id: uuidv4(), type, input,
        status: 'queued',
        startedAt: new Date().toISOString(),
        completedAt: null,
        stats: { total: 0, scanned: 0, findings: 0, errors: 0 },
        findings: [], errors: []
    };
    store.scans.push(scan);
    writeStore(store);
    res.json({ id: scan.id });

    runScan(scan, store.rules, store.settings, io, (updated) => {
        const s = readStore();
        const idx = s.scans.findIndex(x => x.id === updated.id);
        if (idx >= 0) { s.scans[idx] = updated; writeStore(s); }
    });
});

app.post('/api/scans/:id/cancel', (req, res) => {
    cancelScan(req.params.id);
    res.json({ success: true });
});

app.delete('/api/scans/:id', (req, res) => {
    const store = readStore();
    const idx = store.scans.findIndex(s => s.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });
    store.scans.splice(idx, 1);
    writeStore(store);
    res.json({ success: true });
});

app.get('/api/settings', (_req, res) => {
    const { settings } = readStore();
    res.json(settings);
});

app.put('/api/settings', (req, res) => {
    const store = readStore();
    store.settings = { ...store.settings, ...req.body };
    writeStore(store);
    res.json(store.settings);
});

app.get('/api/slides/ffmpeg', (_req, res) => {
    res.json({ available: ffmpegAvailable() });
});

app.get('/api/rules', (_req, res) => {
    const { rules } = readStore();
    res.json(rules);
});

app.put('/api/rules', requireAdminKey, (req, res) => {
    const store = readStore();
    store.rules = req.body;
    writeStore(store);
    res.json({ success: true });
});

io.on('connection', (socket) => {
    socket.on('join:scan',      (id) => socket.join(`scan:${id}`));
    socket.on('join:slides',    (id) => socket.join(`slides:${id}`));
    socket.on('join:scraper',   (id) => socket.join(`scraper:${id}`));
    socket.on('join:tts',       (id) => socket.join(`tts:${id}`));
    socket.on('join:studio',    ({ userId, projectId }) => socket.join(`studio:${userId}:${projectId}`));
    socket.on('join:metrics',   () => socket.join('metrics'));
    socket.on('join:pipeline',  (runId) => socket.join(`pipeline-${runId}`));
});

// ── Slides API ────────────────────────────────────────────────────────────────

// Extract a clean folder name from a URL or file:/// path
function folderNameFromUrl(url) {
    let name = url;
    // file:/// → strip prefix and use the filename
    if (url.startsWith('file:///')) {
        name = decodeURIComponent(url.slice(8)).replace(/\\/g, '/');
    }
    // grab last path segment, strip query/hash
    name = name.split('/').pop().split('?')[0].split('#')[0];
    // strip extension
    name = name.replace(/\.[^.]+$/, '');
    // sanitize: keep letters, digits, hyphens, underscores, dots
    name = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
    return name || 'slides';
}

// POST /api/slides/jobs — start a conversion job
app.post('/api/slides/jobs', (req, res) => {
    const {
        urls,
        autoDetect       = true,
        fullPageFallback = true,
        width            = 1920,
        height           = 1080,
        outputFolder     = null,
        format           = 'png',
        quality          = 92,
        generatePdf      = false,
        generateVideo    = false,
        videoDuration    = 3,
        videoFps         = 30,
        videoMode        = 'frames',   // 'frames' | 'live'
        saveImages       = true,       // false = capture only for video/pdf, hide from gallery
    } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'urls array required' });
    }

    const appCfg = readAppConfig();
    const rl     = appCfg.rateLimits || {};
    if (urls.length > (rl.maxUrlsPerJob ?? 500)) {
        return res.status(400).json({ error: `Too many URLs. Limit is ${rl.maxUrlsPerJob ?? 500} per job.` });
    }
    if (!checkJobRateLimit(req.ip)) {
        return res.status(429).json({ error: 'Too many jobs created. Try again later.' });
    }

    const id = uuidv4();
    const job = {
        id,
        status:       'running',
        createdAt:    new Date().toISOString(),
        urls,
        outputFolder,
        options:      { autoDetect, fullPageFallback, width, height, format, quality, generatePdf, generateVideo, videoDuration, videoFps },
        sources:      urls.map((url, i) => ({
            url, sourceIndex: i,
            status: 'queued', isPresentation: false,
            slideCount: 0, error: null, images: [],
            savedTo: null, pdfBuffer: null, videoBuffer: null, videoMime: null,
        })),
    };
    slidesJobs.set(id, job);
    res.json({ id });

    // Run conversion asynchronously
    (async () => {
        let completed = 0;
        let totalSlides = 0;

        for (const src of job.sources) {
            io.to(`slides:${id}`).emit('slides-progress', {
                jobId: id, type: 'url-start', url: src.url,
            });
            src.status = 'running';

            try {
                // Screenshots are needed for: gallery display, PDF, or frames-mode video
                const needScreenshots = saveImages || generatePdf || (generateVideo && videoMode === 'frames');
                let capturedImages = [];

                if (needScreenshots) {
                    const result = await convertUrl(src.url, {
                        autoDetect, fullPageFallback, width, height, format, quality,
                        onSlide: (n, total) => {
                            io.to(`slides:${id}`).emit('slides-progress', {
                                jobId: id, type: 'slide-done',
                                url: src.url, slideIndex: n, slideTotal: total,
                            });
                        },
                    });
                    src.isPresentation = result.isPresentation;
                    src.slideCount     = result.slideCount;
                    capturedImages     = result.images;
                    totalSlides       += capturedImages.length;
                    if (saveImages) src.images = capturedImages;
                }

                // ── PDF ───────────────────────────────────────────────────────
                if (generatePdf && capturedImages.length > 0) {
                    io.to(`slides:${id}`).emit('slides-progress', {
                        jobId: id, type: 'pdf-start', url: src.url,
                    });
                    try {
                        src.pdfBuffer = await imagesToPdf(capturedImages);
                        if (outputFolder) {
                            const subDir = path.join(outputFolder, folderNameFromUrl(src.url));
                            fs.mkdirSync(subDir, { recursive: true });
                            fs.writeFileSync(path.join(subDir, 'slides.pdf'), src.pdfBuffer);
                        }
                        io.to(`slides:${id}`).emit('slides-progress', {
                            jobId: id, type: 'pdf-done', url: src.url,
                        });
                    } catch (pdfErr) {
                        io.to(`slides:${id}`).emit('slides-progress', {
                            jobId: id, type: 'pdf-error', url: src.url, error: pdfErr.message,
                        });
                    }
                }

                // ── Video ─────────────────────────────────────────────────────
                if (generateVideo) {
                    io.to(`slides:${id}`).emit('slides-progress', {
                        jobId: id, type: 'video-start', url: src.url, mode: videoMode,
                    });
                    try {
                        if (videoMode === 'live') {
                            // ── Live recording via Playwright ──────────────────
                            const rec = await recordPresentation(src.url, {
                                autoDetect, width, height,
                                duration: videoDuration,
                                onSlide: (n, total) => {
                                    io.to(`slides:${id}`).emit('slides-progress', {
                                        jobId: id, type: 'slide-done',
                                        url: src.url, slideIndex: n, slideTotal: total,
                                    });
                                },
                            });
                            // When screenshots were skipped, populate metadata from the recording
                            if (!needScreenshots) {
                                src.isPresentation = rec.isPresentation;
                                src.slideCount     = rec.slideCount;
                                totalSlides       += rec.slideCount;
                            }

                            // Convert webm → mp4 via ffmpeg if available
                            if (ffmpegAvailable()) {
                                const tmpIn  = path.join(os.tmpdir(), `rec-in-${id}.webm`);
                                const tmpOut = path.join(os.tmpdir(), `rec-out-${id}.mp4`);
                                fs.writeFileSync(tmpIn, rec.buffer);
                                await new Promise((resolve, reject) => {
                                    execFile('ffmpeg', [
                                        '-i', tmpIn,
                                        '-c:v', 'libx264',
                                        '-pix_fmt', 'yuv420p',
                                        '-movflags', '+faststart',
                                        '-y', tmpOut,
                                    ], (err, _stdout, stderr) => {
                                        try { fs.unlinkSync(tmpIn); } catch { /* ignore */ }
                                        if (err) reject(new Error('ffmpeg: ' + (stderr || err.message)));
                                        else resolve();
                                    });
                                });
                                src.videoBuffer = fs.readFileSync(tmpOut);
                                src.videoMime   = 'video/mp4';
                                try { fs.unlinkSync(tmpOut); } catch { /* ignore */ }
                            } else {
                                src.videoBuffer = rec.buffer;
                                src.videoMime   = 'video/webm';
                            }

                            if (outputFolder) {
                                const subDir = path.join(outputFolder, folderNameFromUrl(src.url));
                                fs.mkdirSync(subDir, { recursive: true });
                                const ext = src.videoMime === 'video/mp4' ? 'mp4' : 'webm';
                                fs.writeFileSync(path.join(subDir, `recording.${ext}`), src.videoBuffer);
                            }

                        } else {
                            // ── Frames mode — ffmpeg slideshow ────────────────
                            if (capturedImages.length > 0) {
                                src.videoBuffer = await generateVideo(capturedImages, { duration: videoDuration, fps: videoFps });
                                src.videoMime   = 'video/mp4';
                                if (outputFolder) {
                                    const subDir = path.join(outputFolder, folderNameFromUrl(src.url));
                                    fs.mkdirSync(subDir, { recursive: true });
                                    fs.writeFileSync(path.join(subDir, 'slideshow.mp4'), src.videoBuffer);
                                }
                            }
                        }

                        io.to(`slides:${id}`).emit('slides-progress', {
                            jobId: id, type: 'video-done', url: src.url, mime: src.videoMime,
                        });
                    } catch (vidErr) {
                        io.to(`slides:${id}`).emit('slides-progress', {
                            jobId: id, type: 'video-error', url: src.url, error: vidErr.message,
                        });
                    }
                }

                // ── Save images to disk ───────────────────────────────────────
                if (saveImages && outputFolder && capturedImages.length > 0) {
                    const subDir = path.join(outputFolder, folderNameFromUrl(src.url));
                    fs.mkdirSync(subDir, { recursive: true });
                    for (const img of capturedImages) {
                        fs.writeFileSync(path.join(subDir, img.filename), img.buffer);
                    }
                    src.savedTo = subDir;
                }

                src.status = 'done';

            } catch (err) {
                src.status = 'error';
                src.error  = err.message;
                io.to(`slides:${id}`).emit('slides-progress', {
                    jobId: id, type: 'url-error',
                    url: src.url, error: err.message,
                    completed: ++completed, total: urls.length,
                });
                continue;
            }

            completed++;
            io.to(`slides:${id}`).emit('slides-progress', {
                jobId: id, type: 'url-done',
                url:            src.url,
                isPresentation: src.isPresentation,
                slideCount:     src.slideCount,
                savedTo:        src.savedTo,
                hasPdf:         !!src.pdfBuffer,
                hasVideo:       !!src.videoBuffer,
                completed, total: urls.length,
            });
        }

        job.status      = 'done';
        job.completedAt = new Date().toISOString();

        io.to(`slides:${id}`).emit('slides-progress', {
            jobId: id, type: 'done',
            urlCount: urls.length, totalSlides,
            savedTo: outputFolder || null,
        });
    })().catch(err => {
        const job = slidesJobs.get(id);
        if (job) { job.status = 'error'; job.error = err.message; }
        io.to(`slides:${id}`).emit('slides-progress', { jobId: id, type: 'error', error: err.message });
    });
});

// GET /api/slides/jobs/:id/images — metadata only (no buffers)
app.get('/api/slides/jobs/:id/images', (req, res) => {
    const job = slidesJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({
        id: job.id, status: job.status,
        sources: job.sources.map(src => ({
            url:            src.url,
            sourceIndex:    src.sourceIndex,
            isPresentation: src.isPresentation,
            status:         src.status,
            error:          src.error,
            hasPdf:         !!src.pdfBuffer,
            hasVideo:       !!src.videoBuffer,
            videoMime:      src.videoMime || null,
            images:         src.images.map(img => ({ filename: img.filename })),
        })),
    });
});

// GET /api/slides/jobs/:id/image/:sourceIndex/:imageIndex — serve one image
app.get('/api/slides/jobs/:id/image/:si/:ii', (req, res) => {
    const job = slidesJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const src = job.sources[parseInt(req.params.si)];
    if (!src) return res.status(404).json({ error: 'Source not found' });
    const img = src.images[parseInt(req.params.ii)];
    if (!img) return res.status(404).json({ error: 'Image not found' });
    const ext  = img.filename.split('.').pop().toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
               : ext === 'webp' ? 'image/webp' : 'image/png';
    res.set('Content-Type', mime);
    res.set('Content-Disposition', `inline; filename="${img.filename}"`);
    res.send(img.buffer);
});

// GET /api/slides/jobs/:id/pdf/:si — serve PDF for one source
app.get('/api/slides/jobs/:id/pdf/:si', (req, res) => {
    const job = slidesJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const src = job.sources[parseInt(req.params.si)];
    if (!src || !src.pdfBuffer) return res.status(404).json({ error: 'PDF not found' });
    const name = folderNameFromUrl(src.url) + '.pdf';
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.send(src.pdfBuffer);
});

// GET /api/slides/jobs/:id/video/:si — serve video for one source
app.get('/api/slides/jobs/:id/video/:si', (req, res) => {
    const job = slidesJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const src = job.sources[parseInt(req.params.si)];
    if (!src || !src.videoBuffer) return res.status(404).json({ error: 'Video not found' });
    const mime = src.videoMime || 'video/mp4';
    const ext  = mime === 'video/webm' ? 'webm' : 'mp4';
    const name = folderNameFromUrl(src.url) + '.' + ext;
    res.set('Content-Type', mime);
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.send(src.videoBuffer);
});

// GET /api/slides/jobs/:id/download/:sourceIndex — ZIP for one source
app.get('/api/slides/jobs/:id/download/:si', (req, res) => {
    const job = slidesJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    let files;
    if (req.params.si === 'all') {
        files = job.sources.flatMap((src, si) =>
            src.images.map(img => ({
                filename: `source-${si + 1}/${img.filename}`,
                buffer:   img.buffer,
            }))
        );
    } else {
        const src = job.sources[parseInt(req.params.si)];
        if (!src) return res.status(404).json({ error: 'Source not found' });
        files = src.images.map(img => ({ filename: img.filename, buffer: img.buffer }));
    }

    if (files.length === 0) return res.status(404).json({ error: 'No images' });

    const zip     = buildZip(files);
    const zipName = req.params.si === 'all' ? `slides-${job.id}.zip` : `slides-source-${parseInt(req.params.si) + 1}.zip`;
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${zipName}"`);
    res.send(zip);
});

// ── System resource check ─────────────────────────────────────────────────────

function getSystemResources() {
    const totalMem  = os.totalmem();
    const freeMem   = os.freemem();
    const usedMem   = totalMem - freeMem;
    const memPct    = Math.round((usedMem / totalMem) * 100);

    // CPU: average load over last minute (Unix) or last 15s average on Windows
    const cpuAvg    = os.loadavg()[0];          // 1-minute average
    const cpuCount  = os.cpus().length;
    // Normalise: load / cpuCount gives fraction 0-1; multiply by 100 for %
    const cpuPct    = Math.min(100, Math.round((cpuAvg / cpuCount) * 100));

    // Disk: approximate free on the system drive via process.cwd()
    let diskFreeGB  = null;
    let diskTotalGB = null;
    try {
        const { execSync } = require('child_process');
        if (process.platform === 'win32') {
            // wmic — available on all Windows versions
            const out = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace,Size /format:value', { stdio: 'pipe', timeout: 3000 }).toString();
            const free = parseInt((out.match(/FreeSpace=(\d+)/) || [])[1] || '0');
            const size = parseInt((out.match(/Size=(\d+)/)      || [])[1] || '0');
            diskFreeGB  = +(free / 1e9).toFixed(1);
            diskTotalGB = +(size / 1e9).toFixed(1);
        } else {
            const out = execSync(`df -B1 ${process.cwd()}`, { stdio: 'pipe', timeout: 3000 }).toString().split('\n')[1].split(/\s+/);
            diskTotalGB = +(parseInt(out[1]) / 1e9).toFixed(1);
            diskFreeGB  = +(parseInt(out[3]) / 1e9).toFixed(1);
        }
    } catch { /* best-effort */ }

    return {
        memory: {
            totalGB:  +(totalMem / 1e9).toFixed(1),
            usedGB:   +(usedMem  / 1e9).toFixed(1),
            freeGB:   +(freeMem  / 1e9).toFixed(1),
            usedPct:  memPct,
        },
        cpu: {
            cores:    cpuCount,
            loadPct:  cpuPct,
        },
        disk: diskFreeGB !== null ? {
            totalGB:  diskTotalGB,
            freeGB:   diskFreeGB,
            usedPct:  diskTotalGB ? Math.round(((diskTotalGB - diskFreeGB) / diskTotalGB) * 100) : null,
        } : null,
    };
}

/**
 * Returns the safe maximum concurrency based on current system resources.
 * Each Chromium instance uses roughly 200–400 MB RAM and 1 logical CPU.
 * Rules:
 *  - Never use more than 75% of free RAM (leave headroom for OS + server)
 *  - Never use more than (cpuCores - 1) browsers (leave one core for Node)
 *  - Never exceed requested concurrency
 */
function safeConcurrency(requested) {
    const res = getSystemResources();
    const memHeadroom = res.memory.freeGB * 0.75;   // 75% of free RAM available
    const maxByMem    = Math.max(1, Math.floor(memHeadroom / 0.35));  // ~350 MB per browser
    const maxByCpu    = Math.max(1, res.cpu.cores - 1);
    return Math.min(requested, maxByMem, maxByCpu);
}

// GET /api/resources — live RAM/CPU/disk snapshot
app.get('/api/resources', (_req, res) => {
    try {
        const r = getSystemResources();
        r.recommendedConcurrency = safeConcurrency(16);
        res.json(r);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Scraper API ───────────────────────────────────────────────────────────────

const scraperJobs = new Map();

// POST /api/scraper/jobs — start a text-scraping job
app.post('/api/scraper/jobs', (req, res) => {
    const {
        urls,
        concurrency  = 4,
        timeout      = 30000,
        waitUntil    = 'networkidle',
        selectors    = null,       // null = auto; array = custom
        proxies      = [],         // proxy URLs to rotate
        outputFolder = null,
        outputFormat = 'json',     // 'json' | 'csv' | 'markdown'
    } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'urls array required' });
    }

    const appCfg2 = readAppConfig();
    const rl2     = appCfg2.rateLimits || {};
    if (urls.length > (rl2.maxUrlsPerJob ?? 500)) {
        return res.status(400).json({ error: `Too many URLs. Limit is ${rl2.maxUrlsPerJob ?? 500} per job.` });
    }
    if (!checkJobRateLimit(req.ip)) {
        return res.status(429).json({ error: 'Too many jobs created. Try again later.' });
    }

    const id = uuidv4();
    const cancelRef = { cancelled: false };
    const job = {
        id,
        status: 'running',
        createdAt: new Date().toISOString(),
        completedAt: null,
        urls,
        options: { concurrency, timeout, waitUntil, selectors, proxies, outputFolder, outputFormat },
        results: [],
        cancelRef,
        stats: { total: urls.length, done: 0, errors: 0 },
    };
    scraperJobs.set(id, job);
    res.json({ id });

    const emit = (evt) => io.to(`scraper:${id}`).emit('scraper-progress', { jobId: id, ...evt });

    (async () => {
        const safeCon = safeConcurrency(concurrency);
    const results = await scrapeUrls(urls, {
            concurrency: safeCon, timeout, waitUntil, selectors, proxies, cancelRef,
            onProgress: (evt) => {
                if (evt.type === 'url-done')  job.stats.done++;
                if (evt.type === 'url-error') { job.stats.done++; job.stats.errors++; }
                emit(evt);
            },
        });

        job.results = results;
        job.status  = cancelRef.cancelled ? 'cancelled' : 'done';
        job.completedAt = new Date().toISOString();

        // Save to folder
        if (outputFolder && results.length > 0) {
            try {
                fs.mkdirSync(outputFolder, { recursive: true });
                if (outputFormat === 'csv') {
                    fs.writeFileSync(path.join(outputFolder, `scraped-${id}.csv`), toCSV(results));
                } else if (outputFormat === 'markdown') {
                    fs.writeFileSync(path.join(outputFolder, `scraped-${id}.md`), toMarkdown(results));
                } else {
                    fs.writeFileSync(path.join(outputFolder, `scraped-${id}.json`), JSON.stringify(results, null, 2));
                }
            } catch (saveErr) {
                emit({ type: 'save-error', error: saveErr.message });
            }
        }

        emit({ type: 'done', total: urls.length, done: job.stats.done, errors: job.stats.errors });
        webhooks.fire(webhooks.EVENTS.SCRAPER_DONE, { jobId: id, total: urls.length, done: job.stats.done, errors: job.stats.errors });
    })().catch(err => {
        job.status = 'error';
        emit({ type: 'error', error: err.message });
        webhooks.fire(webhooks.EVENTS.SCRAPER_ERROR, { jobId: id, error: err.message });
    });
});

// GET /api/scraper/jobs/:id — job status + results
app.get('/api/scraper/jobs/:id', (req, res) => {
    const job = scraperJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json({
        id: job.id, status: job.status,
        createdAt: job.createdAt, completedAt: job.completedAt,
        stats: job.stats,
        results: job.results,
    });
});

// GET /api/scraper/jobs/:id/download/:format — json | csv | markdown
app.get('/api/scraper/jobs/:id/download/:format', (req, res) => {
    const job = scraperJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const fmt = req.params.format;
    if (fmt === 'csv') {
        res.set('Content-Type', 'text/csv');
        res.set('Content-Disposition', `attachment; filename="scraped-${job.id}.csv"`);
        res.send(toCSV(job.results));
    } else if (fmt === 'markdown') {
        res.set('Content-Type', 'text/markdown');
        res.set('Content-Disposition', `attachment; filename="scraped-${job.id}.md"`);
        res.send(toMarkdown(job.results));
    } else {
        res.set('Content-Type', 'application/json');
        res.set('Content-Disposition', `attachment; filename="scraped-${job.id}.json"`);
        res.send(JSON.stringify(job.results, null, 2));
    }
});

// POST /api/scraper/jobs/:id/cancel
app.post('/api/scraper/jobs/:id/cancel', (req, res) => {
    const job = scraperJobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    job.cancelRef.cancelled = true;
    job.status = 'cancelling';
    res.json({ success: true });
});

// ── App config API ────────────────────────────────────────────────────────────

// GET /api/config — public: branding + ads (no admin key, no adminKey field)
app.get('/api/config', (_req, res) => {
    const cfg = readAppConfig();
    const { adminKey, ...pub } = cfg;  // strip adminKey from public response
    res.json(pub);
});

// Admin middleware — checks x-admin-key header against stored key
function requireAdminKey(req, res, next) {
    const cfg = readAppConfig();
    const key = req.headers['x-admin-key'] || '';
    if (!key || key !== cfg.adminKey) {
        return res.status(401).json({ error: 'Invalid admin key' });
    }
    next();
}

// GET /api/admin/config — full config including adminKey (admin only)
app.get('/api/admin/config', requireAdminKey, (_req, res) => {
    res.json(readAppConfig());
});

// POST /api/admin/config — save updated config
app.post('/api/admin/config', requireAdminKey, (req, res) => {
    const current = readAppConfig();
    const incoming = req.body;
    // Validate rateLimits types
    if (incoming.rateLimits) {
        const rl = incoming.rateLimits;
        if (rl.maxUrlsPerJob   !== undefined && (typeof rl.maxUrlsPerJob   !== 'number' || rl.maxUrlsPerJob   < 1))   return res.status(400).json({ error: 'maxUrlsPerJob must be a positive number' });
        if (rl.maxFileSizeMB   !== undefined && (typeof rl.maxFileSizeMB   !== 'number' || rl.maxFileSizeMB   < 1))   return res.status(400).json({ error: 'maxFileSizeMB must be a positive number' });
        if (rl.maxConcurrency  !== undefined && (typeof rl.maxConcurrency  !== 'number' || rl.maxConcurrency  < 1))   return res.status(400).json({ error: 'maxConcurrency must be a positive number' });
        if (rl.maxJobsPerHour  !== undefined && (typeof rl.maxJobsPerHour  !== 'number' || rl.maxJobsPerHour  < 1))   return res.status(400).json({ error: 'maxJobsPerHour must be a positive number' });
        if (rl.scrapeTimeoutMs !== undefined && (typeof rl.scrapeTimeoutMs !== 'number' || rl.scrapeTimeoutMs < 1000)) return res.status(400).json({ error: 'scrapeTimeoutMs must be ≥ 1000' });
    }
    const updated = {
        ...current,
        ...incoming,
        rateLimits: { ...(current.rateLimits || {}), ...(incoming.rateLimits || {}) },
        // Never allow unsetting adminKey via this route
        adminKey: incoming.adminKey || current.adminKey,
    };
    try {
        writeAppConfig(updated);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to write config: ' + err.message });
    }
});

// POST /api/admin/upload — upload logo or ad image
app.post('/api/admin/upload', requireAdminKey, multerUpload, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No valid image file uploaded' });
    const url = `/assets/uploads/${req.file.filename}`;
    res.json({ url, filename: req.file.filename, size: req.file.size });
});

// Serve uploaded files
app.use('/assets/uploads', express.static(UPLOADS_DIR));

// GET /api/admin/rate-limits — expose current rate limit config to admin UI
app.get('/api/admin/rate-limits', requireAdminKey, (_req, res) => {
    const cfg = readAppConfig();
    res.json(cfg.rateLimits || {});
});

// ── TTS (Edge TTS via msedge-tts) ────────────────────────────────────────────

const { textToAudioFile, getAudioDuration, VOICES: TTS_VOICES } = require('./video-studio/tts/edge-tts-service');
const _ttsJobs = new Map();
const TTS_DIR   = path.join(DATA_DIR, 'tts');
fs.mkdirSync(TTS_DIR, { recursive: true });

function ttsJobDir(jobId)  { return path.join(TTS_DIR, jobId); }
function ttsJobFile(jobId) { return path.join(TTS_DIR, jobId, 'job.json'); }

function saveTtsJob(jobId, job) {
    try { fs.writeFileSync(ttsJobFile(jobId), JSON.stringify(job)); } catch {}
}

function loadTtsJob(jobId) {
    let job = _ttsJobs.get(jobId);
    if (job) return job;
    try {
        const raw = fs.readFileSync(ttsJobFile(jobId), 'utf8');
        job = JSON.parse(raw);
        _ttsJobs.set(jobId, job);
        return job;
    } catch { return null; }
}

// GET /api/tts/voices
app.get('/api/tts/voices', (_req, res) => res.json(TTS_VOICES));

// POST /api/tts/jobs — start narration job
app.post('/api/tts/jobs', (req, res) => {
    const { url, voice = 'en-US-JennyNeural', outputFolder } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });
    // Accept http/https URLs and file:/// (local paths already converted by client)
    if (!/^(https?:\/\/|file:\/\/\/)/i.test(url)) {
        return res.status(400).json({ error: 'url must start with http://, https://, or be a local file path (C:\\…)' });
    }
    const jobId = uuidv4();
    const outDir = ttsJobDir(jobId);
    fs.mkdirSync(outDir, { recursive: true });
    const job = { status: 'running', voice, url, slides: [], outDir, error: null, videoStatus: null, videoStep: null, videoError: null };
    _ttsJobs.set(jobId, job);
    res.json({ jobId });

    (async () => {
        const { chromium } = require('playwright');
        let browser;
        try {
            browser = await chromium.launch({ headless: true });
            const page = await browser.newPage();
            // url is already file:/// if it was a local path (client converts C:\… → file:///C:/…)
            await page.goto(url, { waitUntil: 'load', timeout: 30000 });

            const narrations = await page.evaluate(() =>
                Array.from(document.querySelectorAll('[data-slide][data-narration]'))
                    .map(el => ({ slide: +el.dataset.slide, narration: el.dataset.narration || '' }))
                    .filter(s => s.narration)
            );

            job.slides = [];
            const total = narrations.length;
            for (const s of narrations) {
                const audioPath = path.join(outDir, `slide-${s.slide}.mp3`);
                let duration = null;
                let audioUrl = null;
                let slideError = null;
                try {
                    await textToAudioFile(s.narration, audioPath, voice);
                    duration = await getAudioDuration(audioPath);
                    audioUrl = `/api/tts/jobs/${jobId}/audio/${s.slide}`;
                } catch (ttsErr) {
                    slideError = ttsErr.message;
                }
                job.slides.push({ slide: s.slide, narration: s.narration, audioUrl, duration, error: slideError });
                io.to(`tts:${jobId}`).emit('tts-progress', { jobId, type: 'slide', slide: s.slide, duration, total });
            }
            job.status = 'done';
            saveTtsJob(jobId, job);

            // Copy MP3s to user-specified output folder if provided
            if (outputFolder) {
                try {
                    fs.mkdirSync(outputFolder, { recursive: true });
                    fs.readdirSync(outDir).filter(f => f.endsWith('.mp3')).forEach(f => {
                        fs.copyFileSync(path.join(outDir, f), path.join(outputFolder, f));
                    });
                } catch (copyErr) {
                    console.warn('[tts] outputFolder copy failed:', copyErr.message);
                }
            }

            io.to(`tts:${jobId}`).emit('tts-progress', { jobId, type: 'done', total: job.slides.length });
        } catch (err) {
            job.status = 'error'; job.error = err.message;
            saveTtsJob(jobId, job);
            io.to(`tts:${jobId}`).emit('tts-progress', { jobId, type: 'error', error: err.message });
        } finally {
            if (browser) await browser.close();
        }
    })();
});

// GET /api/tts/jobs/:id — job status (in-memory, falls back to disk)
app.get('/api/tts/jobs/:id', (req, res) => {
    const job = loadTtsJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(job);
});

// GET /api/tts/jobs/:id/audio/:slide — serve MP3 (no in-memory required)
app.get('/api/tts/jobs/:id/audio/:slide', (req, res) => {
    const audioPath = path.join(ttsJobDir(req.params.id), `slide-${req.params.slide}.mp3`);
    if (!fs.existsSync(audioPath)) return res.status(404).json({ error: 'Audio not found' });
    res.sendFile(audioPath);
});

// GET /api/tts/jobs/:id/download — ZIP of all MP3s
app.get('/api/tts/jobs/:id/download', (req, res) => {
    const dir = ttsJobDir(req.params.id);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Not found' });
    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.mp3'))
        .sort((a, b) => {
            const na = parseInt(a.match(/\d+/) || [0]);
            const nb = parseInt(b.match(/\d+/) || [0]);
            return na - nb;
        });
    if (!files.length) return res.status(404).json({ error: 'No audio files' });
    const entries = files.map(f => ({ filename: f, buffer: fs.readFileSync(path.join(dir, f)) }));
    const zipBuf = buildZip(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="narration-${req.params.id.slice(0, 8)}.zip"`);
    res.send(zipBuf);
});

// ── Narrated video generation ─────────────────────────────────────────────────

const { generateNarratedVideo } = require('./video-studio/tts/video-generator');

// POST /api/tts/jobs/:id/video — kick off narrated video generation
app.post('/api/tts/jobs/:id/video', (req, res) => {
    const jobId = req.params.id;
    const job   = loadTtsJob(jobId);
    if (!job)                         return res.status(404).json({ error: 'TTS job not found' });
    if (job.status !== 'done')        return res.status(400).json({ error: 'TTS job not complete yet' });
    if (!job.slides || !job.slides.length) return res.status(400).json({ error: 'No slides in TTS job' });
    if (job.videoStatus === 'running') return res.status(409).json({ error: 'Video generation already in progress' });

    const url = req.body?.url || job.url;
    if (!url) return res.status(400).json({ error: 'url required' });

    job.videoStatus = 'running';
    job.videoStep   = 'Starting…';
    job.videoError  = null;
    saveTtsJob(jobId, job);
    res.json({ status: 'running' });

    (async () => {
        try {
            await generateNarratedVideo(
                ttsJobDir(jobId), url, job.slides,
                {
                    onStep(msg) {
                        job.videoStep = msg;
                        io.to(`tts:${jobId}`).emit('tts-video', { jobId, step: msg, status: 'running' });
                    },
                }
            );
            job.videoStatus = 'done';
            job.videoStep   = 'Complete';
            saveTtsJob(jobId, job);
            io.to(`tts:${jobId}`).emit('tts-video', {
                jobId, status: 'done', step: 'Complete',
                videoUrl: `/api/tts/jobs/${jobId}/video`,
            });
        } catch (err) {
            job.videoStatus = 'error';
            job.videoError  = err.message;
            saveTtsJob(jobId, job);
            io.to(`tts:${jobId}`).emit('tts-video', { jobId, status: 'error', error: err.message });
        }
    })();
});

// GET /api/tts/jobs/:id/video — serve the narrated.mp4
app.get('/api/tts/jobs/:id/video', (req, res) => {
    const videoPath = path.join(ttsJobDir(req.params.id), 'narrated.mp4');
    if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Video not ready' });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="narrated-${req.params.id.slice(0, 8)}.mp4"`);
    res.sendFile(videoPath);
});

// ── Proxy management API ───────────────────────────────────────────────────────
// Proxies stored in app.config.json under "proxies": [{id,name,url,enabled}]
// Test probe: launches a stealth browser through the proxy, fetches ifconfig.me

const { launchStealth: _launchStealth, newStealthContext: _newStealthCtx } = require('./browser-studio/browser/stealth');

function readProxies()      { try { return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')).proxies || []; } catch { return []; } }
function writeProxies(list) { const c = (() => { try { return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')); } catch { return {}; } })(); c.proxies = list; fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2)); }

app.get('/api/proxies', requireAdminKey, (_req, res) => res.json(readProxies()));

app.post('/api/proxies', requireAdminKey, (req, res) => {
    const { name, url: proxyUrl, enabled = true } = req.body || {};
    if (!proxyUrl) return res.status(400).json({ error: 'url required' });
    const list  = readProxies();
    const entry = { id: Date.now().toString(36), name: name || proxyUrl, url: proxyUrl, enabled };
    list.push(entry);
    writeProxies(list);
    res.json(entry);
});

app.patch('/api/proxies/:id', requireAdminKey, (req, res) => {
    const list = readProxies();
    const idx  = list.findIndex(p => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });
    list[idx] = { ...list[idx], ...req.body };
    writeProxies(list);
    res.json(list[idx]);
});

app.delete('/api/proxies/:id', requireAdminKey, (req, res) => {
    writeProxies(readProxies().filter(p => p.id !== req.params.id));
    res.json({ success: true });
});

// POST /api/proxies/:id/test — probe the proxy by fetching a known IP-check URL
app.post('/api/proxies/:id/test', requireAdminKey, async (req, res) => {
    const proxy = readProxies().find(p => p.id === req.params.id);
    if (!proxy) return res.status(404).json({ error: 'Not found' });
    let browser;
    try {
        browser = await _launchStealth();
        const ctx  = await _newStealthCtx(browser, { proxy: parseProxy(proxy.url), canvasNoise: false, webglSpoof: false });
        const page = await ctx.newPage();
        await page.goto('https://ifconfig.me/ip', { waitUntil: 'domcontentloaded', timeout: 15000 });
        const ip = (await page.evaluate(() => document.body.innerText.trim()));
        await browser.close();
        res.json({ ok: true, ip });
    } catch (err) {
        if (browser) await browser.close().catch(() => {});
        res.json({ ok: false, error: err.message });
    }
});

// GET /api/proxies/enabled-urls — list of enabled proxy URLs (for internal use by scraper jobs)
app.get('/api/proxies/enabled-urls', requireAdminKey, (_req, res) => {
    res.json(readProxies().filter(p => p.enabled !== false).map(p => p.url));
});

// ── Webhook management API ─────────────────────────────────────────────────────

app.get('/api/webhooks',          requireAdminKey, (_req, res)  => res.json(webhooks.listWebhooks()));
app.get('/api/webhooks/events',   requireAdminKey, (_req, res)  => res.json(Object.values(webhooks.EVENTS)));
app.get('/api/webhooks/:id',      requireAdminKey, (req, res)   => {
    const w = webhooks.getWebhook(req.params.id);
    if (!w) return res.status(404).json({ error: 'Not found' });
    res.json(w);
});
app.post('/api/webhooks', requireAdminKey, (req, res) => {
    const { name, url: whUrl, events, secret, enabled } = req.body || {};
    if (!whUrl) return res.status(400).json({ error: 'url required' });
    if (!Array.isArray(events) || !events.length) return res.status(400).json({ error: 'events array required' });
    res.json(webhooks.addWebhook({ name: name || whUrl, url: whUrl, events, secret, enabled }));
});
app.patch('/api/webhooks/:id', requireAdminKey, (req, res) => {
    const w = webhooks.updateWebhook(req.params.id, req.body || {});
    if (!w) return res.status(404).json({ error: 'Not found' });
    res.json(w);
});
app.delete('/api/webhooks/:id', requireAdminKey, (req, res) => {
    webhooks.deleteWebhook(req.params.id);
    res.json({ success: true });
});
app.post('/api/webhooks/:id/test', requireAdminKey, async (req, res) => {
    res.json(await webhooks.testWebhook(req.params.id));
});

// ── Observability / Metrics API ────────────────────────────────────────────────

// GET /api/metrics — full snapshot (admin only)
app.get('/api/metrics', requireAdminKey, (_req, res) => res.json(metrics.snapshot()));

// GET /api/metrics/log?limit=100&type=scraper — recent event log
app.get('/api/metrics/log', requireAdminKey, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const type  = req.query.type || null;
    res.json(metrics.recentLog(limit, type));
});

// ── Auth routes ───────────────────────────────────────────────────────────────

// POST /api/auth/challenge — Metamask: issue a sign challenge for a wallet address
app.post('/api/auth/challenge', (req, res) => {
    const { address } = req.body || {};
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return res.status(400).json({ error: 'Valid EVM address required' });
    }
    const nonce = auth.generateNonce(address);
    res.json({ nonce });
});

// POST /api/auth/verify — Metamask: verify signature, issue JWT
app.post('/api/auth/verify', (req, res) => {
    const { address, signature } = req.body || {};
    if (!address || !signature) return res.status(400).json({ error: 'address and signature required' });
    const nonce = auth.getNonce(address);
    if (!nonce) return res.status(400).json({ error: 'No active challenge for this address — request a challenge first' });
    if (!auth.verifyMetamask(address, nonce, signature)) {
        return res.status(401).json({ error: 'Signature verification failed' });
    }
    auth.clearNonce(address);
    const userId = `evm@${address.toLowerCase()}`;
    pm.getUserDir(userId);
    const token = auth.signJWT({ userId, displayName: address.toLowerCase(), authMethod: 'metamask' });
    res.json({ token, userId, displayName: address.toLowerCase() });
});

// POST /api/auth/test — dev-only guest account (no real auth)
app.post('/api/auth/test', (_req, res) => {
    const { v4: uuid } = require('uuid');
    const userId = `test@${uuid()}`;
    pm.getUserDir(userId);
    const token = auth.signJWT({ userId, displayName: userId, authMethod: 'test' });
    res.json({ token, userId, displayName: userId });
});

// GET /api/auth/google — redirect to Google OAuth consent screen
app.get('/api/auth/google', (_req, res) => {
    if (!auth.isGoogleConfigured()) {
        return res.status(501).json({ error: 'Google OAuth not configured — add googleClientId / googleClientSecret to app.config.json' });
    }
    res.redirect(auth.buildGoogleAuthUrl());
});

// GET /api/auth/google/callback — OAuth code exchange, redirect to auth-callback.html
app.get('/api/auth/google/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error || !code) {
        return res.redirect(`/auth-callback.html#error=${encodeURIComponent(error || 'no_code')}`);
    }
    try {
        const tokens    = await auth.exchangeGoogleCode(code);
        const userInfo  = await auth.getGoogleUser(tokens.access_token);
        const email     = userInfo.email;
        if (!email) throw new Error('Google did not return an email address');
        const userId    = `google@${email}`;
        pm.getUserDir(userId);
        const token     = auth.signJWT({ userId, displayName: email, authMethod: 'google' });
        res.redirect(`/auth-callback.html#token=${encodeURIComponent(token)}`);
    } catch (err) {
        res.redirect(`/auth-callback.html#error=${encodeURIComponent(err.message)}`);
    }
});

// GET /api/auth/me — verify current token and return user info
app.get('/api/auth/me', auth.authMiddleware, (req, res) => {
    res.json(req.user);
});

// GET /api/auth/google-configured — lets login.html know whether to show Google button
app.get('/api/auth/google-configured', (_req, res) => {
    res.json({ configured: auth.isGoogleConfigured() });
});

// ── API key management ─────────────────────────────────────────────────────────
// GET  /api/auth/api-keys         — list keys for authenticated user
// POST /api/auth/api-keys         — create new key { name }
// DELETE /api/auth/api-keys/:kid  — revoke a key

app.get('/api/auth/api-keys', auth.authMiddleware, (req, res) => {
    const keys = auth.listApiKeys(req.user.userId).map(k => ({
        id: k.id, name: k.name, keyPreview: k.key.slice(0, 10) + '…', createdAt: k.createdAt,
    }));
    res.json(keys);
});

app.post('/api/auth/api-keys', auth.authMiddleware, (req, res) => {
    const { name } = req.body || {};
    const entry = auth.addApiKey(req.user.userId, name || 'API Key');
    // Return full key only on creation — it will not be shown again
    res.status(201).json({ id: entry.id, name: entry.name, key: entry.key, createdAt: entry.createdAt });
});

app.delete('/api/auth/api-keys/:kid', auth.authMiddleware, (req, res) => {
    const ok = auth.revokeApiKey(req.user.userId, req.params.kid);
    if (!ok) return res.status(404).json({ error: 'API key not found' });
    res.json({ success: true });
});

// ── Studio multer — per-slide image uploads ────────────────────────────────────

const _studioStorage = multer.diskStorage({
    destination: (req, _file, cb) => {
        const dir = pm.slideDir(req.user.userId, req.params.pid, req.params.sid);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        cb(null, `image${ext}`);
    },
});

function studioUpload(req, res, next) {
    const cfg    = readAppConfig();
    const maxMB  = cfg.rateLimits?.maxFileSizeMB ?? 50;
    const upload = multer({
        storage: _studioStorage,
        limits:  { fileSize: maxMB * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            cb(null, /\.(png|jpg|jpeg|webp|gif|bmp|tiff)$/i.test(file.originalname));
        },
    }).single('image');
    upload(req, res, next);
}

// ── Studio API — Projects ──────────────────────────────────────────────────────

// GET /api/studio/projects — optional ?type=video|dataset&parentId= filter
app.get('/api/studio/projects', auth.authMiddleware, (req, res) => {
    const { type } = req.query;
    let parentFilter;
    if ('parentId' in req.query) {
        parentFilter = req.query.parentId || null;
    }
    res.json(pm.listProjects(req.user.userId, type || null, parentFilter));
});

// POST /api/studio/projects — body: { name, type: 'video'|'dataset', description?, parentId? }
app.post('/api/studio/projects', auth.authMiddleware, (req, res) => {
    const { name, type, description, parentId } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const validTypes = ['video', 'dataset'];
    const projectType = validTypes.includes(type) ? type : 'video';
    res.json(pm.createProject(req.user.userId, {
        name:        name.trim(),
        type:        projectType,
        description: (description || '').trim(),
        parentId:    parentId || null,
    }));
});

// GET /api/studio/projects/:pid
app.get('/api/studio/projects/:pid', auth.authMiddleware, (req, res) => {
    const p = pm.getProject(req.user.userId, req.params.pid);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    res.json(p);
});

// PATCH /api/studio/projects/:pid
app.patch('/api/studio/projects/:pid', auth.authMiddleware, (req, res) => {
    const p = pm.updateProject(req.user.userId, req.params.pid, req.body || {});
    if (!p) return res.status(404).json({ error: 'Project not found' });
    res.json(p);
});

// DELETE /api/studio/projects/:pid
app.delete('/api/studio/projects/:pid', auth.authMiddleware, (req, res) => {
    pm.deleteProject(req.user.userId, req.params.pid);
    res.json({ success: true });
});

// ── Studio API — Slides ────────────────────────────────────────────────────────

// GET /api/studio/projects/:pid/slides — ordered slide list
app.get('/api/studio/projects/:pid/slides', auth.authMiddleware, (req, res) => {
    const p = pm.getProject(req.user.userId, req.params.pid);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    res.json(pm.getOrderedSlides(req.user.userId, req.params.pid));
});

// POST /api/studio/projects/:pid/slides — add slide (metadata only)
app.post('/api/studio/projects/:pid/slides', auth.authMiddleware, (req, res) => {
    const p = pm.getProject(req.user.userId, req.params.pid);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const slide = pm.addSlide(req.user.userId, req.params.pid, req.body || {});
    res.json(slide);
});

// PATCH /api/studio/projects/:pid/slides/:sid — update slide metadata / script
app.patch('/api/studio/projects/:pid/slides/:sid', auth.authMiddleware, (req, res) => {
    const slide = pm.updateSlide(req.user.userId, req.params.pid, req.params.sid, req.body || {});
    if (!slide) return res.status(404).json({ error: 'Slide not found' });
    res.json(slide);
});

// DELETE /api/studio/projects/:pid/slides/:sid
app.delete('/api/studio/projects/:pid/slides/:sid', auth.authMiddleware, (req, res) => {
    pm.deleteSlide(req.user.userId, req.params.pid, req.params.sid);
    res.json({ success: true });
});

// POST /api/studio/projects/:pid/slides/reorder — body: { order: [slideId, ...] }
app.post('/api/studio/projects/:pid/slides/reorder', auth.authMiddleware, (req, res) => {
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
    const p = pm.reorderSlides(req.user.userId, req.params.pid, order);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    res.json({ success: true, slides: p.slides });
});

// ── Studio API — Image upload + serve ─────────────────────────────────────────

// POST /api/studio/projects/:pid/slides/:sid/image — multipart/form-data
app.post('/api/studio/projects/:pid/slides/:sid/image', auth.authMiddleware, studioUpload, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No valid image uploaded' });
    const ext  = path.extname(req.file.filename);
    const rel  = `image${ext}`;
    pm.updateSlide(req.user.userId, req.params.pid, req.params.sid, { imagePath: rel, imageExt: ext.slice(1), clipPath: null });
    res.json({ imagePath: rel });
});

// POST /api/studio/projects/:pid/slides/:sid/image-url — import image from URL
app.post('/api/studio/projects/:pid/slides/:sid/image-url', auth.authMiddleware, async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });
    try {
        const https2 = url.startsWith('https') ? require('https') : require('http');
        const dest   = pm.slideDir(req.user.userId, req.params.pid, req.params.sid);
        fs.mkdirSync(dest, { recursive: true });
        const ext   = (url.split('?')[0].match(/\.(png|jpg|jpeg|webp|gif)$/i) || ['.png'])[0].toLowerCase();
        const fname = `image${ext}`;
        const fpath = path.join(dest, fname);
        await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(fpath);
            https2.get(url, res2 => {
                if (res2.statusCode !== 200) { reject(new Error(`HTTP ${res2.statusCode}`)); return; }
                res2.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
            }).on('error', reject);
        });
        pm.updateSlide(req.user.userId, req.params.pid, req.params.sid, { imagePath: fname, imageExt: ext.slice(1), clipPath: null });
        res.json({ imagePath: fname });
    } catch (err) {
        res.status(500).json({ error: 'Image download failed: ' + err.message });
    }
});

// GET /api/studio/projects/:pid/slides/:sid/image — serve current image
app.get('/api/studio/projects/:pid/slides/:sid/image', auth.authMiddleware, (req, res) => {
    const slide = pm.getSlide(req.user.userId, req.params.pid, req.params.sid);
    if (!slide || !slide.imagePath) return res.status(404).json({ error: 'No image' });
    const imgPath = path.join(pm.slideDir(req.user.userId, req.params.pid, req.params.sid), slide.imagePath);
    if (!fs.existsSync(imgPath)) return res.status(404).json({ error: 'Image file missing' });
    res.sendFile(imgPath);
});

// ── Dataset API — DataRecords ────────────────────────────────────────────────
// All routes require the project to exist and be type=dataset.

function _requireDataset(req, res) {
    const p = pm.getProject(req.user.userId, req.params.pid);
    if (!p) { res.status(404).json({ error: 'Project not found' }); return null; }
    if (p.type !== 'dataset') { res.status(400).json({ error: 'Project is not a Dataset' }); return null; }
    return p;
}

// GET /api/studio/projects/:pid/records?page=1&limit=50&search=
app.get('/api/studio/projects/:pid/records', auth.authMiddleware, (req, res) => {
    if (!_requireDataset(req, res)) return;
    const { page = 1, limit = 50, search = '' } = req.query;
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    res.json(pm.listDataRecords(req.user.userId, req.params.pid,
        { page: Math.max(1, Number(page) || 1), limit: safeLimit, search }));
});

// POST /api/studio/projects/:pid/records — add a DataRecord
app.post('/api/studio/projects/:pid/records', auth.authMiddleware, (req, res) => {
    if (!_requireDataset(req, res)) return;
    const record = pm.addDataRecord(req.user.userId, req.params.pid, req.body || {});
    res.status(201).json(record);
});

// GET /api/studio/projects/:pid/records/:rid
app.get('/api/studio/projects/:pid/records/:rid', auth.authMiddleware, (req, res) => {
    if (!_requireDataset(req, res)) return;
    const r = pm.getDataRecord(req.user.userId, req.params.pid, req.params.rid);
    if (!r) return res.status(404).json({ error: 'Record not found' });
    res.json(r);
});

// PATCH /api/studio/projects/:pid/records/:rid
app.patch('/api/studio/projects/:pid/records/:rid', auth.authMiddleware, (req, res) => {
    if (!_requireDataset(req, res)) return;
    const r = pm.updateDataRecord(req.user.userId, req.params.pid, req.params.rid, req.body || {});
    if (!r) return res.status(404).json({ error: 'Record not found' });
    res.json(r);
});

// DELETE /api/studio/projects/:pid/records/:rid
app.delete('/api/studio/projects/:pid/records/:rid', auth.authMiddleware, (req, res) => {
    if (!_requireDataset(req, res)) return;
    const ok = pm.deleteDataRecord(req.user.userId, req.params.pid, req.params.rid);
    if (!ok) return res.status(404).json({ error: 'Record not found' });
    res.json({ success: true });
});

// DELETE /api/studio/projects/:pid/records — clear all records
app.delete('/api/studio/projects/:pid/records', auth.authMiddleware, (req, res) => {
    if (!_requireDataset(req, res)) return;
    pm.clearDataRecords(req.user.userId, req.params.pid);
    res.json({ success: true });
});

// ── Studio API — Audio generate + serve ───────────────────────────────────────

// POST /api/studio/projects/:pid/slides/:sid/audio — generate TTS audio for slide
app.post('/api/studio/projects/:pid/slides/:sid/audio', auth.authMiddleware, async (req, res) => {
    const { voice } = req.body || {};
    try {
        const result = await videoStudio.generateAudioForSlide(req.user.userId, req.params.pid, req.params.sid, voice);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/studio/projects/:pid/slides/:sid/audio — serve audio.mp3
app.get('/api/studio/projects/:pid/slides/:sid/audio', auth.authMiddleware, (req, res) => {
    const audioPath = pm.slideAudioPath(req.user.userId, req.params.pid, req.params.sid);
    if (!fs.existsSync(audioPath)) return res.status(404).json({ error: 'No audio — generate first' });
    res.sendFile(audioPath);
});

// ── Studio API — Clip generate + serve ────────────────────────────────────────

// POST /api/studio/projects/:pid/slides/:sid/clip — encode image+audio → clip.mp4
app.post('/api/studio/projects/:pid/slides/:sid/clip', auth.authMiddleware, async (req, res) => {
    try {
        const clipPath = await videoStudio.generateClipForSlide(req.user.userId, req.params.pid, req.params.sid);
        res.json({ clipPath });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/studio/projects/:pid/slides/:sid/clip — serve clip.mp4
app.get('/api/studio/projects/:pid/slides/:sid/clip', auth.authMiddleware, (req, res) => {
    const clipPath = pm.slideClipPath(req.user.userId, req.params.pid, req.params.sid);
    if (!fs.existsSync(clipPath)) return res.status(404).json({ error: 'No clip — generate first' });
    res.sendFile(clipPath);
});

// ── Studio API — Recorded media upload ───────────────────────────────────────
// Accepts browser MediaRecorder blobs (WebM), converts to MP3/MP4 with ffmpeg.

const _recAudioUpload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 200 * 1024 * 1024 }, // 200 MB
}).single('audio');

const _recClipUpload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 500 * 1024 * 1024 }, // 500 MB
}).single('clip');

// POST /api/studio/projects/:pid/slides/:sid/audio/record — recorded voice
app.post('/api/studio/projects/:pid/slides/:sid/audio/record', auth.authMiddleware, _recAudioUpload, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
    try {
        const result = await videoStudio.processRecordedAudio(
            req.user.userId, req.params.pid, req.params.sid, req.file.buffer
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/studio/projects/:pid/slides/:sid/clip/record — recorded screen/camera
app.post('/api/studio/projects/:pid/slides/:sid/clip/record', auth.authMiddleware, _recClipUpload, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
    try {
        const result = await videoStudio.processRecordedClip(
            req.user.userId, req.params.pid, req.params.sid, req.file.buffer
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Studio API — Project video build + serve ──────────────────────────────────

// POST /api/studio/projects/:pid/video — kick off full project video build
app.post('/api/studio/projects/:pid/video', auth.authMiddleware, (req, res) => {
    const { userId } = req.user;
    const projectId  = req.params.pid;
    const project    = pm.getProject(userId, projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.videoStatus === 'building') return res.status(409).json({ error: 'Build already in progress' });

    const { voice } = req.body || {};
    pm.updateProject(userId, projectId, { videoStatus: 'building' });
    res.json({ status: 'building' });

    const room = `studio:${userId}:${projectId}`;
    (async () => {
        try {
            await videoStudio.buildProjectVideo(userId, projectId, {
                voice,
                onStep(msg) {
                    io.to(room).emit('studio-video', { projectId, status: 'running', step: msg });
                },
            });
            io.to(room).emit('studio-video', {
                projectId, status: 'done',
                videoUrl: `/api/studio/projects/${projectId}/video`,
            });
        } catch (err) {
            io.to(room).emit('studio-video', { projectId, status: 'error', error: err.message });
        }
    })();
});

// ── Studio API — Import: Step 1 scan (fast, no screenshots) ───────────────────
// Returns slide titles + narration text. No screenshots, no slide creation.
// Completes in ~3s so the user sees a preview before committing.

app.post('/api/studio/projects/:pid/import-url/scan', auth.authMiddleware, async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });
    if (!pm.getProject(req.user.userId, req.params.pid)) return res.status(404).json({ error: 'Project not found' });

    const { launchStealth: _ls, newStealthContext: _nsc } = require('./browser-studio/browser/stealth');
    const { chromium } = require('playwright');
    const isExt = /^https?:\/\//i.test(url);
    let browser;
    try {
        browser = isExt ? await _ls() : await chromium.launch({ headless: true });
        const ctx  = isExt
            ? await _nsc(browser, { canvasNoise: false, webglSpoof: false })
            : await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        const page = await ctx.newPage();
        const fileUrl = /^[A-Za-z]:\\/.test(url) ? 'file:///' + url.replace(/\\/g, '/') : url;
        await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(600);

        const result = await page.evaluate(() => {
            const SELECTORS = ['.slide', 'section.slide', '[data-slide]', '.page', 'section', 'article'];
            let els = [], selector = null;
            for (const sel of SELECTORS) {
                const found = [...document.querySelectorAll(sel)];
                if (found.length) { els = found; selector = sel; break; }
            }
            if (!els.length) {
                const h = document.querySelector('h1,h2');
                const t = document.title || (h ? h.textContent.trim() : '') || 'Page';
                const n = document.body.dataset.narration || document.body.dataset.script || '';
                return { selector: null, slides: [{ index: 0, title: t.slice(0, 80), script: n }] };
            }
            return {
                selector,
                slides: els.map((el, i) => {
                    const h = el.querySelector('h1,h2,h3,.slide-title,.title');
                    const title = (h ? h.textContent.trim() : (el.dataset.title || `Slide ${i + 1}`)).slice(0, 80);
                    const nar = el.dataset.narration || el.dataset.script
                        || (el.querySelector('[data-narration]') || {}).dataset?.narration
                        || (el.querySelector('[data-script]') || {}).dataset?.script || '';
                    return { index: i, title, script: nar };
                }),
            };
        });

        await browser.close();
        res.json({ url, count: result.slides.length, selector: result.selector, slides: result.slides });
    } catch (err) {
        if (browser) await browser.close().catch(() => {});
        res.status(500).json({ error: err.message });
    }
});

// ── Studio API — Import: Step 2 capture (screenshots + create slides) ──────────
// Body: { url, approved: [{index, title, script}, ...] }
// Runs in background; emits studio socket events per slide.

app.post('/api/studio/projects/:pid/import-url/capture', auth.authMiddleware, (req, res) => {
    const { url, approved } = req.body || {};
    if (!url || !Array.isArray(approved) || !approved.length) {
        return res.status(400).json({ error: 'url and approved array required' });
    }
    const { userId } = req.user;
    const { pid }    = req.params;
    if (!pm.getProject(userId, pid)) return res.status(404).json({ error: 'Project not found' });

    res.json({ status: 'capturing', total: approved.length });

    const room = `studio:${userId}:${pid}`;
    const emit = (evt) => io.to(room).emit('studio-import', { projectId: pid, ...evt });

    (async () => {
        const { launchStealth: _ls, newStealthContext: _nsc } = require('./browser-studio/browser/stealth');
        const { chromium } = require('playwright');
        const isExt = /^https?:\/\//i.test(url);
        let browser;
        try {
            browser = isExt ? await _ls() : await chromium.launch({ headless: true });
            const ctx  = isExt
                ? await _nsc(browser, { viewport: { width: 1920, height: 1080 }, canvasNoise: false, webglSpoof: false })
                : await browser.newContext({ viewport: { width: 1920, height: 1080 } });
            const page = await ctx.newPage();
            const fileUrl = /^[A-Za-z]:\\/.test(url) ? 'file:///' + url.replace(/\\/g, '/') : url;
            await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(600);

            // Re-detect slide selector (same logic as scan)
            const SLIDE_SELECTORS = ['.slide', 'section.slide', '[data-slide]', '.page', 'section', 'article'];
            const slideInfo = await page.evaluate((sels) => {
                for (const sel of sels) {
                    const count = document.querySelectorAll(sel).length;
                    if (count > 0) return { selector: sel, count };
                }
                return { selector: null, count: 0 };
            }, SLIDE_SELECTORS);
            const created = [];

            for (let i = 0; i < approved.length; i++) {
                const item = approved[i];
                emit({ type: 'slide-start', index: i, total: approved.length, title: item.title });
                try {
                    if (slideInfo.selector && item.index < slideInfo.count) {
                        // Navigate to the slide and force it visible
                        await page.evaluate(({ sel, idx }) => {
                            if (typeof go === 'function') { go(idx); return; }
                            const els = [...document.querySelectorAll(sel)];
                            els.forEach((el, j) => {
                                if (j === idx) {
                                    el.style.display  = '';
                                    el.style.visibility = 'visible';
                                    el.style.opacity  = '1';
                                    el.classList.add('active');
                                    el.scrollIntoView({ behavior: 'instant', block: 'start' });
                                } else {
                                    el.classList.remove('active');
                                }
                            });
                        }, { sel: slideInfo.selector, idx: item.index });
                        await page.waitForTimeout(400);
                    }
                    const slide = pm.addSlide(userId, pid, { title: item.title, script: item.script || '' });
                    const sDir  = pm.slideDir(userId, pid, slide.id);
                    fs.mkdirSync(sDir, { recursive: true });
                    const imgPath = path.join(sDir, 'image.png');

                    if (slideInfo.selector && item.index < slideInfo.count) {
                        // Screenshot the specific slide element for precision
                        const allEls = await page.$$(slideInfo.selector);
                        const el     = allEls[item.index];
                        if (el) {
                            await el.screenshot({ path: imgPath, type: 'png' });
                        } else {
                            await page.screenshot({ path: imgPath, type: 'png' });
                        }
                    } else {
                        // Whole-page import — screenshot the viewport
                        await page.screenshot({ path: imgPath, type: 'png' });
                    }

                    pm.updateSlide(userId, pid, slide.id, { imagePath: 'image.png', imageExt: 'png' });
                    created.push({ id: slide.id, title: slide.title });
                    emit({ type: 'slide-done', index: i, total: approved.length, slideId: slide.id, title: slide.title });
                } catch (slideErr) {
                    emit({ type: 'slide-error', index: i, total: approved.length, error: slideErr.message });
                }
            }
            await browser.close();
            emit({ type: 'done', imported: created.length, slides: created });
        } catch (err) {
            if (browser) await browser.close().catch(() => {});
            emit({ type: 'error', error: err.message });
        }
    })();
});

// ── Studio API — Generate all clips (batch audio + clip for every slide) ───────
// Emits per-slide socket progress. Non-blocking — returns immediately.

app.post('/api/studio/projects/:pid/generate-all', auth.authMiddleware, (req, res) => {
    const { userId } = req.user;
    const { pid }    = req.params;
    const project    = pm.getProject(userId, pid);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { voice } = req.body || {};
    res.json({ status: 'generating' });

    const room  = `studio:${userId}:${pid}`;
    const emit  = (evt) => io.to(room).emit('studio-generate', { projectId: pid, ...evt });
    const slides = pm.getOrderedSlides(userId, pid).filter(s => s.script && s.script.trim());

    (async () => {
        let done = 0;
        for (const slide of slides) {
            emit({ type: 'slide-start', slideId: slide.id, title: slide.title, done, total: slides.length });
            try {
                // Audio
                const audioDst = pm.slideAudioPath(userId, pid, slide.id);
                if (!fs.existsSync(audioDst)) {
                    await videoStudio.generateAudioForSlide(userId, pid, slide.id, voice);
                }
                // Clip
                const clipDst = pm.slideClipPath(userId, pid, slide.id);
                if (!fs.existsSync(clipDst)) {
                    await videoStudio.generateClipForSlide(userId, pid, slide.id);
                }
                done++;
                emit({ type: 'slide-done', slideId: slide.id, title: slide.title, done, total: slides.length });
            } catch (err) {
                done++;
                emit({ type: 'slide-error', slideId: slide.id, title: slide.title, error: err.message, done, total: slides.length });
            }
        }
        emit({ type: 'done', total: slides.length });
    })();
});

// GET /api/studio/projects/:pid/video — serve output.mp4
app.get('/api/studio/projects/:pid/video', auth.authMiddleware, (req, res) => {
    const videoPath = pm.projectVideoPath(req.user.userId, req.params.pid);
    if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Video not ready' });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="project-${req.params.pid.slice(0, 8)}.mp4"`);
    res.sendFile(videoPath);
});

// ── Pipeline API ───────────────────────────────────────────────────────────────

const { PipelineRunner } = require('./pipeline/runner');
const datapond           = require('./dataset/store');

const pipelineRuns = new Map();

app.get('/api/pipeline/sources', (_req, res) => {
    try { res.json(PipelineRunner.getSources()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pipeline/sources', auth.authMiddleware, (req, res) => {
    try {
        const manifest = req.body;
        if (!manifest?.id)   return res.status(400).json({ error: 'manifest.id required' });
        if (!manifest?.type) return res.status(400).json({ error: 'manifest.type required' });
        PipelineRunner.saveSource(manifest);
        res.status(201).json({ success: true, id: manifest.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/pipeline/sources/:id', auth.authMiddleware, (req, res) => {
    try {
        const manifest = { ...req.body, id: req.params.id };
        PipelineRunner.saveSource(manifest);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/pipeline/sources/:id', auth.authMiddleware, (req, res) => {
    try {
        PipelineRunner.deleteSource(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pipeline/run', auth.authMiddleware, (req, res) => {
    const { sourceId, query, location, maxResults = 100 } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: 'sourceId required' });
    if (!query)    return res.status(400).json({ error: 'query required' });

    const manifest = PipelineRunner.getSource(sourceId);
    if (!manifest) return res.status(404).json({ error: `Unknown source: ${sourceId}` });

    const runId = require('uuid').v4();
    pipelineRuns.set(runId, { status: 'running', startedAt: new Date().toISOString() });
    res.json({ runId });

    const runner = new PipelineRunner(
        sourceId,
        { query, location: location || '', maxResults },
        {
            onProgress({ fetched, source, error }) {
                io.to(`pipeline-${runId}`).emit('pipeline-progress', { runId, fetched, source, error: error || null });
            },
        }
    );

    runner.run()
        .then(result => {
            pipelineRuns.set(runId, { ...result, status: 'done' });
            io.to(`pipeline-${runId}`).emit('pipeline-done', { runId, ...result });
        })
        .catch(err => {
            pipelineRuns.set(runId, { status: 'error', error: err.message });
            io.to(`pipeline-${runId}`).emit('pipeline-error', { runId, error: err.message });
        });
});

app.get('/api/pipeline/run/:runId', auth.authMiddleware, (req, res) => {
    const run = pipelineRuns.get(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
});

// ── DataSet API ───────────────────────────────────────────────────────────────

app.get('/api/dataset/projects', requireAdminKey, (_req, res) => {
    try { res.json(datapond.listProjects()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/dataset/projects', requireAdminKey, (req, res) => {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    try { res.status(201).json(datapond.createProject(name, description || '')); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/dataset/projects/:id', requireAdminKey, (req, res) => {
    try { datapond.deleteProject(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/dataset/projects/:id/datasets', requireAdminKey, (req, res) => {
    try { res.json(datapond.listDataSets(req.params.id)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/dataset/projects/:id/datasets', requireAdminKey, (req, res) => {
    const { name, description, schema } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    try { res.status(201).json(datapond.createDataSet(req.params.id, name, description || '', schema || null)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/dataset/projects/:id/datasets/:dsId', requireAdminKey, (req, res) => {
    try { datapond.deleteDataSet(req.params.id, req.params.dsId); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/dataset/projects/:id/datasets/:dsId/records', requireAdminKey, (req, res) => {
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const limit  = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
    const search = req.query.search || '';
    try { res.json(datapond.getRecords(req.params.id, req.params.dsId, { offset, limit, search })); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/dataset/projects/:id/datasets/:dsId/records', requireAdminKey, (req, res) => {
    const { records } = req.body || {};
    if (!Array.isArray(records)) return res.status(400).json({ error: 'records array required' });
    try { res.status(201).json(datapond.addRecords(req.params.id, req.params.dsId, records)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/dataset/projects/:id/datasets/:dsId/records', requireAdminKey, (req, res) => {
    try { datapond.clearRecords(req.params.id, req.params.dsId); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/dataset/projects/:id/datasets/:dsId/export', requireAdminKey, (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    try {
        const content = datapond.exportRecords(req.params.id, req.params.dsId, format);
        if (format === 'csv') {
            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', `attachment; filename="export-${req.params.dsId}.csv"`);
        } else {
            res.set('Content-Type', 'application/json');
            res.set('Content-Disposition', `attachment; filename="export-${req.params.dsId}.json"`);
        }
        res.send(content);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`\n  Browser Automation → http://localhost:${PORT}\n`);
    const cfg = readAppConfig();
    console.log(`  App title: ${cfg.appTitle}`);
    const rl = cfg.rateLimits || {};
    console.log(`  Rate limits: ${rl.maxUrlsPerJob} URLs/job · ${rl.maxConcurrency} max pool · ${rl.maxJobsPerHour} jobs/hour\n`);
});

// ── Global error safety ────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    // Do not exit — Express stays alive for non-fatal errors
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────

function shutdown(signal) {
    console.log(`\n[shutdown] ${signal} received — closing server…`);
    server.close(() => {
        console.log('[shutdown] HTTP server closed');
        process.exit(0);
    });
    // Force-exit after 10 s if connections hang
    setTimeout(() => { console.error('[shutdown] Force exit after timeout'); process.exit(1); }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
