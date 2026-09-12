'use strict';
// Phase 2 media backfill: copy delivered files from local disk
// (data/deliveries/<ORDER-ID>/) into R2 under the key model and register
// each object in delivery_files. Idempotent per file (skips keys that
// already exist with the same size). Run after the JSON import, before
// switching MEDIA_BACKEND=r2.
//
// Usage: DATABASE_URL=... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//        node scripts/migrate-media-to-r2.js [--dir data/deliveries]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pg = require('../src/pg');
const r2mod = require('../src/r2');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.zip': 'application/zip' };

async function main() {
  const args = process.argv.slice(2);
  const dIdx = args.indexOf('--dir');
  const root = path.resolve(__dirname, '..', dIdx !== -1 ? args[dIdx + 1] : 'data/deliveries');
  if (!fs.existsSync(root)) { console.log('No deliveries directory at ' + root); return; }
  const r2 = r2mod.fromConfig();

  let uploaded = 0, kept = 0, registered = 0;
  for (const orderId of fs.readdirSync(root)) {
    const dir = path.join(root, orderId);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const filename of fs.readdirSync(dir)) {
      if (filename.startsWith('.')) continue;
      const filePath = path.join(dir, filename);
      const data = fs.readFileSync(filePath);
      const isVideo = ['.mp4', '.mov'].includes(path.extname(filename).toLowerCase());
      const key = isVideo ? r2mod.keys.video(orderId, filename) : r2mod.keys.original(orderId, filename);
      const kind = isVideo ? 'video' : 'original';
      const contentType = MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream';

      const head = await r2.headObject(key).catch(() => null);
      if (head && Number(head['content-length']) === data.length) {
        kept++;
      } else {
        await r2.putObject(key, data, contentType);
        uploaded++;
      }
      const sha = crypto.createHash('sha256').update(data).digest('hex');
      const res = await pg.query(
        `INSERT INTO delivery_files (order_id, kind, object_key, filename, content_type, byte_size, sha256, media_backend)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'r2')
         ON CONFLICT (order_id, kind, filename) DO UPDATE
           SET object_key = EXCLUDED.object_key, byte_size = EXCLUDED.byte_size, sha256 = EXCLUDED.sha256`,
        [orderId, kind, key, filename, contentType, data.length, sha]);
      if (res.rowCount) registered++;
    }
  }
  console.log(`Media migration: ${uploaded} uploaded, ${kept} already current, ${registered} registry rows written.`);
}

main().catch(err => { console.error('Media migration failed:', err.message); process.exit(1); });
