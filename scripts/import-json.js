'use strict';
// One-time backfill: import the JSON store (data/db.json) into Postgres.
// Idempotent - existing agent and order ids are skipped, so it is safe to
// re-run. Preserves ids, tokens, timestamps, and the full order timeline.
// Does NOT fabricate payment_events: historical payment history lives in
// the timeline; the audit table starts collecting from the cutover on.
//
// Usage: DATABASE_URL=... node scripts/import-json.js [path-to-db.json]
const fs = require('fs');
const path = require('path');
const pg = require('../src/pg');
const { migrate } = require('../db/migrate');
const { normalizeOrder } = require('../src/order-core');

const FILE = process.argv[2] || path.join(__dirname, '..', 'data', 'db.json');

async function main() {
  if (!fs.existsSync(FILE)) {
    console.log('No JSON store at ' + FILE + ' - nothing to import.');
    return;
  }
  const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  await migrate();

  let agentsIn = 0, ordersIn = 0, eventsIn = 0, skipped = 0;
  await pg.withTransaction(async (c) => {
    for (const a of db.agents || []) {
      const r = await c.query(
        `INSERT INTO agents (id, name, email, phone, password_hash, branding, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [a.id, a.name || '', String(a.email || '').trim().toLowerCase(), a.phone || '',
         a.password_hash, JSON.stringify(a.branding || {}), a.created_at || new Date().toISOString()]);
      r.rowCount ? agentsIn++ : skipped++;
    }
    for (const raw of db.orders || []) {
      const o = normalizeOrder({ ...raw });
      const r = await c.query(
        `INSERT INTO orders (id, agent_id, status, payment_status, stripe_session_id,
           delivery_token, site_token, credit, customer, property, package_id, addon_ids,
           preferred_date, preferred_time, site, listing, delivery_release, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO NOTHING`,
        [o.id, o.agent_id || null, o.status, o.payment_status, o.stripe_session_id || null,
         o.delivery_token, o.site_token, o.credit,
         JSON.stringify(o.customer || {}), JSON.stringify(o.property || {}),
         o.package_id || null, JSON.stringify(o.addon_ids || []),
         o.preferred_date || '', o.preferred_time || '',
         JSON.stringify(o.site), JSON.stringify(o.listing),
         o.delivery_release ? JSON.stringify(o.delivery_release) : null,
         o.created_at || new Date().toISOString()]);
      if (!r.rowCount) { skipped++; continue; }
      ordersIn++;
      for (const e of o.timeline || []) {
        await c.query('INSERT INTO order_events (order_id, at, event) VALUES ($1,$2,$3)',
          [o.id, e.at || new Date().toISOString(), e.event]);
        eventsIn++;
      }
    }
    // Counters must stay ahead of every imported id so new records never collide.
    const maxNum = (ids, prefix) => ids.reduce((m, id) => {
      const n = parseInt(String(id).replace(prefix + '-', ''), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    const orderMax = Math.max(1000, maxNum((db.orders || []).map(o => o.id), 'JWRE'));
    const agentMax = Math.max(100, maxNum((db.agents || []).map(a => a.id), 'AGT'));
    await c.query(
      `INSERT INTO counters (key, value) VALUES ('order',$1), ('agent',$2)
       ON CONFLICT (key) DO UPDATE SET value = GREATEST(counters.value, EXCLUDED.value)`,
      [orderMax, agentMax]);
  });
  console.log(`Imported ${agentsIn} agents, ${ordersIn} orders, ${eventsIn} timeline events (${skipped} already present, skipped).`);
}

main().catch(err => { console.error('Import failed:', err.message); process.exit(1); });
