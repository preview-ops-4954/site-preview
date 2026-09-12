'use strict';
// Optional link-based media on public property websites:
// YouTube/Vimeo video links and Matterport/Zillow 3D tour links embed on the
// site; invalid links are rejected at save; photo-only listings render no
// media section at all.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseMediaUrl } = require('../src/media');

const PORT = 3900 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jwre-media-test-'));
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

let agent;

before(async () => {
  await startServer();
  agent = client();
  const r = await agent('/portal/login', form({ email: 'dana.rivera@example.com', password: AGENT_PW }));
  assert.equal(r.status, 303, 'agent login');
});

after(() => { if (child) child.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

test('parseMediaUrl canonicalizes supported providers', () => {
  assert.equal(parseMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ').embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(parseMediaUrl('https://vimeo.com/76979871').embedUrl, 'https://player.vimeo.com/video/76979871');
  assert.equal(parseMediaUrl('https://my.matterport.com/show/?m=9gF1g2aTcYU&mls=1').embedUrl, 'https://my.matterport.com/show/?m=9gF1g2aTcYU');
  assert.equal(parseMediaUrl('https://www.zillow.com/view-3d-home/c57d459f-6459-49af-9fb8-78eddc8e57ab/?setAttribution=mls').embedUrl, 'https://www.zillow.com/view-3d-home/c57d459f-6459-49af-9fb8-78eddc8e57ab/');
  assert.equal(parseMediaUrl('https://my.matterport.com/show/?m=9gF1g2aTcYU').kind, 'tour');
  assert.equal(parseMediaUrl('https://vimeo.com/76979871').kind, 'video');
});

test('parseMediaUrl rejects unsupported or unsafe input', () => {
  for (const bad of ['https://evil.com/embed/x', 'javascript:alert(1)', 'ftp://youtu.be/dQw4w9WgXcQ', 'not a url', 'https://www.youtube.com/', '', '   ']) {
    assert.equal(parseMediaUrl(bad), null, bad);
  }
});

test('seeded demo listing carries a tour link', () => {
  const o = deliveredOrder();
  assert.ok(o.listing && o.listing.tour_url, 'seed includes tour_url');
  const t = parseMediaUrl(o.listing.tour_url);
  assert.equal(t && t.kind, 'tour');
});

test('property site embeds valid media and rejects invalid links', async () => {
  const o = deliveredOrder();
  // Save a YouTube video link alongside the seeded tour.
  let r = await agent(`/portal/orders/${o.id}/details`, form({
    description: o.listing.description, price: o.listing.price, beds: o.listing.beds,
    baths: o.listing.baths, sqft: o.listing.sqft, lot_size: o.listing.lot_size,
    year_built: o.listing.year_built, property_type: o.listing.property_type,
    video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    tour_url: o.listing.tour_url,
  }));
  assert.equal(r.status, 200, 'valid media links save');
  r = await agent(`/site/${o.site_token}`);
  const html = await r.text();
  assert.ok(html.includes('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'video embed rendered');
  assert.ok(html.includes('https://my.matterport.com/show/?m=9gF1g2aTcYU'), 'tour embed rendered');
  assert.ok(html.includes('Listing video') && html.includes('3D tour'), 'media labels rendered');
  // Invalid provider is rejected and nothing is overwritten.
  r = await agent(`/portal/orders/${o.id}/details`, form({ video_url: 'https://evil.com/v.mp4' }));
  assert.equal(r.status, 422, 'invalid video link rejected');
  const after422 = db().orders.find(x => x.id === o.id);
  assert.equal(after422.listing.video_url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'existing video link preserved on rejection');
  // A tour link in the video slot is rejected too (wrong media kind).
  r = await agent(`/portal/orders/${o.id}/details`, form({ video_url: 'https://my.matterport.com/show/?m=9gF1g2aTcYU' }));
  assert.equal(r.status, 422, 'tour link not accepted as video');
});

test('photo-only listing renders no media section', async () => {
  const o = deliveredOrder();
  const r = await agent(`/portal/orders/${o.id}/details`, form({
    description: o.listing.description, price: o.listing.price, beds: o.listing.beds,
    baths: o.listing.baths, sqft: o.listing.sqft, lot_size: o.listing.lot_size,
    year_built: o.listing.year_built, property_type: o.listing.property_type,
    video_url: '', tour_url: '',
  }));
  assert.equal(r.status, 200, 'clearing media links saves');
  const r2 = await agent(`/site/${o.site_token}`);
  const html = await r2.text();
  assert.ok(!html.includes('<iframe'), 'no iframes when no media links');
  assert.ok(!html.includes('psite-media'), 'no media section markup');
  assert.ok(!html.includes('\u2014'), 'no em dash on the property site');
  assert.ok(html.includes('psite-facts'), 'facts strip still rendered');
});
