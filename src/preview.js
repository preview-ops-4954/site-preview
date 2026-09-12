'use strict';
// Watermarked, reduced-resolution preview derivatives for unpaid deliveries.
// Agents can see that a shoot is ready (and roughly what it looks like) before
// payment, but originals are never touched or exposed by this module: previews
// are NEW jpeg files written to a hidden .previews folder next to the delivery,
// capped at MAX_DIM pixels and stamped with a tiled watermark.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('./config');

const MAX_DIM = 1400;
const WATERMARK = 'JWRE MEDIA  \u2022  UNPAID PREVIEW';

function previewDir(orderId) {
  return path.join(config.dataDir, 'deliveries', orderId, '.previews');
}

function previewPath(orderId, filename) {
  const base = String(filename).replace(/\.[a-z0-9]+$/i, '');
  return path.join(previewDir(orderId), base + '.jpg');
}

function watermarkSvg(width, height) {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + '<defs><pattern id="wm" width="440" height="320" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">'
    + `<text x="12" y="160" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" letter-spacing="2" fill="rgba(255,255,255,0.42)" stroke="rgba(0,0,0,0.30)" stroke-width="0.8">${WATERMARK}</text>`
    + '</pattern></defs>'
    + '<rect width="100%" height="100%" fill="url(#wm)"/>'
    + '</svg>'
  );
}

// Build (or reuse) the watermarked derivative for one delivered file.
// Returns the absolute path of the derivative jpeg.
async function ensurePreview(orderId, filename) {
  const src = path.join(config.dataDir, 'deliveries', orderId, filename);
  const dest = previewPath(orderId, filename);
  try {
    const s = fs.statSync(src);
    const d = fs.statSync(dest);
    if (d.mtimeMs >= s.mtimeMs) return dest; // fresh cache
  } catch { /* missing source or derivative: (re)build below */ }
  fs.mkdirSync(previewDir(orderId), { recursive: true });
  const resized = await sharp(src)
    .rotate() // honor EXIF orientation
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const tmp = dest + '.tmp-' + process.pid;
  await sharp(resized)
    .composite([{ input: watermarkSvg(meta.width, meta.height) }])
    .jpeg({ quality: 72 })
    .toFile(tmp);
  fs.renameSync(tmp, dest);
  return dest;
}

// Drop cached derivatives for an order (e.g. after a file is removed).
function clearPreviews(orderId) {
  fs.rmSync(previewDir(orderId), { recursive: true, force: true });
}

module.exports = { ensurePreview, clearPreviews, MAX_DIM };
