/**
 * html-to-slides/zip-writer.js
 *
 * Minimal ZIP writer (stored mode, no compression).
 * PNGs are already compressed — storing them uncompressed in a ZIP is correct.
 *
 * No external packages required — uses only Node.js built-ins.
 */

'use strict';

const { crc32 } = require('zlib');

/**
 * Build a ZIP Buffer from an array of { filename: string, buffer: Buffer }.
 * @param {Array<{filename:string, buffer:Buffer}>} files
 * @returns {Buffer}
 */
function buildZip(files) {
  const localHeaders = [];
  const centralDirs  = [];
  let offset = 0;

  for (const { filename, buffer } of files) {
    const name     = Buffer.from(filename, 'utf8');
    const crc      = crc32Buffer(buffer);
    const size     = buffer.length;
    const now      = dosDate(new Date());

    // Local file header
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20,  4);         // version needed
    local.writeUInt16LE(0,   6);         // flags
    local.writeUInt16LE(0,   8);         // compression (stored)
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc,  14);       // crc-32
    local.writeUInt32LE(size, 18);       // compressed size
    local.writeUInt32LE(size, 22);       // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0,   28);        // extra field length
    name.copy(local, 30);

    // Central directory header
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20,  4);
    central.writeUInt16LE(20,  6);
    central.writeUInt16LE(0,   8);         // flags
    central.writeUInt16LE(0,  10);         // compression (stored)
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc,  16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0,  30);         // extra
    central.writeUInt16LE(0,  32);         // comment
    central.writeUInt16LE(0,  34);         // disk start
    central.writeUInt16LE(0,  36);         // int attributes
    central.writeUInt32LE(0,  38);         // ext attributes
    central.writeUInt32LE(offset, 42);     // local header offset
    name.copy(central, 46);

    localHeaders.push(local, buffer);
    centralDirs.push(central);

    offset += local.length + buffer.length;
  }

  const cdStart  = offset;
  const cdBufs   = centralDirs;
  const cdSize   = cdBufs.reduce((s, b) => s + b.length, 0);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0,  4);          // disk number
  eocd.writeUInt16LE(0,  6);          // disk with CD
  eocd.writeUInt16LE(files.length,  8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize,  12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);          // comment length

  return Buffer.concat([...localHeaders, ...cdBufs, eocd]);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function crc32Buffer(buf) {
  // Node's zlib.crc32 is available from v22; fall back to a pure-JS impl for v18/v20
  if (typeof crc32 === 'function') {
    return crc32(buf);
  }
  return crc32Pure(buf);
}

let crc32Table = null;
function buildCrc32Table() {
  crc32Table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    crc32Table[n] = c;
  }
}
function crc32Pure(buf) {
  if (!crc32Table) buildCrc32Table();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDate(d) {
  const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
  const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
  return { time, date };
}

module.exports = { buildZip };
