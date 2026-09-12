'use strict';
// Thin PostgreSQL connection layer for the Supabase free-tier database.
// `pg` is the only dependency this adds; it is loaded lazily so the app
// still boots on the JSON backend without it installed.
const config = require('./config');

let pool = null;

function getPool() {
  if (pool) return pool;
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set');
  let Pool;
  try { ({ Pool } = require('pg')); }
  catch { throw new Error('The "pg" package is required for STORAGE_BACKEND=pg. Run: npm install'); }
  const local = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 4, // Supabase free tier: small pool, the app is low-traffic
    ssl: local ? false : { rejectUnauthorized: false },
  });
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

// Run fn(client) inside a transaction; rolls back on any throw.
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, withTransaction };
