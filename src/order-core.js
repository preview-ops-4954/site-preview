'use strict';
// Shared order semantics for every storage backend (JSON file, Postgres).
// Keep this dependency-free: both store.js and store-pg.js require it.
const crypto = require('crypto');

const STATUSES = ['booked', 'scheduled', 'shot', 'editing', 'delivered', 'paid'];

// Older records gain new fields lazily so nothing breaks on upgrade.
function normalizeOrder(o) {
  if (!o.site_token) o.site_token = crypto.randomBytes(12).toString('hex');
  if (o.agent_id === undefined) o.agent_id = null;
  if (!o.credit) o.credit = 'JWRE Media';
  if (!o.site || typeof o.site !== 'object') o.site = { selected: null, published: true };
  if (o.site.selected === undefined) o.site.selected = null; // null = not curated yet, show all delivered
  if (o.site.published === undefined) o.site.published = true;
  if (o.package_snapshot === undefined) o.package_snapshot = null;
  if (!Array.isArray(o.addon_snapshots)) o.addon_snapshots = [];
  if (!o.listing || typeof o.listing !== 'object') o.listing = {}; // agent-entered public listing facts
  if (o.delivery_release === undefined) o.delivery_release = null; // photographer override: deliver before payment
  return o;
}

// Delivery access rule, shared by every surface that can expose deliverables:
// originals, zips, and the public property site stay locked until the order
// is paid or the photographer releases it deliberately (delivery_release).
function deliveryUnlocked(order) {
  return Boolean(order) && (order.payment_status === 'paid' || Boolean(order.delivery_release));
}

function newDeliveryToken() { return crypto.randomBytes(18).toString('hex'); }

module.exports = { STATUSES, normalizeOrder, deliveryUnlocked, newDeliveryToken };
