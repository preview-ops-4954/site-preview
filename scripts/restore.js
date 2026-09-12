'use strict';
// Restore: load a backup file written by scripts/backup.js into Postgres.
// DESTRUCTIVE: truncates every application table first. Requires --yes.
// Safe dry check: run without --yes to see what would happen.
//
// Usage: node scripts/restore.js --file <backup.json> --yes
const fs = require('fs');
const pg = require('../src/pg');

// Insert parents before children (FK order): agents, then orders, then event/registry tables.
const ORDER = ['agents', 'orders', 'order_events', 'payment_events', 'delivery_files', 'counters'];
const JSONB_COLS = {
  agents: ['branding'],
  orders: ['customer', 'property', 'addon_ids', 'site', 'listing', 'delivery_release'],
  payment_events: ['detail'],
  delivery_files: [],
  order_events: [],
  counters: [],
};

async function main() {
  const args = process.argv.slice(2);
  const fIdx = args.indexOf('--file');
  if (fIdx === -1) { console.error('Missing --file <backup.json>'); process.exit(1); }
  const dump = JSON.parse(fs.readFileSync(args[fIdx + 1], 'utf8'));
  if (dump.format !== 'jwre-backup/1') { console.error('Not a jwre-backup/1 file.'); process.exit(1); }

  const counts = Object.fromEntries(Object.entries(dump.tables).map(([t, rows]) => [t, rows.length]));
  console.log('Backup from', dump.created_at, '- rows:', JSON.stringify(counts));
  if (!args.includes('--yes')) {
    console.log('Dry run only. Re-run with --yes to TRUNCATE all tables and restore.');
    return;
  }

  await pg.withTransaction(async (c) => {
    await c.query('TRUNCATE delivery_files, payment_events, order_events, orders, agents, counters RESTART IDENTITY CASCADE');
    for (const table of ORDER) {
      const rows = dump.tables[table] || [];
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map(col => JSONB_COLS[table].includes(col) && row[col] !== null && typeof row[col] === 'object'
          ? JSON.stringify(row[col]) : row[col]);
        await c.query(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, vals);
      }
      console.log(`restored ${table}: ${rows.length}`);
    }
    // Reinserted explicit ids leave identity sequences behind; resync them
    // or the next insert collides on id=1.
    for (const table of ['order_events', 'payment_events', 'delivery_files']) {
      await c.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'),
                       COALESCE((SELECT max(id) FROM ${table}), 1))`);
    }
  });
  console.log('Restore complete.');
}

main().catch(err => { console.error('Restore failed:', err.message); process.exit(1); });
