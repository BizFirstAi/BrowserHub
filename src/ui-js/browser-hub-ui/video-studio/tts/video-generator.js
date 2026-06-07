'use strict';

const { execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { chromium } = require('playwright');
const ffmpegPath   = require('ffmpeg-static');

// ── SRT helpers ───────────────────────────────────────────────────────────────

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function toSrtTime(sec) {
    const h  = Math.floor(sec / 3600);
    const m  = Math.floor((sec % 3600) / 60);
    const s  = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function wrapNarration(text, maxLen = 72) {
    const words = (text || '').split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (test.length > maxLen && cur) { lines.push(cur); cur = w; }
        else cur = test;
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 2).join('\n');
}

function buildSrt(slides) {
    let t = 0;
    return slides.map((s, i) => {
        const dur   = s.duration || 5;
        const block = `${i + 1}\n${toSrtTime(t)} --> ${toSrtTime(t + dur)}\n${wrapNarration(s.narration)}\n`;
        t += dur;
        return block;
    }).join('\n');
}

// ── ffmpeg runner ─────────────────────────────────────────────────────────────

function runFfmpeg(args, cwd) {
    return new Promise((resolve, reject) => {
        const opts = { maxBuffer: 20 * 1024 * 1024 };
        if (cwd) opts.cwd = cwd;
        execFile(ffmpegPath, args, opts, (err, _stdout, stderr) => {
            if (err) reject(new Error((stderr || err.message).slice(-800)));
            else resolve();
        });
    });
}

// ── Playwright screenshot capture ─────────────────────────────────────────────

async function captureScreenshots(url, slides, dir) {
    const fileUrl = /^[A-Za-z]:\\/.test(url)
        ? 'file:///' + url.replace(/\\/g, '/')
        : url;

    const browser = await chromium.launch({ headless: true });
    const ctx     = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page    = await ctx.newPage();
    const map     = {};
    let   fallback = null;

    try {
        await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(800);

        const count = await page.evaluate(() => document.querySelectorAll('.slide').length);

        for (const s of slides) {
            const idx = s.slide - 1;
            if (idx < 0 || idx >= count) continue;
            await page.evaluate(i => {
                if (typeof go === 'function') { go(i); return; }
                document.querySelectorAll('.slide').forEach((el, j) =>
                    el.classList.toggle('active', j === i));
            }, idx);
            await page.waitForTimeout(250);
            const p = path.join(dir, `ss-${s.slide}.png`);
            await page.screenshot({ path: p, type: 'png' });
            map[s.slide] = p;
            if (!fallback) fallback = p;
        }

        // emergency fallback screenshot
        if (!fallback) {
            fallback = path.join(dir, 'ss-fallback.png');
            await page.screenshot({ path: fallback, type: 'png' });
        }
        map._fallback = fallback;
    } finally {
        await browser.close();
    }
    return map;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Generate a narrated MP4 with embedded subtitles from a completed TTS job.
 *
 * @param {string}   jobDir  - directory containing slide-N.mp3 files (from TTS job)
 * @param {string}   url     - presentation URL for Playwright screenshots
 * @param {Array}    slides  - [{slide, narration, duration}] from TTS job
 * @param {object}   opts    - { onStep(msg: string) }
 * @returns {Promise<string>} absolute path to narrated.mp4 written inside jobDir
 */
async function generateNarratedVideo(jobDir, url, slides, opts = {}) {
    const { onStep = () => {} } = opts;

    const validSlides = slides.filter(s =>
        s.duration > 0 &&
        fs.existsSync(path.join(jobDir, `slide-${s.slide}.mp3`))
    );
    if (!validSlides.length) {
        throw new Error('No valid audio files in TTS job — run narration first');
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narr-'));
    try {
        // ── 1. Screenshots ─────────────────────────────────────────────────────
        onStep(`Capturing ${validSlides.length} slide screenshots…`);
        const ssMap = await captureScreenshots(url, validSlides, tmpDir);

        // ── 2. Per-slide clips ─────────────────────────────────────────────────
        onStep('Encoding per-slide video clips…');
        const clips = [];
        for (const s of validSlides) {
            const img  = ssMap[s.slide] || ssMap._fallback;
            const mp3  = path.join(jobDir, `slide-${s.slide}.mp3`);
            const clip = path.join(tmpDir, `clip-${s.slide}.mp4`);
            if (!img || !fs.existsSync(img)) continue;
            await runFfmpeg([
                '-loop', '1',
                '-i',    img,
                '-i',    mp3,
                '-c:v',  'libx264', '-preset', 'fast', '-tune', 'stillimage',
                '-c:a',  'aac', '-b:a', '128k',
                '-pix_fmt', 'yuv420p',
                '-shortest',
                '-movflags', '+faststart',
                '-y', clip,
            ]);
            clips.push(clip);
        }
        if (!clips.length) throw new Error('No per-slide clips generated');

        // ── 3. Concatenate ─────────────────────────────────────────────────────
        onStep('Concatenating clips…');
        const concatTxt = path.join(tmpDir, 'concat.txt');
        fs.writeFileSync(concatTxt,
            clips.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n')
        );
        const combined = path.join(tmpDir, 'combined.mp4');
        await runFfmpeg([
            '-f', 'concat', '-safe', '0',
            '-i', concatTxt,
            '-c', 'copy',
            '-y', combined,
        ]);

        // ── 4. SRT + subtitle burn ─────────────────────────────────────────────
        onStep('Embedding subtitles…');
        const srtContent = buildSrt(validSlides);
        fs.writeFileSync(path.join(tmpDir, 'subs.srt'), srtContent, 'utf8');

        const finalPath = path.join(jobDir, 'narrated.mp4');
        let burnOk = false;

        // cwd=tmpDir so 'subs.srt' is a relative path — avoids Windows drive-letter colon escaping
        try {
            await runFfmpeg([
                '-i', combined,
                '-vf', "subtitles=subs.srt:force_style='FontSize=14,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=2'",
                '-c:a', 'copy',
                '-movflags', '+faststart',
                '-y', finalPath,
            ], tmpDir);
            burnOk = true;
        } catch {
            // libass burn failed — copy without subtitles, no separate track
            onStep('Subtitle burn unavailable — finalising without subtitles…');
        }

        if (!burnOk) {
            await runFfmpeg([
                '-i', combined,
                '-c', 'copy',
                '-movflags', '+faststart',
                '-y', finalPath,
            ]);
        }

        onStep('Complete');
        return finalPath;

    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

module.exports = { generateNarratedVideo };
