'use strict';
// Postgres adapter conformance test. Runs only when TEST_DATABASE_URL is
// set - e.g. against the Supabase project during cutover rehearsal:
//   TEST_DATABASE_URL=postgres://... node --test test/store-pg.test.js
// Uses its own throwaway data and cleans up after itself.
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const URL = process.env.TEST_DATABASE_URL;
if (!URL) {
  test('store-pg conformance (skipped: set TEST_DATABASE_URL to run)', (t) => {
    t.skip('no TEST_DATABASE_URL');
  });
} else {
  process.env.DATABASE_URL = URL;
  process.env.STORAGE_BACKEND = 'pg';
  const store = require('../src/store-pg');
  const pg = require('../src/pg');
  const { migrate } = require('../db/migrate');

  let agent;
  let orderId;

  before(async () => {
    await migrate();
    agent = await store.insertAgent({
      name: 'Test Agent', email: 'test-agent@example.com',
      phone: '512-555-0100', passwordHash: 'x', branding: { display_name: 'Test' },
    });
  });

  after(async () => {
    if (orderId) await store.deleteOrder(orderId);
    await pg.query('DELETE FROM agents WHERE id = $1', [agent.id]);
    process.exit(0); // close the pool
  });

  test('order lifecycle: insert, lookup by every token, timeline', async () => {
    const o = await store.insertOrder({
      customer: { name: 'T', email: 't@example.com', phone: '' },
      property: { address: '1 Test Ln', city: 'Austin', zip: '78701', sqft: '', notes: '' },
      package_id: 'essential', addon_ids: ['twilight'],
      preferred_date: '2026-09-20', preferred_time: '10:00',
      agent_id: agent.id,
    });
    orderId = o.id;
    assert.match(o.id, /^JWRE-\d+$/);
    assert.strictEqual(o.status, 'booked');
    assert.strictEqual(o.payment_status, 'unpaid');
    assert.strictEqual(o.timeline.length, 1);

    assert.strictEqual((await store.getOrder(o.id)).id, o.id);
    assert.strictEqual((await store.getOrderByToken(o.delivery_token)).id, o.id);
    assert.strictEqual((await store.getOrderBySiteToken(o.site_token)).id, o.id);

    await store.updateOrder(o.id, { stripe_session_id: 'cs_test_123' });
    assert.strictEqual((await store.getOrderByStripeSession('cs_test_123')).id, o.id);
  });

  test('payment flips write payment_events audit rows', async () => {
    await store.updateOrder(orderId, { payment_status: 'paid' }, 'Payment received via Stripe');
    await store.updateOrder(orderId, { payment_status: 'unpaid' }, 'Payment marked unpaid');
    await store.updateOrder(orderId, {
      delivery_release: { reason: 'good faith', by: 'JWRE Studio', at: new Date().toISOString() },
    }, 'Delivery released without payment');
    await store.updateOrder(orderId, { delivery_release: null }, 'Release revoked');

    const r = await pg.query('SELECT kind FROM payment_events WHERE order_id = $1 ORDER BY id', [orderId]);
    assert.deepStrictEqual(r.rows.map(x => x.kind),
      ['paid', 'unpaid', 'release_granted', 'release_revoked']);

    const o = await store.getOrder(orderId);
    assert.deepStrictEqual(o.timeline.map(e => e.event), [
      'Order placed', 'Payment received via Stripe', 'Payment marked unpaid',
      'Delivery released without payment', 'Release revoked',
    ]);
  });

  test('gate: deliveryUnlocked follows payment or release', async () => {
    let o = await store.getOrder(orderId);
    assert.strictEqual(store.deliveryUnlocked(o), false);
    await store.updateOrder(orderId, { payment_status: 'paid' });
    o = await store.getOrder(orderId);
    assert.strictEqual(store.deliveryUnlocked(o), true);
    await store.updateOrder(orderId, { payment_status: 'unpaid' });
  });

  test('ordersForAgent and allOrders ordering', async () => {
    const mine = await store.ordersForAgent(agent.id);
    assert.ok(mine.some(o => o.id === orderId));
    const all = await store.allOrders();
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i - 1].created_at >= all[i].created_at);
    }
  });

  test('agent CRUD and email uniqueness shape', async () => {
    const a = await store.getAgentByEmail('TEST-AGENT@example.com');
    assert.strictEqual(a.id, agent.id);
    await store.updateAgent(agent.id, { phone: '512-555-0199' });
    assert.strictEqual((await store.getAgent(agent.id)).phone, '512-555-0199');
    assert.ok((await store.allAgents()).some(x => x.id === agent.id));
  });

  test('deleteOrder cascades events', async () => {
    const tmp = await store.insertOrder({ customer: { name: 'D', email: 'd@example.com' } });
    await store.updateOrder(tmp.id, {}, 'about to be deleted');
    assert.strictEqual(await store.deleteOrder(tmp.id), true);
    assert.strictEqual(await store.getOrder(tmp.id), null);
    const r = await pg.query('SELECT count(*)::int AS n FROM order_events WHERE order_id = $1', [tmp.id]);
    assert.strictEqual(r.rows[0].n, 0);
  });
}
