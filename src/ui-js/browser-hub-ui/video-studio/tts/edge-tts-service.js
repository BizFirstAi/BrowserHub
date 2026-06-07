'use strict';

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { execFile } = require('child_process');
const fs = require('fs');
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

// Available English neural voices for narrator selection
const VOICES = [
    { id: 'en-US-JennyNeural',   label: 'Jenny (US, Female)' },
    { id: 'en-US-GuyNeural',     label: 'Guy (US, Male)' },
    { id: 'en-US-AriaNeural',    label: 'Aria (US, Female)' },
    { id: 'en-US-DavisNeural',   label: 'Davis (US, Male)' },
    { id: 'en-US-AmberNeural',   label: 'Amber (US, Female)' },
    { id: 'en-US-TonyNeural',    label: 'Tony (US, Male)' },
    { id: 'en-GB-SoniaNeural',   label: 'Sonia (GB, Female)' },
    { id: 'en-GB-RyanNeural',    label: 'Ryan (GB, Male)' },
    { id: 'en-AU-NatashaNeural', label: 'Natasha (AU, Female)' },
    { id: 'en-AU-WilliamNeural', label: 'William (AU, Male)' },
];

async function textToAudioFile(text, outputPath, voice = 'en-US-JennyNeural') {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {});
    const { audioStream } = await tts.toStream(text);
    const writeStream = fs.createWriteStream(outputPath);
    return new Promise((resolve, reject) => {
        audioStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', () => {
            tts.close();
            resolve(outputPath);
        });
        audioStream.pipe(writeStream);
    });
}

function getAudioDuration(filePath) {
    return new Promise((resolve) => {
        execFile(
            ffprobePath,
            ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath],
            (err, stdout) => {
                if (err) { resolve(null); return; }
                try {
                    const info = JSON.parse(stdout);
                    resolve(parseFloat(info.format?.duration) || null);
                } catch { resolve(null); }
            }
        );
    });
}

module.exports = { textToAudioFile, getAudioDuration, VOICES };
