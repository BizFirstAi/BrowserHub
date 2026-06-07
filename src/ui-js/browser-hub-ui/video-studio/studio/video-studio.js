'use strict';

// ── Video Studio — Per-slide audio + clip generation + final video build ────────
// All TTS uses msedge-tts (Edge TTS, no API key).
// All video uses ffmpeg-static (bundled binary, no system ffmpeg required).
// Subtitles are burned into pixels — no separate subtitle track or file.

const { execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ffmpegPath = require('ffmpeg-static');
const { textToAudioFile, getAudioDuration } = require('../tts/edge-tts-service');
const DEFAULT_VOICE = 'en-US-JennyNeural';
const pm = require('./project-manager');

// ── ffmpeg runner ──────────────────────────────────────────────────────────────

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

// ── SRT helpers ────────────────────────────────────────────────────────────────

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function toSrtTime(sec) {
    const h  = Math.floor(sec / 3600);
    const m  = Math.floor((sec % 3600) / 60);
    const s  = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function wrapText(text, maxLen = 72) {
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
        const dur   = s.audioDuration || 5;
        const block = `${i + 1}\n${toSrtTime(t)} --> ${toSrtTime(t + dur)}\n${wrapText(s.script)}\n`;
        t += dur;
        return block;
    }).join('\n');
}

// ── Audio generation ───────────────────────────────────────────────────────────

/**
 * Generate TTS audio for a single slide.
 * @param {string} userId
 * @param {string} projectId
 * @param {string} slideId
 * @param {string} voice  — Edge TTS voice name
 * @returns {Promise<{audioPath, duration}>}
 */
async function generateAudioForSlide(userId, projectId, slideId, voice) {
    const slide = pm.getSlide(userId, projectId, slideId);
    if (!slide) throw new Error('Slide not found');
    if (!slide.script || !slide.script.trim()) throw new Error('Slide has no script');

    const audioPath = pm.slideAudioPath(userId, projectId, slideId);
    const ttsVoice  = voice || DEFAULT_VOICE;

    await textToAudioFile(slide.script, audioPath, ttsVoice);
    const duration = await getAudioDuration(audioPath);

    pm.updateSlide(userId, projectId, slideId, {
        audioPath:     audioPath,
        audioDuration: duration,
        clipPath:      null, // invalidate stale clip
    });

    return { audioPath, duration };
}

// ── Per-slide clip generation ──────────────────────────────────────────────────

/**
 * Encode image + audio → clip.mp4 for a single slide.
 * The slide must already have an image and audio on disk.
 * @returns {Promise<string>} absolute path to clip.mp4
 */
async function generateClipForSlide(userId, projectId, slideId) {
    const slide = pm.getSlide(userId, projectId, slideId);
    if (!slide) throw new Error('Slide not found');

    const slideDirectory = pm.slideDir(userId, projectId, slideId);
    const imgPath  = slide.imagePath ? path.join(slideDirectory, slide.imagePath) : null;
    const audioPath = pm.slideAudioPath(userId, projectId, slideId);
    const clipPath  = pm.slideClipPath(userId, projectId, slideId);

    if (!imgPath || !fs.existsSync(imgPath)) throw new Error('Slide image not found');
    if (!fs.existsSync(audioPath)) throw new Error('Slide audio not found — generate audio first');

    await runFfmpeg([
        '-loop', '1',
        '-i',    imgPath,
        '-i',    audioPath,
        '-c:v',  'libx264', '-preset', 'fast', '-tune', 'stillimage',
        '-c:a',  'aac', '-b:a', '128k',
        '-pix_fmt', 'yuv420p',
        '-shortest',
        '-movflags', '+faststart',
        '-y', clipPath,
    ]);

    pm.updateSlide(userId, projectId, slideId, { clipPath });
    return clipPath;
}

// ── Full project video build ───────────────────────────────────────────────────

/**
 * Build the final narrated MP4 for a project.
 * Expects all slides to have clip.mp4 files; falls back to image+audio encoding
 * if a clip is missing (best-effort).
 *
 * @param {string}   userId
 * @param {string}   projectId
 * @param {object}   opts  — { onStep(msg), voice }
 * @returns {Promise<string>} absolute path to output.mp4
 */
async function buildProjectVideo(userId, projectId, opts = {}) {
    const { onStep = () => {}, voice } = opts;
    const project = pm.getProject(userId, projectId);
    if (!project) throw new Error('Project not found');

    const slides = pm.getOrderedSlides(userId, projectId)
        .filter(s => s.script && s.script.trim());

    if (!slides.length) throw new Error('Project has no slides with scripts');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
    try {
        // ── 1. Audio pass — generate any missing audio ─────────────────────────
        onStep('Checking slide audio…');
        for (const slide of slides) {
            const audioPath = pm.slideAudioPath(userId, projectId, slide.id);
            if (!fs.existsSync(audioPath)) {
                onStep(`Generating audio for "${slide.title}"…`);
                await generateAudioForSlide(userId, projectId, slide.id, voice);
            }
        }

        // ── 2. Clip pass — generate any missing clips ──────────────────────────
        onStep('Checking slide clips…');
        const clipPaths = [];
        for (const slide of slides) {
            const clipPath = pm.slideClipPath(userId, projectId, slide.id);
            if (!fs.existsSync(clipPath)) {
                const slideDirectory = pm.slideDir(userId, projectId, slide.id);
                const imgPath = slide.imagePath ? path.join(slideDirectory, slide.imagePath) : null;
                const audioPath = pm.slideAudioPath(userId, projectId, slide.id);
                if (imgPath && fs.existsSync(imgPath) && fs.existsSync(audioPath)) {
                    onStep(`Encoding clip for "${slide.title}"…`);
                    await generateClipForSlide(userId, projectId, slide.id);
                } else {
                    onStep(`Skipping "${slide.title}" — missing image or audio`);
                    continue;
                }
            }
            if (fs.existsSync(clipPath)) clipPaths.push({ slide, clipPath });
        }

        if (!clipPaths.length) throw new Error('No clips available to build video');

        // ── 3. Concatenate clips ───────────────────────────────────────────────
        onStep(`Concatenating ${clipPaths.length} clips…`);
        const concatTxt = path.join(tmpDir, 'concat.txt');
        fs.writeFileSync(concatTxt,
            clipPaths.map(({ clipPath: p }) => `file '${p.replace(/\\/g, '/')}'`).join('\n')
        );
        const combined = path.join(tmpDir, 'combined.mp4');
        await runFfmpeg([
            '-f', 'concat', '-safe', '0',
            '-i', concatTxt,
            '-c', 'copy',
            '-y', combined,
        ]);

        // ── 4. Build SRT from slides with known duration ───────────────────────
        onStep('Embedding subtitles…');
        const srtSlides = clipPaths.map(({ slide }) => ({
            script:        slide.script,
            audioDuration: slide.audioDuration || 5,
        }));
        fs.writeFileSync(path.join(tmpDir, 'subs.srt'), buildSrt(srtSlides), 'utf8');

        // ── 5. Subtitle burn ───────────────────────────────────────────────────
        const outputPath = pm.projectVideoPath(userId, projectId);
        let burnOk = false;

        // cwd=tmpDir keeps 'subs.srt' relative — avoids Windows drive-letter colon in vf filter
        try {
            await runFfmpeg([
                '-i', combined,
                '-vf', "subtitles=subs.srt:force_style='FontSize=14,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,Shadow=0,Alignment=2'",
                '-c:a', 'copy',
                '-movflags', '+faststart',
                '-y', outputPath,
            ], tmpDir);
            burnOk = true;
        } catch {
            onStep('Subtitle burn unavailable — finalising without subtitles…');
        }

        if (!burnOk) {
            await runFfmpeg([
                '-i', combined,
                '-c', 'copy',
                '-movflags', '+faststart',
                '-y', outputPath,
            ]);
        }

        pm.updateProject(userId, projectId, {
            videoStatus: 'done',
            videoPath:   outputPath,
        });

        onStep('Complete');
        return outputPath;

    } catch (err) {
        pm.updateProject(userId, projectId, { videoStatus: 'error' });
        throw err;
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

// ── Recorded media processing ──────────────────────────────────────────────────

/**
 * Convert a browser-recorded audio blob (WebM/Opus) to MP3, measure duration,
 * and store it as the slide's audio file — replacing any TTS-generated audio.
 * @param {string} userId
 * @param {string} projectId
 * @param {string} slideId
 * @param {Buffer} audioBuffer  Raw WebM audio bytes from the browser
 * @returns {Promise<{duration: number}>}
 */
async function processRecordedAudio(userId, projectId, slideId, audioBuffer) {
    const sDir   = pm.slideDir(userId, projectId, slideId);
    fs.mkdirSync(sDir, { recursive: true });
    const rawPath = path.join(sDir, 'audio_raw.webm');
    const mp3Path = pm.slideAudioPath(userId, projectId, slideId);
    fs.writeFileSync(rawPath, audioBuffer);
    try {
        await runFfmpeg([
            '-i', rawPath,
            '-c:a', 'libmp3lame', '-b:a', '128k',
            '-y', mp3Path,
        ]);
    } finally {
        try { fs.unlinkSync(rawPath); } catch { /* best-effort */ }
    }
    const duration = await getAudioDuration(mp3Path);
    pm.updateSlide(userId, projectId, slideId, {
        audioPath:     mp3Path,
        audioDuration: duration,
        clipPath:      null, // recorded audio invalidates any stale clip
    });
    return { duration };
}

/**
 * Convert a browser-recorded screen/camera video blob (WebM) to H.264 MP4,
 * and store it as the slide's clip file — bypassing the image+audio ffmpeg pipeline.
 * @param {string} userId
 * @param {string} projectId
 * @param {string} slideId
 * @param {Buffer} videoBuffer  Raw WebM video bytes from the browser
 * @returns {Promise<{clipPath: string}>}
 */
async function processRecordedClip(userId, projectId, slideId, videoBuffer) {
    const sDir    = pm.slideDir(userId, projectId, slideId);
    fs.mkdirSync(sDir, { recursive: true });
    const rawPath  = path.join(sDir, 'clip_raw.webm');
    const clipPath = pm.slideClipPath(userId, projectId, slideId);
    fs.writeFileSync(rawPath, videoBuffer);
    try {
        await runFfmpeg([
            '-i', rawPath,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-c:a', 'aac', '-b:a', '128k',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-y', clipPath,
        ]);
    } finally {
        try { fs.unlinkSync(rawPath); } catch { /* best-effort */ }
    }
    pm.updateSlide(userId, projectId, slideId, { clipPath });
    return { clipPath };
}

module.exports = {
    generateAudioForSlide,
    generateClipForSlide,
    buildProjectVideo,
    processRecordedAudio,
    processRecordedClip,
};
