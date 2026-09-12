'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const store = require('./store');
const stripe = require('./stripe');
const mail = require('./mail');
const ics = require('./ics');
const views = require('./views');
const adminViews = require('./admin-views');
const agentViews = require('./agent-views');
const media = require('./media');
const auth = require('./auth');
const { parseMultipart, sanitizeFilename } = require('./upload');
const { buildZip } = require('./zip');
const previews = require('./preview');
const QRCode = require('qrcode');
const esc = views.esc;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  let payload = isObj ? JSON.stringify(body) : body;
  // Anchor every relative URL to the public origin. When a page is saved and
  // opened from a local file (e.g. WhatsApp delivering the link as a document),
  // root-relative /static/... assets would otherwise resolve against the local
  // content:// or file:// origin and the page renders unstyled with broken images.
  if (!isObj && typeof payload === 'string' && res.jwreOrigin && payload.includes('<head>')) {
    payload = payload
      .replace('<head>', '<head><base href="' + res.jwreOrigin + '/">')
      .split('__ORIGIN__').join(res.jwreOrigin);
  }
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json' : 'text/html; charset=utf-8', ...headers });
  res.end(payload);
}
const redirect = (res, loc) => { res.writeHead(303, { Location: loc }); res.end(); };
const notFound = res => send(res, 404, views.layout('Not found', '<section class="section narrow"><h1>404</h1><p>Page not found.</p></section>'));

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(c => {
    const i = c.indexOf('='); return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
}
async function currentStudioUser(req) {
  const session = auth.verifyStudioSession(parseCookies(req).jwre_studio);
  if (!session) return null;
  const user = await store.getStudioUser(session.id);
  return user && user.active && user.session_version === session.v ? user : null;
}
async function requireStudio(req, res, ownerOnly = false) {
  const user = await currentStudioUser(req);
  if (!user) { redirect(res, '/admin/login'); return null; }
  if (user.must_change_password && req.url !== '/admin/password') { redirect(res, '/admin/password'); return null; }
  if (ownerOnly && user.role !== 'owner') { send(res, 403, adminViews.adminLayout ? adminViews.adminLayout('Not allowed','') : views.layout('Not allowed','<section class="section narrow"><h1>Not allowed</h1></section>')); return null; }
  return user;
}

async function currentAgent(req) {
  const id = auth.verifyAgentSession(parseCookies(req).jwre_agent);
  if (!id) return null;
  const agent = await store.getAgent(id.id || id);
  if (!agent) return null;
  if (typeof id === 'object' && (agent.session_version || 1) !== (id.v || 1)) return null;
  return agent;
}

function readBody(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const parseForm = buf => Object.fromEntries(new URLSearchParams(buf.toString()));

// naive per-IP rate limits
const hits = new Map();
function rateLimited(ip, bucket, max, windowMs) {
  const key = bucket + ':' + ip;
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return true;
  arr.push(now); hits.set(key, arr);
  return false;
}

// Return-to URL after login/signup: local paths only, never protocol-relative.
function safeNext(next) {
  const n = String(next || '');
  return /^\/(?!\/)[^\s]{0,199}$/.test(n) ? n : '';
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return notFound(res);
    send(res, 200, data, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
  });
}

function deliveryFiles(orderId) {
  const dir = path.join(config.dataDir, 'deliveries', orderId);
  try { return fs.readdirSync(dir).filter(f => !f.startsWith('.')).sort(); } catch { return []; }
}

function listingSiteUrl(res, order, unbranded = false) {
  return `${res.jwreOrigin || config.baseUrl}/site/${order.site_token}${unbranded ? '/unbranded' : ''}`;
}

async function derivativeEntries(order, files, size) {
  const widths = { mls: 2048, web: 1280 };
  const width = widths[size];
  if (!width) return null;
  return Promise.all(files.map(async name => {
    const src = path.join(config.dataDir, 'deliveries', order.id, name);
    const parsed = path.parse(name);
    const outName = `${parsed.name}-${size}.jpg`;
    const data = await require('sharp')(src).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: size === 'mls' ? 90 : 82, mozjpeg: true }).toBuffer();
    return { name: outName, data };
  }));
}

function sendZip(res, order, entries, label) {
  const zip = buildZip(entries);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${order.id}-${label}.zip"`,
    'Content-Length': zip.length,
    'Cache-Control': 'private, no-store',
  });
  res.end(zip);
}

// Which photos the property site shows, in the agent's chosen order.
function siteFiles(order, files) {
  const sel = order.site.selected;
  if (!sel) return files;
  const kept = sel.filter(f => files.includes(f));
  return kept;
}

// ---------- seed demo data on first run ----------
async function seed() {
  const orders = await store.allOrders();
  if (orders.length) return;

  // Demo agent account for verifying the portal. The password comes from
  // DEMO_AGENT_PASSWORD on first boot, otherwise a random one is logged.
  let demoPassword = process.env.DEMO_AGENT_PASSWORD || '';
  if (!demoPassword) {
    demoPassword = auth.generatePassword();
    console.log('DEMO AGENT PASSWORD (set DEMO_AGENT_PASSWORD to control this):', demoPassword);
  }
  const demoAgent = await store.insertAgent({
    name: 'Dana Rivera (demo)',
    email: 'dana.rivera@example.com',
    phone: '512-555-0142',
    passwordHash: auth.hashPassword(demoPassword),
    branding: {
      display_name: 'Dana Rivera',
      brokerage: 'Rivera Realty Group (demo)',
      phone: '512-555-0142',
      email: 'dana.rivera@example.com',
      brand_color: '#5f6758',
      logo_url: '',
    },
  });

  const soon = new Date(Date.now() + 3 * 86400e3);
  const yesterday = new Date(Date.now() - 86400e3);
  const lastWeek = new Date(Date.now() - 6 * 86400e3);

  const o1 = await store.insertOrder({
    customer: { name: 'Dana Rivera', email: 'dana.rivera@example.com', phone: '512-555-0142' },
    property: { address: '1120 Demo Farmhouse Ln', city: 'Austin', zip: '78704', sqft: '2400', notes: 'Demo delivered order - safe to delete.' },
    package_id: 'premium', addon_ids: ['twilight'],
    preferred_date: lastWeek.toISOString().slice(0, 10), preferred_time: '10:00',
    agent_id: demoAgent.id,
  });
  // Demo listing details so the seeded property website shows the full
  // public detail set (facts strip + description) on every fresh deploy.
  await store.updateOrder(o1.id, {
    status: 'delivered', payment_status: 'paid',
    listing: {
      description: 'Light-filled farmhouse with a wraparound porch and mature live oaks.\n\nFresh paint, new roof in 2024, and a plunge pool out back.',
      price: '485000', beds: '4', baths: '2.5', sqft: '2400',
      lot_size: '0.18 acres', year_built: '1998', property_type: 'single-family',
      tour_url: 'https://my.matterport.com/show/?m=9gF1g2aTcYU',
    },
  }, 'Gallery delivered (demo)');
  const dir1 = path.join(config.dataDir, 'deliveries', o1.id);
  fs.mkdirSync(dir1, { recursive: true });
  for (const f of ['front-hero.jpg', 'living-room.jpg', 'kitchen-modern.jpg', 'master-suite.jpg', 'master-bath.jpg', 'backyard-pool.jpg']) {
    fs.copyFileSync(path.join(PUBLIC_DIR, 'portfolio', f), path.join(dir1, 'farmhouse-' + f));
  }

  const o2 = await store.insertOrder({
    customer: { name: 'Dana Rivera', email: 'dana.rivera@example.com', phone: '512-555-0142' },
    property: { address: '88 Demo Valley Rd', city: 'Austin', zip: '78745', sqft: '1800', notes: 'Demo editing order - safe to delete.' },
    package_id: 'essential', addon_ids: [],
    preferred_date: yesterday.toISOString().slice(0, 10), preferred_time: '14:00',
    agent_id: demoAgent.id,
  });
  await store.updateOrder(o2.id, { status: 'editing' }, 'Shoot complete, editing (demo)');

  const o3 = await store.insertOrder({
    customer: { name: 'Dana Rivera', email: 'dana.rivera@example.com', phone: '512-555-0142' },
    property: { address: '4510 Sample Oaks Dr', city: 'Austin', zip: '78731', sqft: '3100', notes: 'Demo scheduled order - safe to delete.' },
    package_id: 'full-media', addon_ids: ['rush'],
    preferred_date: soon.toISOString().slice(0, 10), preferred_time: '09:30',
    agent_id: demoAgent.id,
  });
  await store.updateOrder(o3.id, { status: 'scheduled' }, 'Shoot scheduled (demo)');

  console.log('Seeded demo agent', demoAgent.email, 'and orders:', o1.id, o2.id, o3.id);
}

// ---------- routes ----------
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler });
}

async function activeCatalog() { const items=await store.allCatalog(); return { packages:items.filter(x=>x.kind==='package'), addons:items.filter(x=>x.kind==='addon') }; }
function parseCatalogForm(f) { const id=String(f.id||'').trim().toLowerCase(), name=String(f.name||'').trim(), price=String(f.price||'').trim(); if(!/^[a-z0-9-]{2,50}$/.test(id))return {error:'Use a short ID with lowercase letters, numbers or hyphens.'};if(!name)return {error:'Name is required.'};if(!/^\d+(?:\.\d{1,2})?$/.test(price))return {error:'Enter a valid non-negative price.'};return {item:{id,kind:f.kind==='addon'?'addon':'package',name,tagline:String(f.tagline||'').trim(),includes:String(f.includes||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,20),priceCents:Math.round(Number(price)*100),featured:f.featured==='1',active:f.active==='1',sort_order:parseInt(f.sort_order,10)||10}}; }

route('GET', '/', (req, res) => send(res, 200, views.home()));
route('GET', '/portfolio', (req, res) => send(res, 200, views.portfolio()));
route('GET', '/services', async (req, res) => send(res, 200, views.services(await activeCatalog())));
route('GET', '/healthz', (req, res) => send(res, 200, { ok: true }));

route('GET', '/book', async (req, res, params, query) => {
  const agent = await currentAgent(req);
  if (!agent) {
    const back = '/book' + (query.package ? '?package=' + encodeURIComponent(String(query.package).slice(0, 40)) : '');
    return redirect(res, '/portal/login?next=' + encodeURIComponent(back));
  }
  send(res, 200, views.bookForm(query.package || '', {}, {}, agent, await activeCatalog()));
});

route('POST', '/book', async (req, res) => {
  const agent = await currentAgent(req);
  if (!agent) return redirect(res, '/portal/login?next=' + encodeURIComponent('/book'));
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip, 'book', 10, 3600e3)) return send(res, 429, views.layout('Slow down', '<section class="section narrow"><h1>Too many requests</h1><p>Please try again later.</p></section>'));
  const f = parseForm(await readBody(req));
  if (f.website) return redirect(res, '/book'); // honeypot: pretend nothing happened
  const errors = {};
  if (!f.address || f.address.trim().length < 5) errors.address = 'Street address is required';
  const catalog = await activeCatalog();
  if (!catalog.packages.some(p => p.id === f.package_id)) errors.package_id = 'Pick a package';
  if (Object.keys(errors).length) return send(res, 422, views.bookForm(f.package_id || '', errors, f, agent, catalog));
  const pkg = catalog.packages.find(p => p.id === f.package_id);
  const chosenAddons = catalog.addons.filter(a => f['addon_' + a.id] === '1');
  const addon_ids = chosenAddons.map(a => a.id);
  const order = await store.insertOrder({
    // Identity always comes from the authenticated agent account, never from
    // free-text form fields, so orders attach to the canonical client record.
    customer: { name: agent.name || agent.email, email: agent.email, phone: (f.phone || '').trim() || agent.phone || '' },
    agent_id: agent.id,
    property: { address: f.address.trim(), city: (f.city || '').trim(), zip: (f.zip || '').trim(), sqft: (f.sqft || '').trim(), notes: (f.notes || '').trim() },
    package_id: f.package_id, addon_ids, package_snapshot: pkg, addon_snapshots: chosenAddons,
    preferred_date: f.preferred_date || '', preferred_time: f.preferred_time || '',
  });
  mail.send(order.customer.email, `JWRE Media - booking received (${order.id})`,
    `Thanks ${order.customer.name}! We received your booking ${order.id} for ${order.property.address}.\nPackage: ${pkg.name}\nPreferred: ${order.preferred_date || 'flexible'} ${order.preferred_time}\nWe will confirm the schedule and final quote shortly. The final quote is confirmed before the shoot.\nYour gallery link (activates on delivery): ${config.baseUrl}/gallery/${order.delivery_token}\n`)
    .catch(e => console.error('mail customer:', e.message));
  mail.send(config.notifyEmail, `New JWRE booking ${order.id}`,
    `${order.customer.name} (${order.customer.email}, ${order.customer.phone || 'no phone'}) booked ${pkg.name} at ${order.property.address}, ${order.property.city} ${order.property.zip}. Preferred: ${order.preferred_date} ${order.preferred_time}.\n${config.baseUrl}/admin/orders/${order.id}`)
    .catch(e => console.error('mail admin:', e.message));
  redirect(res, '/order/' + order.id + '/confirm');
});

route('GET', '/order/:id/confirm', async (req, res, params, query) => {
  const order = await store.getOrder(params.id);
  if (!order) return notFound(res);
  send(res, 200, views.confirm(order, query, stripe.paymentsEnabled()));
});

route('POST', '/stripe/webhook', async (req, res) => {
  const raw = await readBody(req);
  let event;
  try { event = stripe.verifyWebhook(raw.toString(), req.headers['stripe-signature']); }
  catch (e) { console.error('webhook rejected:', e.message); return send(res, 400, { error: 'invalid signature' }); }
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const order = await store.getOrderByStripeSession(s.id) || await store.getOrder(s.metadata && s.metadata.order_id);
    if (order) {
      const patch = { payment_status: 'paid' };
      if (order.status === 'delivered') patch.status = 'paid';
      await store.updateOrder(order.id, patch, 'Payment received via Stripe');
    }
  }
  send(res, 200, { received: true });
});

route('GET', '/gallery/:token', async (req, res, params) => {
  const order = await store.getOrderByToken(params.token);
  if (!order) return notFound(res);
  send(res, 200, views.gallery(order, deliveryFiles(order.id), store.deliveryUnlocked(order)));
});

route('GET', '/files/:token/:filename', async (req, res, params) => {
  const order = await store.getOrderByToken(params.token);
  if (!order) return notFound(res);
  // Originals never leave while the order is unpaid. The photographer (admin
  // session) can still proof files from the studio; agents see previews only.
  if (!store.deliveryUnlocked(order) && !await currentStudioUser(req)) {
    return send(res, 403, agentViews.deliveryLocked(order, deliveryFiles(order.id).length));
  }
  const safe = path.basename(decodeURIComponent(params.filename));
  serveStatic(res, path.join(config.dataDir, 'deliveries', order.id, safe));
});

// Watermarked, reduced-resolution previews. Only exist while the delivery is
// payment-locked; once unlocked, originals are served and previews 404.
route('GET', '/previews/:token/:filename', async (req, res, params) => {
  const order = await store.getOrderByToken(params.token);
  if (!order) return notFound(res);
  if (store.deliveryUnlocked(order)) return notFound(res);
  const safe = path.basename(decodeURIComponent(params.filename));
  if (!deliveryFiles(order.id).includes(safe)) return notFound(res);
  try {
    const file = await previews.ensurePreview(order.id, safe);
    serveStatic(res, file);
  } catch (e) {
    console.error('preview build failed:', e.message);
    notFound(res);
  }
});

// ---------- public property websites ----------
async function showPropertySite(req, res, params, unbranded = false) {
  const order = await store.getOrderBySiteToken(params.token);
  if (!order) return notFound(res);
  const files = siteFiles(order, deliveryFiles(order.id));
  const delivered = order.status === 'delivered' || order.status === 'paid';
  if (!delivered || !order.site.published || !files.length || !store.deliveryUnlocked(order)) return send(res, 200, agentViews.siteUnavailable());
  const agent = !unbranded && order.agent_id ? await store.getAgent(order.agent_id) : null;
  send(res, 200, agentViews.propertySite(order, files, agent, { unbranded }));
}
route('GET', '/site/:token', (req, res, params) => showPropertySite(req, res, params, false));
route('GET', '/site/:token/unbranded', (req, res, params) => showPropertySite(req, res, params, true));

route('GET', '/site/:token/qr.svg', async (req, res, params) => {
  const order = await store.getOrderBySiteToken(params.token);
  if (!order) return notFound(res);
  const delivered = order.status === 'delivered' || order.status === 'paid';
  if (!delivered || !order.site.published || !store.deliveryUnlocked(order)) return notFound(res);
  const svg = await QRCode.toString(listingSiteUrl(res, order), { type: 'svg', margin: 2, width: 768, color: { dark: '#171714', light: '#ffffff' } });
  res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${order.id}-listing-qr.svg"`, 'Cache-Control': 'private, no-store' });
  res.end(svg);
});

route('GET', '/sitefiles/:token/:filename', async (req, res, params) => {
  const order = await store.getOrderBySiteToken(params.token);
  if (!order) return notFound(res);
  const files = siteFiles(order, deliveryFiles(order.id));
  const delivered = order.status === 'delivered' || order.status === 'paid';
  const safe = path.basename(decodeURIComponent(params.filename));
  if (!delivered || !order.site.published || !files.includes(safe) || !store.deliveryUnlocked(order)) return notFound(res);
  serveStatic(res, path.join(config.dataDir, 'deliveries', order.id, safe));
});

route('GET', '/calendar.ics', async (req, res) => {
  send(res, 200, ics.buildFeed(await store.allOrders()), { 'Content-Type': 'text/calendar; charset=utf-8' });
});

// ---------- admin ----------
function recoveryDeliveryAvailable() { return false; } // No authorized JWRE outbound provider is connected yet.
async function requestRecovery(req,res,portal){
  const ip=req.socket.remoteAddress||'unknown'; if(rateLimited(ip,portal+'-recovery',5,3600e3)) return send(res,200,adminViews.recovery(portal,true));
  const f=parseForm(await readBody(req)),email=String(f.email||'').trim().toLowerCase(); const account=portal==='studio'?await store.getStudioUserByEmail(email):await store.getAgentByEmail(email);
  if(account&&recoveryDeliveryAvailable()){
    const token=auth.recoveryToken(); await store.createRecoveryToken({portal,accountId:account.id,tokenHash:auth.hashToken(token),expiresAt:new Date(Date.now()+30*60e3).toISOString(),ip});
    // Delivery intentionally remains unwired until an authorized JWRE business mail provider exists.
  }
  if(portal==='studio')await store.addStudioAudit({event:'recovery_requested',targetId:account&&account.id,detail:{matched:!!account,delivery_available:recoveryDeliveryAvailable()},ip});
  return send(res,200,adminViews.recovery(portal,true));
}
route('GET','/admin/recover',(req,res)=>send(res,200,adminViews.recovery('studio')));
route('POST','/admin/recover',(req,res)=>requestRecovery(req,res,'studio'));
route('GET','/portal/recover',(req,res)=>send(res,200,adminViews.recovery('agent')));
route('POST','/portal/recover',(req,res)=>requestRecovery(req,res,'agent'));
route('GET','/admin/reset/:token',(req,res,params)=>send(res,200,adminViews.recovery('studio',false,true)));
route('POST','/admin/reset/:token',async(req,res,params)=>{const f=parseForm(await readBody(req));if(String(f.password||'').length<12||f.password!==f.confirm)return send(res,422,adminViews.recovery('studio',false,true,true));const rec=await store.consumeRecoveryToken({portal:'studio',tokenHash:auth.hashToken(params.token)});if(!rec)return send(res,422,adminViews.recovery('studio',false,true,true));const u=await store.getStudioUser(rec.account_id);if(!u)return send(res,422,adminViews.recovery('studio',false,true,true));await store.updateStudioUser(u.id,{password_hash:auth.hashPassword(f.password),must_change_password:false,session_version:u.session_version+1});await store.addStudioAudit({actorId:u.id,event:'recovery_completed',targetId:u.id,ip:req.socket.remoteAddress});redirect(res,'/admin/login');});
route('GET','/portal/reset/:token',(req,res,params)=>send(res,200,adminViews.recovery('agent',false,true)));
route('POST','/portal/reset/:token',async(req,res,params)=>{const f=parseForm(await readBody(req));if(String(f.password||'').length<12||f.password!==f.confirm)return send(res,422,adminViews.recovery('agent',false,true,true));const rec=await store.consumeRecoveryToken({portal:'agent',tokenHash:auth.hashToken(params.token)});if(!rec)return send(res,422,adminViews.recovery('agent',false,true,true));const a=await store.getAgent(rec.account_id);if(!a)return send(res,422,adminViews.recovery('agent',false,true,true));await store.updateAgent(a.id,{password_hash:auth.hashPassword(f.password),session_version:(a.session_version||1)+1});redirect(res,'/portal/login');});

route('GET', '/admin/login', async (req, res) => currentStudioUser(req).then(u => u ? redirect(res, '/admin') : send(res, 200, adminViews.login())));
route('POST', '/admin/login', async (req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip, 'studio-login', 8, 15 * 60e3)) return send(res, 429, adminViews.login(false, true));
  const f = parseForm(await readBody(req));
  const email = String(f.email || '').trim().toLowerCase();
  let user = await store.getStudioUserByEmail(email);
  // Safe, one-time migration path. The existing Render admin secret bootstraps Jeremy's
  // owner account only when no owner exists, preserving access during the cutover.
  if (!user && email === config.studioOwnerEmail && await store.countActiveOwners() === 0 && auth.verifyPassword) {
    const legacyOk = crypto.timingSafeEqual(Buffer.from(String(f.password || '').padEnd(64).slice(0,64)), Buffer.from(config.adminPassword.padEnd(64).slice(0,64)));
    if (legacyOk) user = await store.insertStudioUser({ name: config.studioOwnerName, email, passwordHash: auth.hashPassword(f.password), role: 'owner', mustChangePassword: false });
  }
  if (!user || !user.active || !auth.verifyPassword(f.password || '', user.password_hash)) {
    await store.addStudioAudit({ event:'login_failed', targetId:user&&user.id, detail:{email}, ip });
    return send(res, 401, adminViews.login(true));
  }
  await store.updateStudioUser(user.id, { last_login_at: new Date().toISOString() });
  await store.addStudioAudit({ actorId:user.id, event:'login_succeeded', targetId:user.id, ip });
  res.writeHead(303, { 'Set-Cookie': `jwre_studio=${auth.makeStudioSession(user)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${12*3600}`, Location: user.must_change_password?'/admin/password':'/admin' }); res.end();
});
route('GET', '/admin/logout', async (req, res) => { const u=await currentStudioUser(req); if(u) await store.addStudioAudit({actorId:u.id,event:'logout',targetId:u.id,ip:req.socket.remoteAddress}); res.writeHead(303,{'Set-Cookie':'jwre_studio=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0',Location:'/admin/login'});res.end(); });
route('GET','/admin/password',async(req,res)=>{const u=await currentStudioUser(req);if(!u)return redirect(res,'/admin/login');send(res,200,adminViews.changePassword(false));});
route('POST','/admin/password',async(req,res)=>{const u=await currentStudioUser(req);if(!u)return redirect(res,'/admin/login');const f=parseForm(await readBody(req));if(String(f.password||'').length<12||f.password!==f.confirm)return send(res,422,adminViews.changePassword(true));await store.updateStudioUser(u.id,{password_hash:auth.hashPassword(f.password),must_change_password:false,session_version:u.session_version+1});await store.addStudioAudit({actorId:u.id,event:'password_changed',targetId:u.id,ip:req.socket.remoteAddress});res.writeHead(303,{'Set-Cookie':`jwre_studio=${auth.makeStudioSession({...u,session_version:u.session_version+1})}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${12*3600}`,Location:'/admin'});res.end();});
route('GET', '/admin', async (req, res) => { const u=await requireStudio(req,res); if(!u)return; send(res,200,adminViews.dashboard(await store.allOrders(),await store.allAgents())); });
route('GET', '/admin/shoots', async (req, res) => { const u=await requireStudio(req,res); if(!u)return; send(res,200,adminViews.shoots(await store.allOrders(),await store.allAgents())); });
route('GET', '/admin/clients', async (req, res) => { const u=await requireStudio(req,res); if(!u)return; send(res,200,adminViews.clients(await store.allAgents(),await store.allOrders(),null)); });
route('POST', '/admin/clients', async (req, res) => {
  const u=await requireStudio(req,res); if(!u)return; const f=parseForm(await readBody(req)); const email=String(f.email||'').trim().toLowerCase();
  if(!f.name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return send(res,422,adminViews.clients(await store.allAgents(),await store.allOrders(),'<div class="notice bad">Name and a valid email are required.</div>'));
  if(await store.getAgentByEmail(email))return send(res,422,adminViews.clients(await store.allAgents(),await store.allOrders(),'<div class="notice bad">An agent with that email already exists.</div>'));
  const password=auth.generatePassword(); await store.insertAgent({name:f.name.trim(),email,phone:(f.phone||'').trim(),passwordHash:auth.hashPassword(password),branding:{}}); send(res,200,adminViews.clients(await store.allAgents(),await store.allOrders(),adminViews.credentialsFlash('Account created',f.name.trim(),email,password)));
});
route('POST', '/admin/clients/:id/reset', async (req,res,params)=>{const u=await requireStudio(req,res);if(!u)return;const agent=await store.getAgent(params.id);if(!agent)return notFound(res);const password=auth.generatePassword();await store.updateAgent(agent.id,{password_hash:auth.hashPassword(password)});send(res,200,adminViews.clients(await store.allAgents(),await store.allOrders(),adminViews.credentialsFlash('Password reset',agent.name,agent.email,password)));});
route('GET','/admin/team',async(req,res)=>{const u=await requireStudio(req,res,true);if(!u)return;send(res,200,adminViews.team(await store.allStudioUsers(),await store.recentStudioAudit(),null,u));});
route('POST','/admin/team',async(req,res)=>{const u=await requireStudio(req,res,true);if(!u)return;const f=parseForm(await readBody(req)),email=String(f.email||'').trim().toLowerCase(),role=f.role==='owner'?'owner':'photographer';if(!f.name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||await store.getStudioUserByEmail(email))return send(res,422,adminViews.team(await store.allStudioUsers(),await store.recentStudioAudit(),'<div class="notice bad">Use a unique name and valid email.</div>',u));const password=auth.generatePassword();const target=await store.insertStudioUser({name:f.name.trim(),email,passwordHash:auth.hashPassword(password),role,mustChangePassword:true});await store.addStudioAudit({actorId:u.id,event:'account_created',targetId:target.id,detail:{role},ip:req.socket.remoteAddress});send(res,200,adminViews.team(await store.allStudioUsers(),await store.recentStudioAudit(),adminViews.credentialsFlash('Account created',target.name,target.email,password),u));});
route('POST','/admin/team/:id/reset',async(req,res,params)=>{const u=await requireStudio(req,res,true);if(!u)return;const target=await store.getStudioUser(params.id);if(!target)return notFound(res);const password=auth.generatePassword();await store.updateStudioUser(target.id,{password_hash:auth.hashPassword(password),must_change_password:true,session_version:target.session_version+1});await store.addStudioAudit({actorId:u.id,event:'password_reset',targetId:target.id,ip:req.socket.remoteAddress});send(res,200,adminViews.team(await store.allStudioUsers(),await store.recentStudioAudit(),adminViews.credentialsFlash('Password reset',target.name,target.email,password),u));});
route('POST','/admin/team/:id/toggle',async(req,res,params)=>{const u=await requireStudio(req,res,true);if(!u)return;const target=await store.getStudioUser(params.id);if(!target||String(target.id)===String(u.id))return redirect(res,'/admin/team');if(target.active&&target.role==='owner'&&await store.countActiveOwners()<=1)return send(res,422,adminViews.team(await store.allStudioUsers(),await store.recentStudioAudit(),'<div class="notice bad">The last active owner cannot be disabled.</div>',u));await store.updateStudioUser(target.id,{active:!target.active,session_version:target.session_version+1});await store.addStudioAudit({actorId:u.id,event:target.active?'account_disabled':'account_enabled',targetId:target.id,ip:req.socket.remoteAddress});redirect(res,'/admin/team');});
route('GET','/admin/catalog',async(req,res)=>{const u=await requireStudio(req,res,true);if(!u)return;send(res,200,adminViews.catalog(await store.allCatalog(true),null,u));});
route('GET','/admin/catalog/new',async(req,res,params,query)=>{const u=await requireStudio(req,res,true);if(!u)return;send(res,200,adminViews.catalogEditor({kind:query.kind==='addon'?'addon':'package',active:true,sort_order:10},null,u));});
route('GET','/admin/catalog/:id',async(req,res,params)=>{const u=await requireStudio(req,res,true);if(!u)return;const x=await store.getCatalogItem(params.id);if(!x)return notFound(res);send(res,200,adminViews.catalogEditor(x,null,u));});
async function saveCatalog(req,res,params){const u=await requireStudio(req,res,true);if(!u)return;const f=parseForm(await readBody(req)),parsed=parseCatalogForm(f),existing=params&&params.id?await store.getCatalogItem(params.id):null;if(parsed.error)return send(res,422,adminViews.catalogEditor({...f,id:existing?existing.id:f.id,priceCents:Math.round(Number(f.price||0)*100)},parsed.error,u));if(!existing&&await store.getCatalogItem(parsed.item.id))return send(res,422,adminViews.catalogEditor({...parsed.item},'That short ID is already in use.',u));if(existing)parsed.item.id=existing.id;await store.saveCatalogItem(parsed.item);await store.addStudioAudit({actorId:u.id,event:existing?'catalog_updated':'catalog_created',detail:{catalog_id:parsed.item.id},ip:req.socket.remoteAddress});redirect(res,'/admin/catalog');}
route('POST','/admin/catalog',(req,res,params)=>saveCatalog(req,res,params));
route('POST','/admin/catalog/:id',(req,res,params)=>saveCatalog(req,res,params));
route('GET', '/admin/billing', async (req, res) => {
  if (!await requireStudio(req, res)) return;
  send(res, 200, adminViews.billing(await store.allOrders()));
});
route('GET', '/admin/orders/:id', async (req, res, params) => {
  if (!await requireStudio(req, res)) return;
  const order = await store.getOrder(params.id);
  if (!order) return notFound(res);
  send(res, 200, adminViews.orderDetail(order, deliveryFiles(order.id), await store.allAgents(), null));
});
route('POST', '/admin/orders/:id/status', async (req, res, params) => {
  if (!await requireStudio(req, res)) return;
  const f = parseForm(await readBody(req));
  if (!store.STATUSES.includes(f.status)) return send(res, 400, { error: 'bad status' });
  await store.updateOrder(params.id, { status: f.status }, 'Status changed to ' + f.status);
  redirect(res, '/admin/orders/' + params.id);
});
route('POST', '/admin/orders/:id/payment', async (req, res, params) => {
  if (!await requireStudio(req, res)) return;
  const f = parseForm(await readBody(req));
  const ps = f.payment_status === 'paid' ? 'paid' : 'unpaid';
  const patch = { payment_status: ps };
  if (ps === 'unpaid' && (await store.getOrder(params.id))?.status === 'paid') patch.status = 'delivered';
  await store.updateOrder(params.id, patch, 'Payment marked ' + ps);
  redirect(res, '/admin/orders/' + params.id);
});
// Photographer override: release a delivery before payment (trusted clients,
// complimentary shoots, pay-later). A reason is required and the grant is
// written to the order timeline with who/when; revoking re-locks instantly.
route('POST', '/admin/orders/:id/release', async (req, res, params) => {
  if (!await requireStudio(req, res)) return;
  const order = await store.getOrder(params.id);
  if (!order) return notFound(res);
  const f = parseForm(await readBody(req));
  const reason = String(f.reason || '').trim();
  if (reason.length < 3 || reason.length > 300) {
    return send(res, 422, adminViews.orderDetail(order, deliveryFiles(order.id), await store.allAgents(),
      '<div class="notice bad">A short reason (3-300 characters) is required to release a delivery without payment.</div>'));
  }
  await store.updateOrder(order.id, {
    delivery_release: { reason, by: 'JWRE Studio', at: new Date().toISOString() },
  }, 'Delivery released without payment by JWRE Studio. Reason: ' + reason);
  redirect(res, '/admin/orders/' + order.id);
});
route('POST', '/admin/orders/:id/release/revoke', async (req, res, params) => {
  if (!await requireStudio(req, res)) return;
  const order = await store.getOrder(params.id);
  if (!order) return notFound(res);
  if (order.delivery_release) {
    const note = order.payment_status === 'paid'
      ? 'Delivery release revoked by JWRE Studio (order is paid, stays unlocked)'
      : 'Delivery release revoked by JWRE Studio - gallery, downloads, and property site locked again';
    await store.updateOrder(order.id, { delivery_release: null }, note);
    previews.clearPreviews(order.id);
  }
  redirect(res, '/admin/orders/' + order.id);
});
route('POST', '/admin/orders/:id/assign', async (req, res, params) => {
  if (!await requireStudio(req, res)) return;
  const f = parseForm(await readBody(req));
  const agentId = String(f.agent_id || '');
  const agent = agentId ? await store.getAgent(agentId) : null;
  const patch = { agent_id: agent ? agent.id : null };
  await store.updateOrder(params.id, patch, agent ? 'Assigned to ' + (agent.name || agent.email) : 'Agent unassigned');
  redirect(res, '/admin/orders/' + params.id);
});
route('POST', '/admin/orders/:id/credit', async (req, res, params) => {
  if (!await requireStudio(req, res)) return;
  const f = parseForm(await readBody(req));
  const credit = String(f.credit || '').trim() || 'JWRE Media';
  await store.updateOrder(params.id, { credit }, 'Photography credit set to ' + credit);
  redirect(res, '/admin/orders/' + params.id);
});
route('POST', '/admin/orders/:id/upload', async (req, res, params) => {
  if (!await requireStudio(req, res)) return;
  const order = await store.getOrder(params.id);
  if (!order) return notFound(res);
  let parsed;
  try {
    parsed = parseMultipart(await readBody(req, MAX_UPLOAD_BYTES), req.headers['content-type']);
  } catch (e) {
    return send(res, 400, adminViews.orderDetail(order, deliveryFiles(order.id), await store.allAgents(), '<div class="notice bad">Upload failed: ' + esc(e.message) + '</div>'));
  }
  const saved = [];
  const skipped = [];
  for (const file of parsed.files) {
    if (!IMAGE_TYPES[file.contentType]) { skipped.push(file.filename); continue; }
    if (!file.data.length) { skipped.push(file.filename); continue; }
    const name = sanitizeFilename(file.filename);
    const dir = path.join(config.dataDir, 'deliveries', order.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), file.data);
    saved.push(name);
  }
  if (saved.length) {
    await store.updateOrder(order.id, {}, 'Delivered files uploaded: ' + saved.join(', '));
  }
  const flash = saved.length
    ? '<div class="notice ok">Uploaded ' + saved.length + ' file(s).' + (skipped.length ? ' Skipped (not images): ' + esc(skipped.join(', ')) : '') + '</div>'
    : '<div class="notice bad">Nothing uploaded. Only JPG, PNG, or WebP images are accepted.</div>';
  const fresh = await store.getOrder(order.id);
  send(res, 200, adminViews.orderDetail(fresh, deliveryFiles(order.id), await store.allAgents(), flash));
});
// Permanently delete an order. Guarded to empty orders only: once delivery
// files exist they must be removed one by one first, so a finished gallery
// cannot be lost to a single misclick. Intended for test and mistaken orders.
route('POST', '/admin/orders/:id/delete', async (req, res, params) => {
  if (!await requireStudio(req, res)) return;
  const order = await store.getOrder(params.id);
  if (!order) return notFound(res);
  const files = deliveryFiles(order.id);
  if (files.length) {
    return send(res, 422, adminViews.orderDetail(order, files, await store.allAgents(),
      '<div class="notice bad">This order still has delivered files. Remove them first, then delete the order.</div>'));
  }
  previews.clearPreviews(order.id);
  fs.rmSync(path.join(config.dataDir, 'deliveries', order.id), { recursive: true, force: true });
  await store.deleteOrder(order.id);
  redirect(res, '/admin');
});
route('POST', '/admin/orders/:id/files/delete', async (req, res, params) => {
  if (!await requireStudio(req, res)) return;
  const order = await store.getOrder(params.id);
  if (!order) return notFound(res);
  const f = parseForm(await readBody(req));
  const safe = path.basename(String(f.filename || ''));
  const files = deliveryFiles(order.id);
  if (safe && files.includes(safe)) {
    fs.unlinkSync(path.join(config.dataDir, 'deliveries', order.id, safe));
    previews.clearPreviews(order.id);
    await store.updateOrder(order.id, {}, 'Delivered file removed: ' + safe);
  }
  redirect(res, '/admin/orders/' + order.id);
});

route('POST', '/order/:id/pay', async (req, res, params) => {
  const order = await store.getOrder(params.id);
  if (!order) return notFound(res);
  if (!stripe.paymentsEnabled()) return redirect(res, '/order/' + order.id + '/confirm');
  if (order.payment_status === 'paid') return redirect(res, '/order/' + order.id + '/confirm?paid=1');
  const pkg = order.package_snapshot || config.packages.find(p => p.id === order.package_id);
  const addons = (order.addon_snapshots && order.addon_snapshots.length ? order.addon_snapshots : config.addons.filter(a => order.addon_ids.includes(a.id)));
  try {
    const session = await stripe.createCheckoutSession(order, pkg, addons);
    await store.updateOrder(order.id, { stripe_session_id: session.id }, 'Stripe checkout session created');
    redirect(res, session.url);
  } catch (e) {
    console.error('stripe:', e.message);
    send(res, 502, views.layout('Payment error', '<section class="section narrow"><h1>Payment unavailable</h1><p>Stripe checkout failed. Please try again or contact us.</p></section>'));
  }
});

// ---------- agent portal ----------
route('GET', '/portal/login', async (req, res, params, query) => {
  const next = safeNext(query.next);
  if (await currentAgent(req)) return redirect(res, next || '/portal');
  send(res, 200, agentViews.login(false, next));
});
route('POST', '/portal/login', async (req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  const f = parseForm(await readBody(req));
  const next = safeNext(f.next);
  if (rateLimited(ip, 'portal', 10, 3600e3)) return send(res, 429, agentViews.login(true, next));
  const agent = await store.getAgentByEmail(f.email || '');
  if (!agent || !auth.verifyPassword(f.password || '', agent.password_hash)) {
    return send(res, 401, agentViews.login(true, next));
  }
  res.writeHead(303, { 'Set-Cookie': `jwre_agent=${auth.makeAgentSession(agent)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${12 * 3600}`, Location: next || '/portal' });
  res.end();
});
// Public self-service agent signup. Creates the same canonical agents row the
// Studio Clients page and order assignment use, so a new signup is immediately
// assignable. Photographer Studio accounts stay owner-created via /admin/team.
route('GET', '/portal/signup', async (req, res, params, query) => {
  const next = safeNext(query.next);
  if (await currentAgent(req)) return redirect(res, next || '/portal');
  send(res, 200, agentViews.signup({}, {}, next));
});
route('POST', '/portal/signup', async (req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip, 'portal-signup', 5, 3600e3)) return send(res, 429, agentViews.signup({ rateLimited: true }));
  const f = parseForm(await readBody(req));
  const next = safeNext(f.next);
  if (f.website) return redirect(res, '/portal/login'); // honeypot: pretend nothing happened
  const name = String(f.name || '').trim().slice(0, 120);
  const email = String(f.email || '').trim().toLowerCase().slice(0, 200);
  const phone = String(f.phone || '').trim().slice(0, 40);
  const password = String(f.password || '');
  const errors = [];
  if (!name) errors.push('Name is required.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('A valid email is required.');
  if (password.length < 12) errors.push('Password must be at least 12 characters.');
  if (password !== String(f.confirm || '')) errors.push('Passwords do not match.');
  if (errors.length) return send(res, 422, agentViews.signup({ errors }, { name, email, phone }, next));
  // Duplicate emails get the same "could not create" screen as any other
  // failure, so the form never confirms whether an address already has an
  // account. The hash runs either way to keep the timing identical.
  const existing = await store.getAgentByEmail(email);
  const passwordHash = auth.hashPassword(password);
  if (existing) {
    await store.addStudioAudit({ event: 'agent_signup_unavailable', detail: { email }, ip });
    return send(res, 422, agentViews.signup({ unavailable: true }, { name, email, phone }, next));
  }
  let agent;
  try {
    agent = await store.insertAgent({ name, email, phone, passwordHash, branding: { display_name: name, email, phone } });
  } catch (e) {
    if (e && e.code === '23505') { // agents.email unique race between check and insert
      await store.addStudioAudit({ event: 'agent_signup_unavailable', detail: { email }, ip });
      return send(res, 422, agentViews.signup({ unavailable: true }, { name, email, phone }, next));
    }
    throw e;
  }
  await store.addStudioAudit({ event: 'agent_signup', detail: { agent_id: agent.id, name, email, self_service: true }, ip });
  res.writeHead(303, { 'Set-Cookie': `jwre_agent=${auth.makeAgentSession(agent)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${12 * 3600}`, Location: next || '/portal' });
  res.end();
});

route('GET', '/portal/logout', (req, res) => {
  res.writeHead(303, { 'Set-Cookie': 'jwre_agent=; HttpOnly; Path=/; Max-Age=0', Location: '/portal/login' });
  res.end();
});
route('GET', '/portal', async (req, res) => {
  const agent = await currentAgent(req);
  if (!agent) return redirect(res, '/portal/login');
  const orders = await store.ordersForAgent(agent.id);
  // One cover thumbnail per property. Locked deliveries use the watermarked
  // preview derivative so originals never leak onto the dashboard.
  const thumbs = {};
  for (const o of orders) {
    const files = deliveryFiles(o.id);
    if (files.length) thumbs[o.id] = { file: files[0], token: o.delivery_token, unlocked: store.deliveryUnlocked(o) };
  }
  send(res, 200, agentViews.dashboard(agent, orders, thumbs));
});
route('GET', '/portal/branding', async (req, res) => {
  const agent = await currentAgent(req);
  if (!agent) return redirect(res, '/portal/login');
  send(res, 200, agentViews.branding(agent, false));
});
route('POST', '/portal/branding', async (req, res) => {
  const agent = await currentAgent(req);
  if (!agent) return redirect(res, '/portal/login');
  const f = parseForm(await readBody(req));
  const branding = {};
  for (const [k] of agentViews.BRANDING_FIELDS) branding[k] = String(f[k] || '').trim().slice(0, 300);
  await store.updateAgent(agent.id, { branding });
  send(res, 200, agentViews.branding(await store.getAgent(agent.id), true));
});
route('GET', '/portal/orders/:id', async (req, res, params) => {
  const agent = await currentAgent(req);
  if (!agent) return redirect(res, '/portal/login');
  const order = await store.getOrder(params.id);
  if (!order || order.agent_id !== agent.id) return notFound(res);
  send(res, 200, agentViews.orderDetail(agent, order, deliveryFiles(order.id), { paymentsEnabled: stripe.paymentsEnabled(), origin: res.jwreOrigin || config.baseUrl }));
});
route('GET', '/portal/orders/:id/site', async (req, res, params) => {
  const agent = await currentAgent(req);
  if (!agent) return redirect(res, '/portal/login');
  const order = await store.getOrder(params.id);
  if (!order || order.agent_id !== agent.id) return notFound(res);
  const files = deliveryFiles(order.id);
  if (!files.length) return redirect(res, '/portal/orders/' + order.id);
  if (!store.deliveryUnlocked(order)) return redirect(res, '/portal/orders/' + order.id);
  send(res, 200, agentViews.siteEditor(agent, order, files, false));
});
route('POST', '/portal/orders/:id/site', async (req, res, params) => {
  const agent = await currentAgent(req);
  if (!agent) return redirect(res, '/portal/login');
  const order = await store.getOrder(params.id);
  if (!order || order.agent_id !== agent.id) return notFound(res);
  if (!store.deliveryUnlocked(order)) return redirect(res, '/portal/orders/' + order.id);
  const files = deliveryFiles(order.id);
  const f = parseForm(await readBody(req));
  const chosen = files
    .filter(name => f['show_' + name] === '1')
    .map(name => ({ name, pos: parseInt(f['pos_' + name], 10) || 9999 }))
    .sort((a, b) => a.pos - b.pos || files.indexOf(a.name) - files.indexOf(b.name))
    .map(x => x.name);
  const site = { selected: chosen.length ? chosen : [], published: f.published === '1' };
  await store.updateOrder(order.id, { site }, 'Agent updated property website selection (' + chosen.length + ' photos, ' + (site.published ? 'live' : 'hidden') + ')');
  send(res, 200, agentViews.siteEditor(agent, await store.getOrder(order.id), files, true));
});
// Agent-editable listing details shown on the public property website.
// All fields optional; blank means hidden. Values are validated so the site
// never shows malformed facts, and nothing is invented for the agent.
function parseListingForm(f) {
  const errors = {};
  const listing = {};
  const desc = String(f.description || '').trim();
  if (desc.length > 1500) errors.description = 'Keep the description under 1,500 characters.';
  else if (desc) listing.description = desc;
  const price = String(f.price || '').replace(/[$,\s]/g, '');
  if (price) {
    if (!/^\d{4,9}$/.test(price)) errors.price = 'Numbers only, no decimals (e.g. 485000).';
    else listing.price = price;
  }
  const beds = String(f.beds || '').trim();
  if (beds) {
    if (!/^\d{1,2}$/.test(beds) || Number(beds) > 20) errors.beds = 'Whole number, 0-20.';
    else listing.beds = String(Number(beds));
  }
  const baths = String(f.baths || '').trim();
  if (baths) {
    if (!/^\d{1,2}(\.5)?$/.test(baths) || Number(baths) > 20) errors.baths = '0-20, half baths like 2.5 are fine.';
    else listing.baths = String(Number(baths)).replace(/\.5$/, '.5');
  }
  const sqft = String(f.sqft || '').replace(/[,\s]/g, '');
  if (sqft) {
    if (!/^\d{3,7}$/.test(sqft) || Number(sqft) < 100 || Number(sqft) > 1000000) errors.sqft = 'Numbers only (e.g. 2400).';
    else listing.sqft = sqft;
  }
  const lot = String(f.lot_size || '').trim();
  if (lot.length > 40) errors.lot_size = 'Keep it short (e.g. 0.18 acres or 6,200 sq ft).';
  else if (lot) listing.lot_size = lot;
  const year = String(f.year_built || '').trim();
  if (year) {
    const maxYear = new Date().getFullYear() + 2;
    if (!/^\d{4}$/.test(year) || Number(year) < 1600 || Number(year) > maxYear) errors.year_built = 'Four-digit year (e.g. 1998).';
    else listing.year_built = year;
  }
  const videoRaw = String(f.video_url || '').trim();
  if (videoRaw) {
    const v = media.parseMediaUrl(videoRaw);
    if (!v || v.kind !== 'video') errors.video_url = 'Paste a YouTube or Vimeo link.';
    else listing.video_url = videoRaw;
  }
  const tourRaw = String(f.tour_url || '').trim();
  if (tourRaw) {
    const t = media.parseMediaUrl(tourRaw);
    if (!t || t.kind !== 'tour') errors.tour_url = 'Paste a Matterport or Zillow 3D tour link.';
    else listing.tour_url = tourRaw;
  }
  const ptype = String(f.property_type || '').trim();
  const allowed = agentViews.LISTING_TYPES.map(([k]) => k);
  if (ptype) {
    if (!allowed.includes(ptype)) errors.property_type = 'Pick a type from the list.';
    else listing.property_type = ptype;
  }
  return { errors, listing };
}

route('GET', '/portal/orders/:id/details', async (req, res, params) => {
  const agent = await currentAgent(req);
  if (!agent) return redirect(res, '/portal/login');
  const order = await store.getOrder(params.id);
  if (!order || order.agent_id !== agent.id) return notFound(res);
  send(res, 200, agentViews.detailsEditor(agent, order, {}, null, false));
});
route('POST', '/portal/orders/:id/details', async (req, res, params) => {
  const agent = await currentAgent(req);
  if (!agent) return redirect(res, '/portal/login');
  const order = await store.getOrder(params.id);
  if (!order || order.agent_id !== agent.id) return notFound(res);
  const f = parseForm(await readBody(req));
  const { errors, listing } = parseListingForm(f);
  if (Object.keys(errors).length) {
    return send(res, 422, agentViews.detailsEditor(agent, order, errors, f, false));
  }
  await store.updateOrder(order.id, { listing }, 'Agent updated listing details');
  send(res, 200, agentViews.detailsEditor(agent, await store.getOrder(order.id), {}, null, true));
});

async function downloadPhotos(req, res, params, size = 'full-resolution') {
  const agent = await currentAgent(req);
  if (!agent) return redirect(res, '/portal/login');
  const order = await store.getOrder(params.id);
  if (!order || order.agent_id !== agent.id) return notFound(res);
  if (!store.deliveryUnlocked(order)) return redirect(res, '/portal/orders/' + order.id);
  const files = deliveryFiles(order.id);
  if (!files.length) return redirect(res, '/portal/orders/' + order.id);
  try {
    const entries = size === 'full-resolution'
      ? files.map(name => ({ name, data: fs.readFileSync(path.join(config.dataDir, 'deliveries', order.id, name)) }))
      : await derivativeEntries(order, files, size);
    if (!entries) return notFound(res);
    sendZip(res, order, entries, size);
  } catch (e) {
    console.error('derivative zip failed:', e.message);
    send(res, 500, agentViews.derivativeError(agent, order));
  }
}
route('GET', '/portal/orders/:id/download.zip', (req, res, params) => downloadPhotos(req, res, params));
route('GET', '/portal/orders/:id/download/:size.zip', (req, res, params) => downloadPhotos(req, res, params, params.size));

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  try {
    // Public origin for this request, used to absolutize URLs in HTML (see send).
    const reqHost = String(req.headers.host || '');
    const reqProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
    res.jwreOrigin = /^[a-zA-Z0-9.\-:]+$/.test(reqHost) && reqHost ? reqProto + '://' + reqHost : '';
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);
    if (req.method === 'GET' && pathname.startsWith('/static/')) {
      const safe = path.normalize(pathname.replace('/static/', '')).replace(/^(\.\.[/\\])+/, '');
      return serveStatic(res, path.join(PUBLIC_DIR, safe));
    }
    const query = Object.fromEntries(url.searchParams);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.rx);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      return await r.handler(req, res, params, query);
    }
    notFound(res);
  } catch (e) {
    console.error(e);
    send(res, 500, views.layout('Error', '<section class="section narrow"><h1>Something went wrong</h1><p>Please try again.</p></section>'));
  }
});

(async () => { if (config.storageBackend === 'pg') await require('../db/migrate').migrate(); await seed(); })().then(() => {
  server.listen(config.port, () => {
    console.log(`JWRE Media site listening on http://localhost:${config.port}`);
    console.log(`Stripe checkout: ${stripe.paymentsEnabled() ? 'ENABLED (test mode keys detected)' : 'disabled - no keys, orders recorded as payment pending'}`);
  });
});
