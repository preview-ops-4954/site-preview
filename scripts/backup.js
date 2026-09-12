'use strict';
// Backup: export every table to one JSON file (orders, order_events,
// payment_events, agents, delivery_files, counters). With R2 configured it
// also uploads a copy under backups/<YYYY>/<MM>/<DD>/ in the bucket, so the
// backup survives even if the database and this host are both lost.
//
// Usage: node scripts/backup.js [--out <file>] [--no-r2]
const fs = require('fs');
const path = require('path');
const pg = require('../src/pg');

const TABLES = ['agents', 'orders', 'order_events', 'payment_events', 'delivery_files', 'counters'];

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = outIdx !== -1 ? args[outIdx + 1]
    : path.join(__dirname, '..', 'backups', `jwre-backup-${ts}.json`);
  const useR2 = !args.includes('--no-r2');

  const dump = { format: 'jwre-backup/1', created_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    const r = await pg.query(`SELECT * FROM ${t}`);
    dump.tables[t] = r.rows;
    console.log(`${t}: ${r.rows.length} rows`);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const json = JSON.stringify(dump, null, 2);
  fs.writeFileSync(outFile, json);
  console.log('Wrote ' + outFile + ' (' + Buffer.byteLength(json) + ' bytes)');

  if (useR2 && process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) {
    const r2 = require('../src/r2').fromConfig();
    const key = require('../src/r2').keys.backup();
    await r2.putObject(key, Buffer.from(json), 'application/json');
    console.log('Uploaded to R2: ' + key);
  } else if (useR2) {
    console.log('R2 not configured - local file only.');
  }
}

main().catch(err => { console.error('Backup failed:', err.message); process.exit(1); });
