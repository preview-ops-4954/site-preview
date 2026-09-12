'use strict';
// Agent portal + public property websites. Shares the public stylesheet.
const config = require('./config');
const store = require('./store');
const { esc, money, brand } = require('./views');
const media = require('./media');

function portalLayout(agent, title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - Agent portal - ${esc(config.business.name)}</title>
<link rel="stylesheet" href="/static/styles.css?v=20260912f">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg"></head>
<body><header class="nav keep-links">${brand('/portal', 'Media', '<span class="portal-tag">Agent portal</span>')}
<nav><a href="/portal">My properties</a><a href="/portal/branding">Branding</a><a href="/portal/logout">Log out</a></nav></header>
<main>${body}</main>
<footer class="foot"><div class="foot-grid">
  <div class="foot-brand">${brand('/portal', 'Media')}<p class="muted">Signed in as ${esc(agent.name || agent.email)}.</p></div>
  <nav class="foot-nav" aria-label="Footer"><a href="/portal">My properties</a><a href="/portal/branding">Branding</a><a href="/">JWRE Media site</a></nav>
  <div class="foot-meta muted"><p>Photography by ${esc(config.business.name)}</p></div>
</div></footer>
<script src="/static/lightbox.js?v=20260912d" defer></script>
</body></html>`;
}

function login(error, next = '') {
  const booking = next.startsWith('/book');
  const signupHref = '/portal/signup' + (next ? '?next=' + encodeURIComponent(next) : '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent login - ${esc(config.business.name)}</title><link rel="stylesheet" href="/static/styles.css?v=20260912f">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg"></head>
<body><header class="auth-head">${brand('/', 'Media')}</header>
<main class="auth-main"><div class="auth-card">
<p class="eyebrow">Agent portal</p><h1>Sign in</h1>
<p class="muted">For real estate agents working with ${esc(config.business.name)}. Your properties, galleries, downloads, and property websites in one place.</p>
${booking ? `<div class="notice">Sign in to request your shoot. New here? <a href="${signupHref}">Create an account</a> instead.</div>` : ''}
${error ? '<div class="notice bad">That email and password did not match. Try again.</div>' : ''}
<form method="post" action="/portal/login" class="form">
<input type="hidden" name="next" value="${esc(next)}">
<label>Email<input type="email" name="email" autofocus required autocomplete="username"></label>
<label>Password<input type="password" name="password" required autocomplete="current-password"></label>
<button class="btn block" type="submit">Sign in</button></form>
<p class="recovery-link"><a href="/portal/recover">Forgot username or password?</a></p>
<p class="recovery-link"><a href="${signupHref}">New to ${esc(config.business.name)}? Create an account</a></p>
<p class="muted" style="margin-top:2rem"><a class="backlink" href="/">&larr; Back to the ${esc(config.business.name)} site</a></p>
</div></main></body></html>`;
}

function signup(state = {}, values = {}, next = '') {
  const v = k => esc(values[k] || '');
  let notice = '';
  if (state.rateLimited) notice = '<div class="notice bad">Too many attempts. Please try again in a little while.</div>';
  else if (state.unavailable) notice = '<div class="notice bad">We could not create an account with those details. If you already have an account, <a href="/portal/login">sign in</a> or use <a href="/portal/recover">account recovery</a>.</div>';
  else if (state.errors && state.errors.length) notice = '<div class="notice bad">' + state.errors.map(esc).join(' ') + '</div>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Create account - Agent portal - ${esc(config.business.name)}</title><link rel="stylesheet" href="/static/styles.css?v=20260912f">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg"></head>
<body><header class="auth-head">${brand('/', 'Media')}</header>
<main class="auth-main"><div class="auth-card">
<p class="eyebrow">Agent portal</p><h1>Create your account</h1>
<p class="muted">For real estate agents working with ${esc(config.business.name)}. Your properties, galleries, downloads, and property websites in one place.</p>
${next.startsWith('/book') ? '<div class="notice">Create your account to request your shoot. It takes about a minute.</div>' : ''}
${notice}
<form method="post" action="/portal/signup" class="form">
<input type="hidden" name="next" value="${esc(next)}">
<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
<label>Full name<input type="text" name="name" value="${v('name')}" autofocus required autocomplete="name" maxlength="120"></label>
<label>Email<input type="email" name="email" value="${v('email')}" required autocomplete="email" maxlength="200"></label>
<label>Phone (optional)<input type="tel" name="phone" value="${v('phone')}" autocomplete="tel" maxlength="40"></label>
<label>Password<input type="password" name="password" minlength="12" required autocomplete="new-password" aria-describedby="pw-hint"></label>
<p class="muted" id="pw-hint" style="font-size:.78rem;margin:.35rem 0 0">At least 12 characters.</p>
<label>Confirm password<input type="password" name="confirm" minlength="12" required autocomplete="new-password"></label>
<button class="btn block" type="submit">Create account</button></form>
<p class="recovery-link"><a href="/portal/login${next ? '?next=' + encodeURIComponent(next) : ''}">Already have an account? Sign in</a></p>
<p class="muted" style="margin-top:2rem"><a class="backlink" href="/">&larr; Back to the ${esc(config.business.name)} site</a></p>
</div></main></body></html>`;
}

function statusBadge(o) { return `<span class="badge s-${o.status}">${esc(o.status)}</span>`; }

function dashboard(agent, orders, thumbs = {}) {
  const open = orders.filter(o => !['delivered', 'paid'].includes(o.status)).length;
  const deliveredCount = orders.length - open;
  const rows = orders.map(o => {
    const delivered = o.status === 'delivered' || o.status === 'paid';
    const unlocked = store.deliveryUnlocked(o);
    const side = delivered
      ? (unlocked ? (o.site.published ? ' <span class="badge live">site live</span>' : '') : ' <span class="badge unpaid">payment due</span>')
      : '';
    const th = thumbs[o.id];
    const thumb = th
      ? `<img class="prop-thumb" loading="lazy" src="/${th.unlocked ? 'files' : 'previews'}/${th.token}/${encodeURIComponent(th.file)}" alt="">`
      : `<span class="prop-thumb ph" aria-hidden="true">JW</span>`;
    const actions = [];
    actions.push(`<a href="/portal/orders/${o.id}">Open</a>`);
    if (delivered && unlocked && th) {
      actions.push(`<a href="/portal/orders/${o.id}/download.zip">Download zip</a>`);
      if (o.site.published) actions.push(`<a href="/site/${o.site_token}" target="_blank">View site</a>`);
    }
    return `<div class="prop-row">
      <a class="prop-hit" href="/portal/orders/${o.id}">
        ${thumb}
        <span class="prop-main"><strong>${esc(o.property.address)}</strong>
        <span class="muted">${esc(o.property.city || '')} ${esc(o.property.zip || '')}${o.preferred_date ? ' - ' + esc(o.preferred_date) : ''}</span></span>
      </a>
      <span class="prop-side">${statusBadge(o)}${side}</span>
      <span class="prop-actions">${actions.join('')}</span>
    </div>`;
  }).join('');
  const summary = [];
  if (orders.length) {
    summary.push(`<span>${orders.length} ${orders.length === 1 ? 'property' : 'properties'}</span>`);
    if (open) summary.push(`<span>${open} in progress</span>`);
    if (deliveredCount) summary.push(`<span>${deliveredCount} delivered</span>`);
  }
  return portalLayout(agent, 'My properties', `
<section class="section">
  <p class="eyebrow">Welcome back</p>
  <h1>${esc((agent.name || 'there').split(' ')[0])}'s<br>properties.</h1>
  <p class="muted">Every shoot, gallery, download, and property website for your listings.</p>
  ${summary.length ? `<div class="summary-line">${summary.join('')}</div>` : ''}
  <div class="prop-list">${rows || '<div class="empty"><p>No properties yet.</p><p>Your shoots, galleries, and property websites appear here once your first shoot is booked.</p></div>'}</div>
</section>`);
}

function launchKit(order, opts = {}) {
  const origin = String(opts.origin || config.baseUrl || '').replace(/\/$/, '');
  const branded = `${origin}/site/${order.site_token}`;
  const unbranded = `${branded}/unbranded`;
  const L = order.listing || {};
  const mediaLinks = [];
  if (media.parseMediaUrl(L.video_url || '')) mediaLinks.push(`<a class="launch-link" href="${esc(L.video_url)}" target="_blank" rel="noopener"><span>Listing video</span><strong>Open link</strong></a>`);
  if (media.parseMediaUrl(L.tour_url || '')) mediaLinks.push(`<a class="launch-link" href="${esc(L.tour_url)}" target="_blank" rel="noopener"><span>3D tour</span><strong>Open link</strong></a>`);
  return `<section class="launch-kit" aria-labelledby="launch-kit-title">
    <div class="launch-kit-head"><div><p class="eyebrow">Everything in one place</p><h2 id="launch-kit-title">Listing Launch Kit</h2></div><span class="launch-ready">Ready to share</span></div>
    <div class="launch-grid">
      <article class="launch-card launch-downloads"><p class="launch-num">01</p><h3>Photo downloads</h3><p class="muted">Fresh ZIPs are made when you click. Originals stay untouched.</p>
        <a class="launch-link" href="/portal/orders/${order.id}/download.zip"><span>Full resolution</span><strong>Original files</strong></a>
        <a class="launch-link" href="/portal/orders/${order.id}/download/mls.zip"><span>MLS size</span><strong>2048 px JPEG</strong></a>
        <a class="launch-link" href="/portal/orders/${order.id}/download/web.zip"><span>Web size</span><strong>1280 px JPEG</strong></a>
      </article>
      <article class="launch-card"><p class="launch-num">02</p><h3>Property sites</h3><p class="muted">Use the branded link for marketing and the unbranded link where MLS rules require it.</p>
        <a class="launch-link" href="${esc(branded)}" target="_blank" rel="noopener"><span>Branded site</span><strong>Agent details shown</strong></a>
        <a class="launch-link" href="${esc(unbranded)}" target="_blank" rel="noopener"><span>Unbranded site</span><strong>Property only</strong></a>
        <a class="launch-link" href="/site/${order.site_token}/qr.svg" download><span>QR code</span><strong>Download SVG</strong></a>
      </article>
      <article class="launch-card"><p class="launch-num">03</p><h3>Video and 3D</h3><p class="muted">Links saved in listing details stay together with the rest of the delivery.</p>
        ${mediaLinks.join('') || `<p class="launch-empty">No video or 3D tour links yet.</p><a class="launch-link" href="/portal/orders/${order.id}/details"><span>Add media links</span><strong>Listing details</strong></a>`}
      </article>
    </div>
    <p class="launch-note">Photo size options are generated from the delivered files on demand. Automated cloud storage processing will come after R2 is connected.</p>
  </section>`;
}

function orderDetail(agent, order, files, opts = {}) {
  const delivered = order.status === 'delivered' || order.status === 'paid';
  const unlocked = store.deliveryUnlocked(order);
  const gallery = files.length ? `<div class="grid3">${files.map(f => `
    <figure class="shot"><a class="shot-link" href="/files/${order.delivery_token}/${encodeURIComponent(f)}" data-lightbox="order-photos" data-download="1" data-caption="${esc(f)}" aria-label="View ${esc(f)} full size"><img loading="lazy" src="/files/${order.delivery_token}/${encodeURIComponent(f)}" alt="${esc(f)}"></a>
    <figcaption>${esc(f)} - <a href="/files/${order.delivery_token}/${encodeURIComponent(f)}" download>download</a></figcaption></figure>`).join('')}</div>`
    : '<div class="empty"><p>No files delivered yet.</p><p>This page fills in automatically when your media is ready.</p></div>';
  // Locked preview grid: watermarked, reduced-resolution derivatives only.
  // No /files/ URLs, no zip, no publishing until paid or released.
  const previewGrid = files.length ? `<div class="grid3">${files.map(f => `
    <figure class="shot"><a class="shot-link" href="/previews/${order.delivery_token}/${encodeURIComponent(f)}" data-lightbox="order-previews" data-caption="${esc(f)} - watermarked preview" aria-label="Preview ${esc(f)} (watermarked)"><img loading="lazy" src="/previews/${order.delivery_token}/${encodeURIComponent(f)}" alt="${esc(f)} (watermarked preview)"></a>
    <figcaption>${esc(f)} - preview</figcaption></figure>`).join('')}</div>` : '';
  const payPanel = opts.paymentsEnabled
    ? `<form method="post" action="/order/${order.id}/pay"><button class="btn" type="submit">Pay to unlock originals</button></form>
       <p class="muted">Checkout runs in Stripe test mode until live payments are switched on.</p>`
    : `<p class="muted">${esc(config.business.name)} will confirm payment with you. Full-resolution downloads and the property website open as soon as payment is received.</p>`;
  return portalLayout(agent, order.property.address, `
<section class="section">
  <p><a class="backlink" href="/portal">&larr; My properties</a></p>
  <p class="eyebrow">${esc(order.id)}</p>
  <h1>${esc(order.property.address)}</h1>
  <p class="muted">${esc(order.property.city || '')} ${esc(order.property.zip || '')}${order.property.sqft ? ' - ' + esc(order.property.sqft) + ' sq ft' : ''} ${order.preferred_date ? ' - shoot date ' + esc(order.preferred_date) : ''}</p>
  <p>Status: ${statusBadge(order)}</p>
  ${delivered && unlocked ? `<div class="notice ok">Your media is delivered. Download below, or <a href="/portal/orders/${order.id}/download.zip">download everything as one zip</a>.</div>`
    : delivered ? ''
    : `<div class="notice">This shoot is still in progress. Your gallery and property website open up on delivery.</div>`}
  ${files.length && unlocked ? launchKit(order, opts) : ''}
  ${files.length && unlocked ? `<h2 class="listing-head">Listing setup</h2>
  <p class="muted">Choose which photos appear, edit listing facts and media links, or update the agent branding used on the branded site.</p>
  <p><a class="btn ghost" href="/portal/orders/${order.id}/site">Choose site photos</a> <a class="btn ghost" href="/portal/orders/${order.id}/details">Edit listing details</a> <a class="btn ghost" href="/portal/branding">Edit branding</a></p>
  <p class="muted">${listingSummary(order)}</p>` : ''}
  ${files.length && !unlocked ? `<h2 class="listing-head">Your photos are ready (${files.length})</h2>
  <div class="notice">Payment for this order is still open. The previews below are watermarked and reduced resolution - originals, the zip download, and the property website unlock as soon as payment is completed.</div>
  ${payPanel}` : ''}
  ${files.length && !unlocked ? `<p class="muted">You can still <a href="/portal/orders/${order.id}/details">edit the listing details</a> for the property website while payment is pending.</p>` : ''}
  ${unlocked ? `<h2 class="listing-head">Delivered photos (${files.length})</h2>
  ${gallery}` : previewGrid}
</section>`);
}

// Shared locked page for direct hits on original file URLs before payment.
function deliveryLocked(order, fileCount) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delivery locked - ${esc(config.business.name)}</title><link rel="stylesheet" href="/static/styles.css?v=20260912f">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg"></head>
<body><header class="auth-head">${brand('/', 'Media')}</header><main class="auth-main"><div class="auth-card">
<p class="eyebrow">${esc(order.id)}</p><h1>Payment first,<br>then originals.</h1>
<div class="notice">This delivery${fileCount ? ' (' + fileCount + ' photos)' : ''} is ready, but full-resolution files stay locked until the order is paid. Watermarked previews are available in the agent portal.</div>
<p><a class="btn ghost" href="/portal/orders/${order.id}">Open this property in the portal</a></p>
</div></main></body></html>`;
}

function siteEditor(agent, order, files, saved) {
  const selected = order.site.selected; // null = everything, in delivery order
  const inSet = f => selected === null || selected.includes(f);
  const pos = f => {
    if (selected === null) return files.indexOf(f) + 1;
    const i = selected.indexOf(f);
    return i === -1 ? '' : i + 1;
  };
  const rows = files.map(f => `
    <div class="site-pick">
      <img loading="lazy" src="/files/${order.delivery_token}/${encodeURIComponent(f)}" alt="${esc(f)}">
      <label class="site-pick-toggle"><input type="checkbox" name="show_${esc(f)}" value="1" ${inSet(f) ? 'checked' : ''}> Show</label>
      <label class="site-pick-pos">Order <input type="number" name="pos_${esc(f)}" value="${pos(f)}" min="1" max="${files.length}" inputmode="numeric"></label>
    </div>`).join('');
  return portalLayout(agent, 'Property website', `
<section class="section narrow">
  <p><a class="backlink" href="/portal/orders/${order.id}">&larr; ${esc(order.property.address)}</a></p>
  <h1>Property<br>website.</h1>
  ${saved ? '<div class="notice ok">Saved. The live site is updated.</div>' : ''}
  <p class="muted">Check the photos to show, number them in the order you want, and save. The first photo becomes the cover. Your saved branding appears on the site automatically, and the photography credit always stays.</p>
  <form method="post" action="/portal/orders/${order.id}/site" class="form">
    <div class="site-picks">${rows}</div>
    <label class="site-pick-publish"><input type="checkbox" name="published" value="1" ${order.site.published ? 'checked' : ''}> Property website is live</label>
    <button class="btn block" type="submit">Save website</button>
  </form>
  <p class="muted">Live link: <a href="/site/${order.site_token}" target="_blank">/site/${order.site_token.slice(0, 10)}...</a></p>
</section>`);
}

const BRANDING_FIELDS = [
  ['display_name', 'Name to show on your property sites'],
  ['brokerage', 'Brokerage'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['brand_color', 'Accent color (hex, e.g. #5f6758)'],
  ['logo_url', 'Logo image URL (optional)'],
];

function branding(agent, saved) {
  const b = agent.branding || {};
  const inputs = BRANDING_FIELDS.map(([k, label]) =>
    `<label>${label}<input name="${k}" value="${esc(b[k] || '')}"${k === 'brand_color' ? ' placeholder="#5f6758"' : ''}></label>`).join('');
  return portalLayout(agent, 'Branding', `
<section class="section narrow">
  <p class="eyebrow">Reusable branding</p>
  <h1>Your<br>branding.</h1>
  ${saved ? '<div class="notice ok">Branding saved. It now applies to all of your property websites.</div>' : ''}
  <p class="muted">Set this once and every property website uses it. Leave a field blank and it simply stays off the site. Nothing here is invented for you.</p>
  <form method="post" action="/portal/branding" class="form">
    ${inputs}
    <button class="btn block" type="submit">Save branding</button>
  </form>
</section>`);
}


// ---------- agent-entered listing details ----------

const LISTING_TYPES = [
  ['single-family', 'Single-family home'],
  ['condo', 'Condo'],
  ['townhouse', 'Townhouse'],
  ['multi-family', 'Duplex / multi-family'],
  ['farm-ranch', 'Farm / ranch'],
  ['land', 'Land'],
  ['other', 'Other'],
];
const LISTING_TYPE_LABELS = Object.fromEntries(LISTING_TYPES);

function typeLabel(key) { return LISTING_TYPE_LABELS[key] || ''; }

function formatPrice(p) {
  return /^\d+$/.test(String(p)) ? '$' + Number(p).toLocaleString('en-US') : String(p);
}

function formatSqft(s) {
  return /^\d+$/.test(String(s)) ? Number(s).toLocaleString('en-US') : String(s);
}

function listingSummary(order) {
  const L = order.listing || {};
  const bits = [];
  if (L.price) bits.push(formatPrice(L.price));
  if (L.beds) bits.push(L.beds + ' bd');
  if (L.baths) bits.push(L.baths + ' ba');
  const sqft = L.sqft || (order.property && order.property.sqft) || '';
  if (sqft) bits.push(formatSqft(sqft) + ' sq ft');
  if (L.lot_size) bits.push(L.lot_size);
  if (L.year_built) bits.push('built ' + L.year_built);
  if (typeLabel(L.property_type)) bits.push(typeLabel(L.property_type));
  if (L.description) bits.push('description');
  if (L.video_url) bits.push('video');
  if (L.tour_url) bits.push('3D tour');
  return bits.length
    ? 'Listing details on the site: ' + esc(bits.join(' - ')) + '.'
    : 'No listing details yet. Add a description, price, beds, and baths so the site shows more than photos.';
}

function detailsEditor(agent, order, errors, values, saved) {
  const L = values || order.listing || {};
  const val = k => esc(L[k] == null ? '' : L[k]);
  const err = k => (errors && errors[k]) ? `<div class="field-err">${esc(errors[k])}</div>` : '';
  const typeOptions = ['<option value="">Choose one (optional)</option>']
    .concat(LISTING_TYPES.map(([k, label]) => `<option value="${k}" ${L.property_type === k ? 'selected' : ''}>${label}</option>`)).join('');
  return portalLayout(agent, 'Listing details', `
<section class="section narrow">
  <p><a class="backlink" href="/portal/orders/${order.id}">&larr; ${esc(order.property.address)}</a></p>
  <p class="eyebrow">Property website</p>
  <h1>Listing<br>details.</h1>
  ${saved ? '<div class="notice ok">Saved. The property website shows these details now.</div>' : ''}
  <p class="muted">These facts appear on the public property website with your photos. Fill in only what you know is right for this listing - every field is optional and blank fields stay hidden.</p>
  <form method="post" action="/portal/orders/${order.id}/details" class="form">
    <h2>Listing facts</h2>
    <div class="row">
      <label>List price (USD)<input name="price" inputmode="numeric" placeholder="485000" value="${val('price')}">${err('price')}</label>
      <label>Bedrooms<input name="beds" inputmode="numeric" placeholder="4" value="${val('beds')}">${err('beds')}</label>
      <label>Bathrooms<input name="baths" inputmode="decimal" placeholder="2.5" value="${val('baths')}">${err('baths')}</label>
      <label>Living area (sq ft)<input name="sqft" inputmode="numeric" placeholder="2400" value="${val('sqft')}">${err('sqft')}</label>
    </div>
    <div class="row">
      <label>Lot size<input name="lot_size" placeholder="0.18 acres" value="${val('lot_size')}">${err('lot_size')}</label>
      <label>Year built<input name="year_built" inputmode="numeric" placeholder="1998" value="${val('year_built')}">${err('year_built')}</label>
      <label>Property type<select name="property_type">${typeOptions}</select>${err('property_type')}</label>
    </div>
    <h2>Public description</h2>
    <label>Description<textarea name="description" rows="8" maxlength="1500" placeholder="What should buyers know about this home?">${val('description')}</textarea>${err('description')}</label>
    <p class="muted">A blank line starts a new paragraph on the site. Leave it empty and the section stays hidden.</p>
    <h2>Video and 3D tour</h2>
    <label>Listing video link<input name="video_url" inputmode="url" placeholder="https://www.youtube.com/watch?v=..." value="${val('video_url')}">${err('video_url')}</label>
    <label>3D tour link<input name="tour_url" inputmode="url" placeholder="https://my.matterport.com/show/?m=..." value="${val('tour_url')}">${err('tour_url')}</label>
    <p class="muted">YouTube or Vimeo for video, Matterport or Zillow 3D for tours. Each link embeds on the property website; blank fields stay hidden.</p>
    <button class="btn block" type="submit">Save details</button>
  </form>
</section>`);
}

// ---------- public property website ----------

function propertySite(order, files, agent, opts = {}) {
  const unbranded = !!opts.unbranded;
  const b = !unbranded && agent && agent.branding ? agent.branding : {};
  const accent = /^#[0-9a-fA-F]{6}$/.test(b.brand_color || '') ? b.brand_color : '#171714';
  const L = order.listing || {};
  const sqft = L.sqft || order.property.sqft || '';
  const hero = files[0];
  const idBits = [];
  if (b.logo_url) idBits.push(`<img class="psite-logo" src="${esc(b.logo_url)}" alt="">`);
  if (b.display_name) idBits.push(`<strong>${esc(b.display_name)}</strong>`);
  if (b.brokerage) idBits.push(`<span>${esc(b.brokerage)}</span>`);
  const contactBits = [];
  if (b.phone) contactBits.push(`<a class="btn small ghost" href="tel:${esc(b.phone.replace(/[^0-9+]/g, ''))}">${esc(b.phone)}</a>`);
  if (b.email) contactBits.push(`<a class="btn small ghost" href="mailto:${esc(b.email)}">${esc(b.email)}</a>`);
  const brandBits = (idBits.length || contactBits.length)
    ? [`<p class="eyebrow">Listed by</p><div class="psite-agent-id">${idBits.join('')}</div>`]
        .concat(contactBits.length ? [`<div class="psite-agent-contact">${contactBits.join('')}</div>`] : [])
    : [];
  // Listing facts: agent-entered only, blank fields stay hidden.
  const facts = [];
  if (L.price) facts.push(`<span class="psite-fact psite-fact-price">${esc(formatPrice(L.price))}</span>`);
  if (L.beds) facts.push(`<span class="psite-fact"><strong>${esc(L.beds)}</strong> bd</span>`);
  if (L.baths) facts.push(`<span class="psite-fact"><strong>${esc(L.baths)}</strong> ba</span>`);
  if (sqft) facts.push(`<span class="psite-fact"><strong>${esc(formatSqft(sqft))}</strong> sq ft</span>`);
  if (L.lot_size) facts.push(`<span class="psite-fact">${esc(L.lot_size)}</span>`);
  if (L.year_built) facts.push(`<span class="psite-fact">Built ${esc(L.year_built)}</span>`);
  if (typeLabel(L.property_type)) facts.push(`<span class="psite-fact">${esc(typeLabel(L.property_type))}</span>`);
  const descHtml = L.description
    ? L.description.split(/\n{2,}/).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')
    : '';
  // Optional link-based media. Stored links are re-validated at render so the
  // section appears only for providers we embed, and photo-only listings are
  // untouched. A future "use a delivered video file" option adds an item here.
  const mediaItems = [];
  const vid = media.parseMediaUrl(L.video_url || '');
  if (vid && vid.kind === 'video') mediaItems.push({ label: 'Listing video', embed: vid.embedUrl });
  const tour = media.parseMediaUrl(L.tour_url || '');
  if (tour && tour.kind === 'tour') mediaItems.push({ label: '3D tour', embed: tour.embedUrl });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(order.property.address)}${unbranded ? '' : ' - ' + esc(config.business.name)}</title>
<link rel="stylesheet" href="/static/styles.css?v=20260912f">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg"></head>
<body class="psite">
${hero ? `<section class="psite-hero" style="background-image:linear-gradient(rgba(12,14,12,.1),rgba(12,14,12,.55)),url('/sitefiles/${order.site_token}/${encodeURIComponent(hero)}')">
  <div class="psite-hero-inner"><h1>${esc(order.property.address)}</h1><p>${esc(order.property.city || '')} ${esc(order.property.zip || '')}</p></div>
</section>` : `<section class="section"><h1>${esc(order.property.address)}</h1></section>`}
${facts.length ? `<section class="psite-facts"><div class="psite-facts-inner">${facts.join('')}</div></section>` : ''}
${brandBits.length ? `<section class="psite-brand" style="border-color:${esc(accent)}"><div class="psite-brand-inner">${brandBits.join('')}</div></section>` : ''}
${descHtml ? `<section class="section psite-desc">
  <p class="eyebrow">About this property</p>
  ${descHtml}
</section>` : ''}
${mediaItems.length ? `<section class="section psite-media">
  ${mediaItems.map(m => `<figure class="psite-media-item">
    <figcaption class="eyebrow">${m.label}</figcaption>
    <div class="psite-media-frame"><iframe src="${esc(m.embed)}" title="${m.label} for ${esc(order.property.address)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; xr-spatial-tracking; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>
  </figure>`).join('')}
</section>` : ''}
<section class="section">
  <div class="grid3">${files.map(f => `
    <figure class="shot"><a class="shot-link" href="/sitefiles/${order.site_token}/${encodeURIComponent(f)}" data-lightbox="property-photos" data-caption="${esc(order.property.address)}" aria-label="View ${esc(order.property.address)} photo full size"><img loading="lazy" src="/sitefiles/${order.site_token}/${encodeURIComponent(f)}" alt="${esc(order.property.address)} photo"></a>
    </figure>`).join('')}</div>
</section>
${unbranded ? '' : `<footer class="psite-credit"><span class="psite-credit-mark" aria-hidden="true"><i>J</i>W</span><span>Photography by ${esc(order.credit || config.business.name)}</span></footer>`}
<script src="/static/lightbox.js?v=20260912d" defer></script>
</body></html>`;
}

function siteUnavailable() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Property website - ${esc(config.business.name)}</title><link rel="stylesheet" href="/static/styles.css?v=20260912f">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg"></head>
<body><header class="auth-head">${brand('/', 'Media')}</header><main class="auth-main"><div class="auth-card"><h1>Not live yet</h1><p class="muted">This property website is not published yet. Check back after the media is delivered.</p></div></main></body></html>`;
}

function derivativeError(agent, order) { return portalLayout(agent, 'Download unavailable', `<section class="section narrow"><p class="eyebrow">${esc(order.id)}</p><h1>That ZIP could not be made.</h1><p class="muted">The delivered originals are safe. Try the download again, or contact JWRE Media if it keeps happening.</p><p><a class="btn ghost" href="/portal/orders/${order.id}">Back to the launch kit</a></p></section>`); }

module.exports = { portalLayout, login, signup, dashboard, orderDetail, siteEditor, detailsEditor, branding, propertySite, siteUnavailable, deliveryLocked, derivativeError, BRANDING_FIELDS, LISTING_TYPES };
