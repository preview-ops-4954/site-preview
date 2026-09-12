'use strict';
// Regression tests for payment-gated delivery:
// originals, zips, site publishing, and unwatermarked URLs stay locked until
// paid or released by the photographer; watermarked previews are the only
// thing an unpaid agent can see.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3900 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jwre-test-'));
const ADMIN_PW = 'test-admin-pw';
const AGENT_PW = 'test-agent-pw';

let child;

function startServer() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR,
        ADMIN_PASSWORD: ADMIN_PW,
        DEMO_AGENT_PASSWORD: AGENT_PW,
        SESSION_SECRET: 'test-secret',
        BASE_URL: BASE,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', d => process.stderr.write(d));
    const to = setTimeout(() => reject(new Error('server did not start')), 30000);
    child.stdout.on('data', d => {
      if (String(d).includes('listening')) { clearTimeout(to); resolve(); }
    });
  });
}

function db() { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8')); }
function deliveredOrder() { return db().orders.find(o => o.status === 'delivered' || o.status === 'paid'); }

// Minimal cookie-aware fetch helper.
function client(jar = {}) {
  return async function fetch2(url, opts = {}) {
    const res = await fetch(BASE + url, {
      redirect: 'manual',
      ...opts,
      headers: {
        ...(opts.headers || {}),
        cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
      },
    });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    return res;
  };
}
const form = obj => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj).toString() });

let admin, agent;
let firstFile;

before(async () => {
  await startServer();
  admin = client();
  agent = client();
  let r = await admin('/admin/login', form({ email: 'wyrick.jt@gmail.com', password: ADMIN_PW }));
  assert.equal(r.status, 303, 'admin login');
  r = await agent('/portal/login', form({ email: 'dana.rivera@example.com', password: AGENT_PW }));
  assert.equal(r.status, 303, 'agent login');
  const o = deliveredOrder();
  firstFile = fs.readdirSync(path.join(DATA_DIR, 'deliveries', o.id)).filter(f => !f.startsWith('.')).sort()[0];
  assert.ok(firstFile, 'seed delivered files exist');
});

after(() => { if (child) child.kill('SIGKILL'); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

test('paid order: originals, zip, and property site are open', async () => {
  const o = deliveredOrder();
  assert.equal(o.payment_status, 'paid', 'seed delivered order starts paid');
  let r = await agent(`/files/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 200, 'original file served while paid');
  r = await agent(`/portal/orders/${o.id}/download.zip`);
  assert.equal(r.status, 200, 'zip served while paid');
  assert.equal(r.headers.get('content-type'), 'application/zip');
  r = await fetch(`${BASE}/site/${o.site_token}`);
  const html = await r.text();
  assert.ok(html.includes('/sitefiles/'), 'property site live while paid');
  assert.ok(!html.includes('download'), 'property site is view-only: no download links or attributes');
  assert.ok(!html.includes('data-download'), 'property site lightbox has no Download Original');
  // unlocked public gallery: view-only as well, downloads only in the portal
  r = await fetch(`${BASE}/gallery/${o.delivery_token}`);
  const gal = await r.text();
  assert.ok(!gal.includes(' download>') && !gal.includes('download.zip'), 'public gallery has no download links');
  assert.ok(gal.includes('agent portal'), 'gallery points to portal for downloads');
  // portal keeps original + zip downloads and opts in to lightbox downloads
  r = await agent(`/portal/orders/${o.id}`);
  const portal = await r.text();
  assert.ok(portal.includes('data-download="1"'), 'portal lightbox offers Download original');
  assert.ok(portal.includes('download.zip'), 'portal keeps zip download');
});

test('mark unpaid: every deliverable locks, previews survive, nothing leaks', async () => {
  const o = deliveredOrder();
  let r = await admin(`/admin/orders/${o.id}/payment`, form({ payment_status: 'unpaid' }));
  assert.equal(r.status, 303, 'mark unpaid');

  // Originals blocked for agent and public, even by direct URL.
  r = await agent(`/files/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 403, 'original blocked for agent while locked');
  const lockedHtml = await r.text();
  assert.ok(!lockedHtml.includes('/files/' + o.delivery_token), 'locked page carries no original URLs');
  r = await fetch(`${BASE}/files/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 403, 'original blocked for anonymous visitor');

  // Admin (photographer) can still proof originals.
  r = await admin(`/files/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 200, 'photographer still proofs originals');

  // ZIP blocked.
  r = await agent(`/portal/orders/${o.id}/download.zip`);
  assert.equal(r.status, 303, 'zip refused while locked');
  assert.ok((r.headers.get('location') || '').endsWith(`/portal/orders/${o.id}`));

  // Property site goes dark, even though it was published.
  r = await fetch(`${BASE}/site/${o.site_token}`);
  const siteHtml = await r.text();
  assert.ok(siteHtml.includes('Not live yet'), 'property site dark while locked');
  assert.ok(!siteHtml.includes('/sitefiles/'), 'property site exposes no file URLs');
  r = await fetch(`${BASE}/sitefiles/${o.site_token}/${firstFile}`);
  assert.equal(r.status, 404, 'sitefiles blocked while locked');

  // Site photo picker is closed while locked (it renders originals).
  r = await agent(`/portal/orders/${o.id}/site`);
  assert.equal(r.status, 303, 'site editor closed while locked');

  // Portal order page: previews only, no original URLs, no zip link.
  r = await agent(`/portal/orders/${o.id}`);
  const portalHtml = await r.text();
  assert.ok(portalHtml.includes('/previews/'), 'portal shows watermarked previews');
  assert.ok(portalHtml.includes('watermarked'), 'previews labeled watermarked');
  assert.ok(!portalHtml.includes(`/files/${o.delivery_token}`), 'portal exposes no original URLs');
  assert.ok(!portalHtml.includes('download.zip'), 'portal shows no zip link');
  assert.ok(!portalHtml.includes('data-download'), 'locked previews offer no Download Original');

  // Public gallery: previews and locked notice, no original URLs.
  r = await fetch(`${BASE}/gallery/${o.delivery_token}`);
  const galHtml = await r.text();
  assert.ok(galHtml.includes('/previews/'), 'gallery shows previews while locked');
  assert.ok(!galHtml.includes(`/files/${o.delivery_token}`), 'gallery exposes no original URLs');

  // The preview itself: real jpeg, capped resolution, different bytes.
  r = await agent(`/previews/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 200, 'preview served while locked');
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  const buf = Buffer.from(await r.arrayBuffer());
  const sharp = require('sharp');
  const meta = await sharp(buf).metadata();
  assert.ok(meta.width <= 1400 && meta.height <= 1400, 'preview resolution capped');
  const original = fs.readFileSync(path.join(DATA_DIR, 'deliveries', o.id, firstFile));
  assert.ok(!buf.equals(original), 'preview is a derivative, not the original bytes');
});

test('photographer override: reason required, releases and re-locks cleanly', async () => {
  const o = deliveredOrder();

  // Reason is mandatory.
  let r = await admin(`/admin/orders/${o.id}/release`, form({ reason: '' }));
  assert.equal(r.status, 422, 'release without reason rejected');
  r = await admin(`/admin/orders/${o.id}/release`, form({ reason: 'ab' }));
  assert.equal(r.status, 422, 'too-short reason rejected');
  r = await agent(`/files/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 403, 'still locked after rejected releases');

  // Grant with a reason: audit trail records who and why.
  r = await admin(`/admin/orders/${o.id}/release`, form({ reason: 'Trusted client, pays on monthly invoice' }));
  assert.equal(r.status, 303, 'release granted');
  let rec = deliveredOrder();
  assert.equal(rec.delivery_release.reason, 'Trusted client, pays on monthly invoice');
  assert.equal(rec.delivery_release.by, 'JWRE Studio');
  assert.ok(rec.delivery_release.at, 'release timestamp recorded');
  assert.ok(rec.timeline.some(t => t.event.includes('released without payment') && t.event.includes('Trusted client')), 'timeline audit entry');

  // Unlocked: originals, zip, site.
  r = await agent(`/files/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 200, 'originals open after release');
  r = await agent(`/portal/orders/${o.id}/download.zip`);
  assert.equal(r.status, 200, 'zip open after release');
  r = await fetch(`${BASE}/site/${o.site_token}`);
  assert.ok((await r.text()).includes('/sitefiles/'), 'site live after release');
  r = await agent(`/previews/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 404, 'preview endpoint closes once unlocked');

  // Revoke: locks again even though nothing about payment changed.
  r = await admin(`/admin/orders/${o.id}/release/revoke`, form({}));
  assert.equal(r.status, 303, 'release revoked');
  rec = deliveredOrder();
  assert.equal(rec.delivery_release, null, 'release cleared');
  assert.ok(rec.timeline.some(t => t.event.includes('revoked')), 'revoke recorded');
  r = await agent(`/files/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 403, 'revocation re-locks originals');
  r = await fetch(`${BASE}/site/${o.site_token}`);
  assert.ok((await r.text()).includes('Not live yet'), 'revocation takes site dark');

  // Agents cannot grant themselves a release.
  r = await agent(`/admin/orders/${o.id}/release`, form({ reason: 'self service' }));
  assert.equal(r.status, 303, 'unauthenticated admin post redirected');
  assert.equal(deliveredOrder().delivery_release, null, 'no self-release');
});

test('payment transitions: mark paid unlocks, mark unpaid re-locks', async () => {
  const o = deliveredOrder();
  let r = await admin(`/admin/orders/${o.id}/payment`, form({ payment_status: 'paid' }));
  assert.equal(r.status, 303);
  r = await agent(`/files/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 200, 'paid unlocks originals');
  r = await admin(`/admin/orders/${o.id}/payment`, form({ payment_status: 'unpaid' }));
  assert.equal(r.status, 303);
  r = await agent(`/files/${o.delivery_token}/${firstFile}`);
  assert.equal(r.status, 403, 'unpaid re-locks originals');
  // restore paid so later runs of the suite stay order-independent
  await admin(`/admin/orders/${o.id}/payment`, form({ payment_status: 'paid' }));
});

test('cross-agent isolation holds under the gate', async () => {
  // A second agent has no access to Dana's order, locked or unlocked.
  let r = await admin('/admin/clients', form({ name: 'Other Agent', email: 'other@example.com', phone: '' }));
  assert.equal(r.status, 200);
  const html = await r.text();
  const pw = html.match(/<code class="cred">([^<]+)<\/code>/)[1];
  const other = client();
  r = await other('/portal/login', form({ email: 'other@example.com', password: pw }));
  assert.equal(r.status, 303, 'second agent login');
  const o = deliveredOrder();
  r = await other(`/portal/orders/${o.id}`);
  assert.equal(r.status, 404, 'order page hidden from other agents');
  r = await other(`/portal/orders/${o.id}/download.zip`);
  assert.equal(r.status, 404, 'zip hidden from other agents');
  r = await other(`/portal/orders/${o.id}/details`);
  assert.equal(r.status, 404, 'details hidden from other agents');
});

test('admin order delete: refuses while files exist, removes empty orders', async () => {
  const o = deliveredOrder();
  let r = await admin(`/admin/orders/${o.id}/delete`, form({}));
  assert.equal(r.status, 422, 'delete refused while delivered files exist');
  assert.ok(db().orders.some(x => x.id === o.id), 'order still present after refusal');

  // Booking requires an authenticated agent; identity comes from the account.
  r = await fetch(BASE + '/book', { redirect: 'manual', ...form({
    address: '1 Delete Test Ln', package_id: 'essential',
  })});
  assert.equal(r.status, 303, 'signed-out booking redirects to login');
  assert.ok((r.headers.get('location') || '').startsWith('/portal/login'), 'redirected to portal login');
  assert.ok(!db().orders.some(x => x.property.address === '1 Delete Test Ln'), 'no order without auth');
  r = await agent('/book', form({
    address: '1 Delete Test Ln', city: 'Austin', zip: '78701', sqft: '',
    package_id: 'essential', preferred_date: '', preferred_time: '',
    name: 'Forged Name', email: 'forged@example.com', phone: '', notes: '',
  }));
  assert.equal(r.status, 303, 'booking accepted');
  const doomed = db().orders.find(x => x.property.address === '1 Delete Test Ln');
  assert.ok(doomed, 'test order created');
  assert.equal(doomed.customer.email, 'dana.rivera@example.com', 'identity comes from the account, not the form');
  assert.equal(doomed.customer.name, 'Dana Rivera (demo)', 'no free-text identity override');
  assert.equal(doomed.agent_id, db().agents.find(a => a.email === 'dana.rivera@example.com').id, 'order attached to canonical agent record');
  r = await admin(`/admin/orders/${doomed.id}/delete`, form({}));
  assert.equal(r.status, 303, 'empty order deleted');
  assert.ok(!db().orders.some(x => x.id === doomed.id), 'order removed from store');
  r = await admin(`/admin/orders/${doomed.id}`);
  assert.equal(r.status, 404, 'order page gone');
});

test('no em dashes in rendered product copy', async () => {
  for (const url of ['/', '/portfolio', '/services', '/book', '/portal/login', '/admin/login']) {
    const r = await fetch(BASE + url);
    const html = await r.text();
    assert.ok(!html.includes('\u2014'), `no em dash on ${url}`);
  }
});

test('launch kit exposes three photo sizes, two sites, media links, and a QR code', async () => {
  const o = deliveredOrder();
  await admin(`/admin/orders/${o.id}/payment`, form({ payment_status: 'paid' }));
  let r = await agent(`/portal/orders/${o.id}`);
  const html = await r.text();
  assert.match(html, /Listing Launch Kit/);
  assert.match(html, /Full resolution/);
  assert.match(html, /MLS size/);
  assert.match(html, /Web size/);
  assert.match(html, /Branded site/);
  assert.match(html, /Unbranded site/);
  assert.match(html, /QR code/);

  for (const size of ['mls', 'web']) {
    r = await agent(`/portal/orders/${o.id}/download/${size}.zip`);
    assert.equal(r.status, 200, `${size} zip served`);
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.match(r.headers.get('content-disposition') || '', new RegExp(`${size}\\.zip`));
  }
  r = await fetch(`${BASE}/site/${o.site_token}/qr.svg`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /image\/svg\+xml/);
  assert.match(await r.text(), /<svg/);

  const branded = await (await fetch(`${BASE}/site/${o.site_token}`)).text();
  const unbranded = await (await fetch(`${BASE}/site/${o.site_token}/unbranded`)).text();
  assert.match(branded, /Listed by/);
  assert.doesNotMatch(unbranded, /Listed by|Photography by/);
  assert.match(unbranded, /1120 Demo Farmhouse Ln/);
});
