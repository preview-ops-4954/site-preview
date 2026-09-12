'use strict';
// Schema migration runner. Applies db/migrations/*.sql in filename order,
// recording each in schema_migrations. Idempotent: already-applied
// migrations are skipped. CLI: node db/migrate.js
const fs = require('fs');
const path = require('path');
const pg = require('../src/pg');

const MIGRATIONS_DIR = __dirname + '/migrations';

async function appliedVersions(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const r = await client.query('SELECT version FROM schema_migrations');
  return new Set(r.rows.map(row => row.version));
}

async function migrate() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  const applied = [];
  await pg.withTransaction(async (client) => {
    const done = await appliedVersions(client);
    for (const f of files) {
      const version = parseInt(f.split('_')[0], 10);
      if (done.has(version)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      applied.push(f);
    }
  });
  return applied;
}

if (require.main === module) {
  migrate()
    .then(applied => {
      console.log(applied.length ? 'Applied: ' + applied.join(', ') : 'Schema already up to date.');
      process.exit(0);
    })
    .catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
}

module.exports = { migrate };
