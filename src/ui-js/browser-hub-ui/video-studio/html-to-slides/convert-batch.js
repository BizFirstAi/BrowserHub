/**
 * html-to-slides/convert-batch.js
 *
 * Batch converter — process every HTML presentation in a folder.
 *
 * Usage:
 *   node html-to-slides/convert-batch.js <folder> [output-root] [--width=1920] [--height=1080]
 *
 * Example:
 *   node html-to-slides/convert-batch.js "C:\...\01.Start" ./batch-out
 *   → processes every *.html in that folder, one subfolder per file
 */

'use strict';

const { convertToSlides } = require('./convert');
const path = require('path');
const fs   = require('fs');

async function convertBatch(folder, outputRoot, opts = {}) {
  const absFolder = path.resolve(folder);
  if (!fs.existsSync(absFolder)) {
    throw new Error(`Folder not found: ${absFolder}`);
  }

  const htmlFiles = fs.readdirSync(absFolder)
    .filter(f => f.toLowerCase().endsWith('.html'))
    .map(f => path.join(absFolder, f));

  if (htmlFiles.length === 0) {
    throw new Error(`No HTML files found in: ${absFolder}`);
  }

  const root = path.resolve(outputRoot || path.join(absFolder, 'slides-export'));
  fs.mkdirSync(root, { recursive: true });

  console.log(`\nBatch converting ${htmlFiles.length} file(s) from:\n${absFolder}\n`);

  const results = [];

  for (const htmlFile of htmlFiles) {
    const baseName = path.basename(htmlFile, '.html');
    const outDir   = path.join(root, baseName);
    try {
      const result = await convertToSlides(htmlFile, outDir, opts);
      results.push({ file: htmlFile, ...result, status: 'ok' });
    } catch (err) {
      console.error(`  Skipped: ${path.basename(htmlFile)} — ${err.message}\n`);
      results.push({ file: htmlFile, status: 'error', error: err.message });
    }
  }

  // Summary
  const ok    = results.filter(r => r.status === 'ok');
  const fails = results.filter(r => r.status === 'error');
  console.log('═'.repeat(40));
  console.log(`Batch complete: ${ok.length} converted, ${fails.length} skipped`);
  console.log(`Output root: ${root}`);
  return results;
}

// CLI
const [,, folder, outputRoot, ...flags] = process.argv;
if (!folder) {
  console.log('Usage: node html-to-slides/convert-batch.js <folder> [output-root] [--width=N] [--height=N]');
  process.exit(0);
}
const opts = {};
flags.forEach(f => {
  if (f.startsWith('--')) {
    const [k, v] = f.slice(2).split('=');
    opts[k] = isNaN(v) ? v : Number(v);
  }
});

convertBatch(folder, outputRoot, opts).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

module.exports = { convertBatch };
