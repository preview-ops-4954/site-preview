'use strict';
// PostgreSQL store - drop-in adapter with the same interface as store.js.
// Every function returns the same plain-object shapes the handlers already
// use, so no route or view changes are needed. Activate with
// STORAGE_BACKEND=pg plus DATABASE_URL (see docs/persistence.md).
//
// Mapping notes:
// - orders.timeline lives in order_events (append-only) and is rebuilt on read.
// - payment_events is written automatically whenever payment_status flips or
//   a delivery release is granted/revoked - the audit trail cannot be skipped
//   by forgetting a timeline message.
// - updateOrder only patches whitelisted columns, matching the fields the
//   JSON store carries.
const pg = require('./pg');
const { STATUSES, normalizeOrder, deliveryUnlocked, newDeliveryToken } = require('./order-core');

// Fields an updateOrder patch may touch (column name = object key).
const PATCHABLE = [
  'agent_id', 'status', 'payment_status', 'stripe_session_id', 'credit',
  'customer', 'property', 'package_id', 'addon_ids', 'package_snapshot', 'addon_snapshots',
  'preferred_date', 'preferred_time', 'site', 'listing', 'delivery_release',
];
const JSON_COLS = new Set(['customer', 'property', 'addon_ids', 'package_snapshot', 'addon_snapshots', 'site', 'listing', 'delivery_release']);

function iso(t) { return t instanceof Date ? t.toISOString() : t; }

function rowToOrder(r, timeline) {
  return normalizeOrder({
    id: r.id,
    agent_id: r.agent_id,
    status: r.status,
    payment_status: r.payment_status,
    stripe_session_id: r.stripe_session_id,
    delivery_token: r.delivery_token,
    site_token: r.site_token,
    credit: r.credit,
    customer: r.customer || {},
    property: r.property || {},
    package_id: r.package_id,
    addon_ids: r.addon_ids || [],
    package_snapshot: r.package_snapshot || null,
    addon_snapshots: r.addon_snapshots || [],
    preferred_date: r.preferred_date || '',
    preferred_time: r.preferred_time || '',
    site: r.site,
    listing: r.listing,
    delivery_release: r.delivery_release,
    created_at: iso(r.created_at),
    timeline: timeline || [],
  });
}

const TIMELINE_SQL = `COALESCE((
  SELECT jsonb_agg(jsonb_build_object('at', e.at, 'event', e.event) ORDER BY e.id)
  FROM order_events e WHERE e.order_id = o.id), '[]'::jsonb) AS timeline`;

async function fetchOrder(where, param) {
  const r = await pg.query(`SELECT o.*, ${TIMELINE_SQL} FROM orders o WHERE ${where} LIMIT 1`, [param]);
  if (!r.rows.length) return null;
  const { timeline, ...row } = r.rows[0];
  return rowToOrder(row, (timeline || []).map(e => ({ at: iso(e.at), event: e.event })));
}

async function nextId(key, prefix) {
  const r = await pg.query(
    `INSERT INTO counters (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
     RETURNING value`, [key]);
  return prefix + '-' + r.rows[0].value;
}

// ---------- orders ----------

async function insertOrder(order) {
  const id = await nextId('order', 'JWRE');
  const now = new Date().toISOString();
  const rec = normalizeOrder({
    id,
    delivery_token: newDeliveryToken(),
    created_at: now,
    status: 'booked',
    payment_status: 'unpaid',
    stripe_session_id: null,
    ...order,
  });
  const timeline = Array.isArray(order.timeline) && order.timeline.length
    ? order.timeline
    : [{ at: now, event: 'Order placed' }];
  await pg.withTransaction(async (c) => {
    await c.query(
      `INSERT INTO orders (id, agent_id, status, payment_status, stripe_session_id,
         delivery_token, site_token, credit, customer, property, package_id, addon_ids,
         preferred_date, preferred_time, site, listing, delivery_release, created_at, package_snapshot, addon_snapshots)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [rec.id, rec.agent_id, rec.status, rec.payment_status, rec.stripe_session_id,
       rec.delivery_token, rec.site_token, rec.credit,
       JSON.stringify(rec.customer || {}), JSON.stringify(rec.property || {}),
       rec.package_id || null, JSON.stringify(rec.addon_ids || []),
       rec.preferred_date || '', rec.preferred_time || '',
       JSON.stringify(rec.site), JSON.stringify(rec.listing),
       rec.delivery_release ? JSON.stringify(rec.delivery_release) : null, rec.created_at,
       rec.package_snapshot ? JSON.stringify(rec.package_snapshot) : null, JSON.stringify(rec.addon_snapshots || [])]);
    for (const e of timeline) {
      await c.query('INSERT INTO order_events (order_id, at, event) VALUES ($1,$2,$3)',
        [rec.id, e.at || now, e.event]);
    }
  });
  return { ...rec, timeline };
}

async function getOrder(id) { return fetchOrder('o.id = $1', id); }
async function getOrderByToken(token) { return fetchOrder('o.delivery_token = $1', token); }
async function getOrderBySiteToken(token) { return fetchOrder('o.site_token = $1', token); }
async function getOrderByStripeSession(sessionId) {
  if (!sessionId) return null;
  return fetchOrder('o.stripe_session_id = $1', sessionId);
}

async function allOrders() {
  const r = await pg.query(`SELECT o.*, ${TIMELINE_SQL} FROM orders o ORDER BY o.created_at DESC`);
  return r.rows.map(({ timeline, ...row }) =>
    rowToOrder(row, (timeline || []).map(e => ({ at: iso(e.at), event: e.event }))));
}

async function ordersForAgent(agentId) {
  return (await allOrders()).filter(o => o.agent_id === agentId);
}

async function deleteOrder(id) {
  const r = await pg.query('DELETE FROM orders WHERE id = $1', [id]);
  return r.rowCount > 0;
}

async function updateOrder(id, patch, timelineEvent) {
  return pg.withTransaction(async (c) => {
    const cur = await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    if (!cur.rows.length) return null;
    const before = cur.rows[0];

    const sets = [];
    const vals = [];
    for (const key of PATCHABLE) {
      if (!(key in patch)) continue;
      vals.push(JSON_COLS.has(key) ? (patch[key] === null ? null : JSON.stringify(patch[key])) : patch[key]);
      sets.push(`${key} = $${vals.length}`);
    }
    if (sets.length) {
      vals.push(id);
      await c.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    }

    // Payment audit: record every state change on the money-bearing fields.
    if ('payment_status' in patch && patch.payment_status !== before.payment_status) {
      await c.query('INSERT INTO payment_events (order_id, kind, detail) VALUES ($1,$2,$3)',
        [id, patch.payment_status === 'paid' ? 'paid' : 'unpaid',
         JSON.stringify({ from: before.payment_status, to: patch.payment_status })]);
    }
    if ('delivery_release' in patch) {
      const was = Boolean(before.delivery_release);
      const is = Boolean(patch.delivery_release);
      if (!was && is) {
        await c.query('INSERT INTO payment_events (order_id, kind, detail) VALUES ($1,$2,$3)',
          [id, 'release_granted', JSON.stringify(patch.delivery_release)]);
      } else if (was && !is) {
        await c.query('INSERT INTO payment_events (order_id, kind, detail) VALUES ($1,$2,$3)',
          [id, 'release_revoked', JSON.stringify({ previous: before.delivery_release })]);
      }
    }

    if (timelineEvent) {
      await c.query('INSERT INTO order_events (order_id, event) VALUES ($1,$2)', [id, timelineEvent]);
    }

    const fresh = await c.query(`SELECT o.*, ${TIMELINE_SQL} FROM orders o WHERE o.id = $1`, [id]);
    const { timeline, ...row } = fresh.rows[0];
    return rowToOrder(row, (timeline || []).map(e => ({ at: iso(e.at), event: e.event })));
  });
}

// ---------- agents (real estate agent portal accounts) ----------

async function insertAgent({ name, email, phone, passwordHash, branding }) {
  const id = await nextId('agent', 'AGT');
  const rec = {
    id,
    name: name || '',
    email: String(email || '').trim().toLowerCase(),
    phone: phone || '',
    password_hash: passwordHash,
    branding: branding || {},
    created_at: new Date().toISOString(),
  };
  await pg.query(
    'INSERT INTO agents (id, name, email, phone, password_hash, branding, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [rec.id, rec.name, rec.email, rec.phone, rec.password_hash, JSON.stringify(rec.branding), rec.created_at]);
  return rec;
}

async function getAgent(id) {
  const r = await pg.query('SELECT * FROM agents WHERE id = $1', [id]);
  return r.rows.length ? { ...r.rows[0], created_at: iso(r.rows[0].created_at) } : null;
}

async function getAgentByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const r = await pg.query('SELECT * FROM agents WHERE email = $1', [e]);
  return r.rows.length ? { ...r.rows[0], created_at: iso(r.rows[0].created_at) } : null;
}

async function allAgents() {
  const r = await pg.query('SELECT * FROM agents ORDER BY created_at ASC');
  return r.rows.map(row => ({ ...row, created_at: iso(row.created_at) }));
}

async function updateAgent(id, patch) {
  const allowed = ['name', 'email', 'phone', 'password_hash', 'branding', 'session_version'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (!(key in patch)) continue;
    vals.push(key === 'branding' ? JSON.stringify(patch[key]) : patch[key]);
    sets.push(`${key} = $${vals.length}`);
  }
  if (!sets.length) return getAgent(id);
  vals.push(id);
  const r = await pg.query(`UPDATE agents SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  return r.rows.length ? { ...r.rows[0], created_at: iso(r.rows[0].created_at) } : null;
}


async function insertStudioUser({ name, email, passwordHash, role = 'photographer', mustChangePassword = true }) {
  const r = await pg.query(`INSERT INTO studio_users (name,email,password_hash,role,must_change_password)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`, [name, String(email).trim().toLowerCase(), passwordHash, role, mustChangePassword]);
  return r.rows[0];
}
async function getStudioUser(id) {
  const r = await pg.query('SELECT * FROM studio_users WHERE id = $1', [id]); return r.rows[0] || null;
}
async function getStudioUserByEmail(email) {
  const r = await pg.query('SELECT * FROM studio_users WHERE lower(email) = lower($1)', [String(email || '').trim()]); return r.rows[0] || null;
}
async function allStudioUsers() {
  const r = await pg.query('SELECT * FROM studio_users ORDER BY role DESC, created_at ASC'); return r.rows;
}
async function updateStudioUser(id, patch) {
  const allowed = ['name','email','password_hash','role','active','must_change_password','session_version','last_login_at'];
  const sets=[], vals=[];
  for (const key of allowed) if (key in patch) { vals.push(patch[key]); sets.push(`${key} = $${vals.length}`); }
  if (!sets.length) return getStudioUser(id);
  vals.push(id); const r=await pg.query(`UPDATE studio_users SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length} RETURNING *`, vals); return r.rows[0] || null;
}
async function countActiveOwners() {
  const r=await pg.query("SELECT count(*)::int AS n FROM studio_users WHERE active=true AND role='owner'"); return r.rows[0].n;
}
async function addStudioAudit({ actorId=null, event, targetId=null, detail={}, ip=null }) {
  await pg.query('INSERT INTO studio_audit_events (actor_id,event,target_id,detail,ip) VALUES ($1,$2,$3,$4,$5)', [actorId,event,targetId,JSON.stringify(detail),ip]);
}
async function recentStudioAudit(limit=30) {
  const r=await pg.query(`SELECT a.*, u.name AS actor_name, t.name AS target_name FROM studio_audit_events a
    LEFT JOIN studio_users u ON u.id=a.actor_id LEFT JOIN studio_users t ON t.id=a.target_id ORDER BY a.created_at DESC LIMIT $1`, [limit]); return r.rows;
}


async function createRecoveryToken({ portal, accountId, tokenHash, expiresAt, ip=null }) {
  await pg.query('UPDATE account_recovery_tokens SET used_at=now() WHERE portal=$1 AND account_id=$2 AND used_at IS NULL', [portal,String(accountId)]);
  const r=await pg.query(`INSERT INTO account_recovery_tokens (portal,account_id,token_hash,expires_at,requested_ip) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [portal,String(accountId),tokenHash,expiresAt,ip]); return r.rows[0];
}
async function consumeRecoveryToken({ portal, tokenHash }) {
  return pg.withTransaction(async c=>{ const r=await c.query(`SELECT * FROM account_recovery_tokens WHERE portal=$1 AND token_hash=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE`,[portal,tokenHash]); if(!r.rows[0])return null; await c.query('UPDATE account_recovery_tokens SET used_at=now() WHERE id=$1',[r.rows[0].id]); return r.rows[0]; });
}

async function allCatalog(includeInactive=false) {
  const r=await pg.query(`SELECT id,kind,name,tagline,includes,price_cents AS "priceCents",featured,active,sort_order FROM service_catalog ${includeInactive?'':'WHERE active=true'} ORDER BY kind,sort_order,name`); return r.rows;
}
async function getCatalogItem(id) { const r=await pg.query('SELECT id,kind,name,tagline,includes,price_cents AS "priceCents",featured,active,sort_order FROM service_catalog WHERE id=$1',[id]);return r.rows[0]||null; }
async function saveCatalogItem(x) { const r=await pg.query(`INSERT INTO service_catalog(id,kind,name,tagline,includes,price_cents,featured,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind,name=EXCLUDED.name,tagline=EXCLUDED.tagline,includes=EXCLUDED.includes,price_cents=EXCLUDED.price_cents,featured=EXCLUDED.featured,active=EXCLUDED.active,sort_order=EXCLUDED.sort_order,updated_at=now() RETURNING id,kind,name,tagline,includes,price_cents AS "priceCents",featured,active,sort_order`,[x.id,x.kind,x.name,x.tagline||'',JSON.stringify(x.includes||[]),x.priceCents||0,!!x.featured,x.active!==false,x.sort_order||0]);return r.rows[0]; }

module.exports = {
  STATUSES, deliveryUnlocked,
  insertOrder, getOrder, getOrderByToken, getOrderBySiteToken, getOrderByStripeSession,
  allOrders, ordersForAgent, updateOrder, deleteOrder,
  insertAgent, getAgent, getAgentByEmail, allAgents, updateAgent,
  insertStudioUser, getStudioUser, getStudioUserByEmail, allStudioUsers, updateStudioUser, countActiveOwners, addStudioAudit, recentStudioAudit, createRecoveryToken, consumeRecoveryToken, allCatalog, getCatalogItem, saveCatalogItem,
};
