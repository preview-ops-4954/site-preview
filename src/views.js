'use strict';
const config = require('./config');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = cents => cents == null ? 'TBD' : '$' + (cents / 100).toFixed(0);

const PORTFOLIO = [
  { src: 'front-hero.jpg', alt: 'Modern farmhouse front elevation at dusk', tag: 'Exterior - Farmhouse listing', listing: 'farmhouse' },
  { src: 'living-room.jpg', alt: 'Bright staged living room', tag: 'Living - Farmhouse listing', listing: 'farmhouse' },
  { src: 'kitchen-modern.jpg', alt: 'Modern kitchen', tag: 'Kitchen - Farmhouse listing', listing: 'farmhouse' },
  { src: 'master-suite.jpg', alt: 'Primary bedroom with accent wall', tag: 'Primary suite - Farmhouse listing', listing: 'farmhouse' },
  { src: 'master-bath.jpg', alt: 'Primary bath with walk-in shower', tag: 'Primary bath - Farmhouse listing', listing: 'farmhouse' },
  { src: 'backyard-pool.jpg', alt: 'Backyard with plunge pool', tag: 'Outdoor living - Farmhouse listing', listing: 'farmhouse' },
  { src: 'ranch-exterior.jpg', alt: 'White brick ranch exterior', tag: 'Exterior - Ranch listing', listing: 'ranch' },
  { src: 'kitchen-ranch.jpg', alt: 'White and wood kitchen', tag: 'Kitchen - Ranch listing', listing: 'ranch' },
  { src: 'living-ranch.jpg', alt: 'Open living and dining room', tag: 'Living - Ranch listing', listing: 'ranch' },
];

const img = (src, alt, cls = '') =>
  `<img loading="lazy" ${cls ? `class="${cls}" ` : ''}src="/static/portfolio/${src}" alt="${esc(alt)}">`;

// Brand lockup: JW monogram tile + editorial wordmark. Shared by the public,
// admin, and portal headers so the mark stays identical everywhere.
function brand(href, sub, extraHtml = '') {
  const word = esc(String(config.business.name || 'JWRE').split(/\s+/)[0] || 'JWRE');
  const label = word + (sub ? ' ' + esc(sub) : '');
  return `<a class="brand" href="${href}" aria-label="${label} - home">`
    + `<span class="brand-mark" aria-hidden="true"><i>J</i>W</span>`
    + `<span class="brand-type"><span class="brand-name">${word}</span>`
    + (sub ? `<span class="brand-sub">${esc(sub)}</span>` : '')
    + `</span>${extraHtml}</a>`;
}

function layout(title, body, opts = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(config.business.tagline)}. Serving ${esc(config.business.area)}.">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)} - ${esc(config.business.name)}">
<meta property="og:description" content="${esc(config.business.tagline)}. Serving ${esc(config.business.area)}.">
<meta property="og:image" content="__ORIGIN__/static/portfolio/front-hero.jpg">
<title>${esc(title)} - ${esc(config.business.name)}</title>
<link rel="stylesheet" href="/static/styles.css?v=20260912j">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
</head>
<body>
<header class="nav">
  ${brand('/', 'Media')}
  <nav>
    <a href="/portfolio">Portfolio</a>
    <a href="/services">Services &amp; Pricing</a>
    <a class="cta" href="/book">Book a Shoot</a>
  </nav>
</header>
<main>${body}</main>
<footer class="foot">
  <div class="foot-grid">
    <div class="foot-brand">${brand('/', 'Media')}
      <p class="muted">${esc(config.business.tagline)}. Serving ${esc(config.business.area)}.</p>
    </div>
    <nav class="foot-nav" aria-label="Footer">
      <a href="/portfolio">Portfolio</a>
      <a href="/services">Services &amp; Pricing</a>
      <a href="/book">Book a Shoot</a>
      <a href="/portal/login">Agent portal</a>
    </nav>
    <div class="foot-meta muted">
      <p>${esc(config.business.area)}</p>
    </div>
  </div>
</footer>
</body>
</html>`;
}

function home() {
  return layout('Real estate photography', `
<section class="hero" style="background-image:linear-gradient(rgba(12,14,12,.12),rgba(12,14,12,.72)),url('/static/portfolio/front-hero.jpg')">
  <div class="hero-inner">
    <h1>Listing media that sells the showing.</h1>
    <p>Photography, drone, video, 3D tours, and floor plans for Austin-area agents - booked online in two minutes.</p>
    <div class="hero-ctas">
      <a class="btn" href="/book">Book a shoot</a>
      <a class="btn ghost" href="/portfolio">See the work</a>
    </div>
  </div>
</section>
<div class="strip" id="strip">
  ${img('living-room.jpg', 'Bright staged living room')}
  ${img('kitchen-modern.jpg', 'Modern kitchen with island')}
  ${img('backyard-pool.jpg', 'Backyard with plunge pool')}
</div>
<section class="section" id="shoot">
  <p class="eyebrow">What we shoot</p>
  <div class="section-head"><h2>Every part of<br>the listing.</h2><p class="muted">Interiors, exteriors, aerials, video, and 3D tours - the details buyers scroll for, captured in one visit and delivered in one private gallery.</p></div>
  <div class="tiles">
    <a class="tile" href="/services">${img('thumb-living-ranch.jpg', 'Open living and dining room')}<span>Interiors</span></a>
    <a class="tile" href="/services">${img('thumb-master-bath.jpg', 'Primary bath with walk-in shower')}<span>Kitchens &amp; baths</span></a>
    <a class="tile" href="/services">${img('thumb-ranch-exterior.jpg', 'White brick ranch exterior')}<span>Exteriors &amp; curb appeal</span></a>
    <a class="tile" href="/services">${img('thumb-backyard-pool.jpg', 'Backyard with plunge pool')}<span>Outdoor living</span></a>
  </div>
</section>
<section class="section" id="included">
  <div class="split">
    ${img('master-suite.jpg', 'Primary bedroom with accent wall')}
    <div>
      <p class="eyebrow">Every shoot includes</p>
      <h2>Careful coverage,<br>nothing to chase.</h2>
      <ul class="checklist">
        <li>Edited, MLS-ready files - no watermarks, no waiting on email threads</li>
        <li>One private online gallery to view and download everything</li>
        <li>Blue-sky replacement on overcast shoot days</li>
        <li>Next-business-day delivery goal</li>
      </ul>
    </div>
  </div>
</section>
<section class="section" id="process">
  <p class="eyebrow">A simple process</p>
  <div class="section-head"><h2>From booking to<br>listing-ready.</h2><p class="muted">Clear communication, careful photography, and one private place for every finished file.</p></div>
  <div class="process">
    <div class="process-item"><span class="process-num">01</span><h3>Book</h3><p>Choose your media and preferred shoot window.</p></div>
    <div class="process-item"><span class="process-num">02</span><h3>Capture</h3><p>We photograph the property with a clean, natural approach.</p></div>
    <div class="process-item"><span class="process-num">03</span><h3>Deliver</h3><p>Download polished files from one private gallery.</p></div>
  </div>
</section>
<section class="section" id="recent">
  <p class="eyebrow">Selected properties</p>
  <h2>Recent work</h2>
  <div class="grid3">
    ${PORTFOLIO.map(p => `<a class="shot" href="/portfolio"><img loading="lazy" src="/static/portfolio/thumb-${p.src}" alt="${esc(p.alt)}"><span>${esc(p.tag)}</span></a>`).join('')}
  </div>
  <p class="center"><a class="btn ghost" href="/portfolio">Full portfolio</a></p>
</section>
<section class="cta-band" id="cta" style="background-image:linear-gradient(rgba(12,14,12,.35),rgba(12,14,12,.6)),url('/static/portfolio/ranch-exterior.jpg')">
  <p class="eyebrow light">Austin metro</p>
  <h2>Ready when<br>the listing is.</h2>
  <a class="btn" href="/book">Book your shoot</a>
</section>`);
}

function portfolio() {
  const group = key => PORTFOLIO.filter(p => p.listing === key);
  return layout('Portfolio', `
<section class="section">
  <p class="eyebrow">Selected properties</p>
  <h1>Quiet images.<br>Clear spaces.</h1>
  <p class="muted">A sample of recent listing shoots across the Austin metro.</p>
  <h2 class="listing-head">Farmhouse listing</h2>
  <div class="grid3">
    ${group('farmhouse').map(p => `<figure class="shot"><img loading="lazy" src="/static/portfolio/${p.src}" alt="${esc(p.alt)}"><figcaption>${esc(p.tag)}</figcaption></figure>`).join('')}
  </div>
  <h2 class="listing-head">Ranch listing</h2>
  <div class="grid3">
    ${group('ranch').map(p => `<figure class="shot"><img loading="lazy" src="/static/portfolio/${p.src}" alt="${esc(p.alt)}"><figcaption>${esc(p.tag)}</figcaption></figure>`).join('')}
  </div>
  <p class="center"><a class="btn" href="/book">Book your shoot</a></p>
</section>`);
}

function services(catalog = { packages: config.packages, addons: config.addons }) {
  const packages = catalog.packages || config.packages;
  const addons = catalog.addons || config.addons;
  return layout('Services and pricing', `
<section class="section">
  <p class="eyebrow">Services</p>
  <h1>Only what the<br>listing needs.</h1>
  <div class="notice">Book now to reserve your window - we confirm the exact quote before your shoot. Nothing is due today.</div>
  <div class="strip inset">
    ${img('living-room.jpg', 'Bright staged living room')}
    ${img('kitchen-ranch.jpg', 'White and wood kitchen')}
    ${img('front-hero.jpg', 'Modern farmhouse front elevation at dusk')}
  </div>
  <div class="cols3">
    ${packages.map(p => `
    <div class="card ${p.featured ? 'featured' : ''}">
      ${p.featured ? '<div class="flag">Most popular</div>' : ''}
      <h3>${esc(p.name)}</h3>
      <p class="muted">${esc(p.tagline)}</p>
      <p class="price">${money(p.priceCents)}</p>
      <ul>${p.includes.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
      <a class="btn block" href="/book?package=${p.id}">Choose ${esc(p.name.split(' ')[0])}</a>
    </div>`).join('')}
  </div>
  <h2>Add-ons</h2>
  <div class="cols3">
    ${addons.map(a => `<div class="card"><h3>${esc(a.name)}</h3><p class="price small">${money(a.priceCents)}</p></div>`).join('')}
  </div>
  <div class="facts">
    <p><strong>Delivery</strong><br>Every order lands in a private online gallery - view and download from one link.</p>
    <p><strong>Scheduling</strong><br>Pick your preferred window when you book; we confirm the exact time by email or text.</p>
    <p><strong>Weather</strong><br>Drone and twilight calls are made the morning of the shoot - no charge to reschedule.</p>
  </div>
</section>`);
}

function bookForm(selectedPackage, errors = {}, values = {}, agent = null, catalog = { packages: config.packages, addons: config.addons }) {
  const packages = catalog.packages || config.packages;
  const addons = catalog.addons || config.addons;
  const v = k => esc(values[k] || '');
  const pkgCards = packages.map(p => `
    <label class="pick ${values.package_id === p.id || (!values.package_id && p.id === selectedPackage) ? 'sel' : ''}">
      <input type="radio" name="package_id" value="${p.id}" ${values.package_id === p.id || (!values.package_id && p.id === selectedPackage) ? 'checked' : ''} required>
      <strong>${esc(p.name)}</strong>
      <span class="muted">${esc(p.tagline)}</span>
      <span class="price small">${money(p.priceCents)}</span>
    </label>`).join('');
  const addonBoxes = addons.map(a => `
    <label class="pick">
      <input type="checkbox" name="addon_${a.id}" value="1" ${values['addon_' + a.id] ? 'checked' : ''}>
      <strong>${esc(a.name)}</strong>
      <span class="price small">${money(a.priceCents)}</span>
    </label>`).join('');
  const err = k => errors[k] ? `<div class="field-err">${esc(errors[k])}</div>` : '';
  return layout('Book a shoot', `
<section class="section booking-page">
  <div class="booking-intro">
  <p class="eyebrow">Request a session</p>
  <h1>Tell us about<br>the property.</h1>
  <div class="strip inset small">
    ${img('thumb-kitchen-modern.jpg', 'Modern kitchen')}
    ${img('thumb-living-ranch.jpg', 'Open living and dining room')}
    ${img('thumb-front-hero.jpg', 'Farmhouse front elevation')}
  </div>
  <div class="notice">We confirm the exact quote before your shoot. No charge is made today.</div>
  <div class="booking-promises" aria-label="Booking steps"><span><b>01</b> Choose services</span><span><b>02</b> Pick a window</span><span><b>03</b> We confirm</span></div>
  </div>
  <form method="post" action="/book" class="form booking-form">
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <h2>Property</h2>
    <label>Street address *<input name="address" value="${v('address')}" required>${err('address')}</label>
    <div class="row">
      <label>City<input name="city" value="${v('city') || 'Austin'}"></label>
      <label>ZIP<input name="zip" value="${v('zip')}"></label>
      <label>Approx. sq ft<input name="sqft" inputmode="numeric" value="${v('sqft')}"></label>
    </div>
    <h2>Package *</h2>
    <div class="picks">${pkgCards}</div>
    ${err('package_id')}
    <h2>Add-ons</h2>
    <div class="picks">${addonBoxes}</div>
    <h2>Preferred schedule</h2>
    <div class="row">
      <label>Date<input type="date" name="preferred_date" value="${v('preferred_date')}"></label>
      <label>Start time<input type="time" name="preferred_time" value="${v('preferred_time')}"></label>
    </div>
    <p class="muted">We confirm the exact window by email/text. Weather calls (especially drone) are made the morning of the shoot.</p>
    <h2>Your details</h2>
    ${agent ? `
    <div class="notice">Booking as <strong>${esc(agent.name || agent.email)}</strong> (${esc(agent.email)}). <a href="/portal/logout">Not you?</a></div>
    <label>Phone<input name="phone" value="${esc(values.phone || agent.phone || '')}" autocomplete="tel"></label>` : `
    <div class="row">
      <label>Name *<input name="name" value="${v('name')}" required>${err('name')}</label>
      <label>Email *<input type="email" name="email" value="${v('email')}" required>${err('email')}</label>
      <label>Phone<input name="phone" value="${v('phone')}"></label>
    </div>`}
    <label>Notes (gate codes, lockbox, must-have shots)<textarea name="notes" rows="3">${v('notes')}</textarea></label>
    <div class="booking-submit"><div><span class="eyebrow">Next step</span><strong>Review and send your request</strong><small>Nothing is charged today.</small></div><button class="btn" type="submit">Place booking request</button></div>
  </form>
</section>`);
}

function confirm(order, q = {}, stripeReady) {
  const pkg = order.package_snapshot || config.packages.find(p => p.id === order.package_id);
  const addons = (order.addon_snapshots && order.addon_snapshots.length ? order.addon_snapshots : config.addons.filter(a => order.addon_ids.includes(a.id)));
  const total = (pkg ? pkg.priceCents : 0) + addons.reduce((s, a) => s + a.priceCents, 0);
  let payBlock;
  if (order.payment_status === 'paid') {
    payBlock = `<div class="notice ok">Payment received. Thank you!</div>`;
  } else if (stripeReady) {
    payBlock = `<form method="post" action="/order/${order.id}/pay"><button class="btn block" type="submit">Pay ${money(total)} (Stripe test mode)</button></form>
    <p class="muted">Checkout runs in Stripe test mode until live payments are switched on.</p>`;
  } else {
    payBlock = `<p class="muted">Online payment activates once pricing is confirmed - we will email you a payment link. Nothing is due now.</p>`;
  }
  return layout('Booking received', `
<section class="section narrow">
  <h1>Booking received</h1>
  ${q.canceled ? '<div class="notice">Checkout was canceled - your booking is still held, unpaid.</div>' : ''}
  <div class="notice ok">Order <strong>${esc(order.id)}</strong> is in. We will confirm your schedule window and final quote shortly.</div>
  <div class="card">
    <h3>${esc(order.property.address)}</h3>
    <p>${esc(order.property.city || '')} ${esc(order.property.zip || '')}</p>
    <p><strong>Package:</strong> ${pkg ? esc(pkg.name) : esc(order.package_id)}${addons.length ? ' + ' + addons.map(a => esc(a.name)).join(', ') : ''}</p>
    <p><strong>Preferred:</strong> ${esc(order.preferred_date || 'flexible')} ${esc(order.preferred_time || '')}</p>
    <p><strong>Estimated total:</strong> ${money(total)}</p>
    <p><strong>Status:</strong> <span class="badge s-${order.status}">${esc(order.status)}</span> <strong>Payment:</strong> ${esc(order.payment_status)}</p>
  </div>
  ${payBlock}
  <p class="muted">When your media is ready, your private gallery link will appear here and be emailed to you.</p>
  <p class="muted">Gallery link (activates on delivery): <a href="/gallery/${order.delivery_token}">/gallery/${order.delivery_token.slice(0, 8)}...</a></p>
</section>`);
}

function gallery(order, files, unlocked = true) {
  const delivered = order.status === 'delivered' || order.status === 'paid';
  const locked = delivered && files.length && !unlocked;
  return layout('Your gallery', `
<section class="section">
  <h1>${esc(order.property.address)}</h1>
  <p class="muted">Order ${esc(order.id)} - ${delivered ? 'your media is ready.' : 'media in preparation.'}</p>
  ${!delivered ? `<div class="notice">We are still working on this order (status: <span class="badge s-${order.status}">${esc(order.status)}</span>). This page updates automatically when your gallery is delivered.</div>` : ''}
  ${locked ? `<div class="notice">Payment for this order is still open. Below are watermarked previews - full-resolution originals and downloads unlock as soon as payment is completed.</div>` : ''}
  ${locked ? `<div class="grid3">${files.map(f => `
    <figure class="shot"><img loading="lazy" src="/previews/${order.delivery_token}/${encodeURIComponent(f)}" alt="${esc(f)} (watermarked preview)">
    <figcaption>${esc(f)} - preview, originals unlock after payment</figcaption></figure>`).join('')}</div>`
    : files.length ? `<div class="grid3">${files.map(f => `
    <figure class="shot"><img loading="lazy" src="/files/${order.delivery_token}/${encodeURIComponent(f)}" alt="${esc(f)}">
    <figcaption>${esc(f)}</figcaption></figure>`).join('')}</div>
    <p class="muted">Original downloads and the full zip live in the <a href="/portal/login">agent portal</a>.</p>` : '<div class="empty"><p>No files delivered yet.</p><p>Finished photos appear here automatically once the shoot is edited and delivered.</p></div>'}
</section>`);
}

module.exports = { esc, money, brand, layout, home, portfolio, services, bookForm, confirm, gallery, PORTFOLIO };
