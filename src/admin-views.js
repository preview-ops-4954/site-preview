'use strict';
const config = require('./config');
const v = require('./views');
const esc = v.esc, money = v.money;

// Admin pages reuse the stylesheet but with a bare admin layout (no public nav).
function adminLayout(title, body, user = null) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - JWRE Admin</title>
<link rel="stylesheet" href="/static/styles.css?v=20260912j">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg"></head>
<body><header class="nav keep-links">${v.brand('/admin', 'Studio')}
<nav><a href="/admin">Jobs</a><a href="/admin/shoots">Shoots</a><a href="/admin/clients">Clients</a><a href="/admin/catalog">Services</a><a href="/admin/billing">Billing</a>${user && user.role === 'owner' ? '<a href="/admin/team">Team</a>' : ''}<a href="/" target="_blank">View site</a><a href="/admin/logout">Log out</a></nav></header>
<main>${body}</main></body></html>`;
}

function login(error, locked = false) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studio login</title><link rel="stylesheet" href="/static/styles.css?v=20260912e">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg"></head>
<body><header class="auth-head">${v.brand('/', 'Studio')}</header><main class="auth-main"><div class="auth-card">
<p class="eyebrow">JWRE Studio</p><h1>Sign in</h1>
<p class="muted">Your private workspace for jobs, deliveries, clients, and billing.</p>
${locked ? '<div class="notice bad">Too many attempts. Try again in 15 minutes.</div>' : error ? '<div class="notice bad">Email or password is incorrect.</div>' : ''}
<form method="post" action="/admin/login" class="form">
<label>Email<input type="email" name="email" autofocus required autocomplete="username"></label>
<label>Password<input type="password" name="password" required autocomplete="current-password"></label>
<button class="btn block" type="submit">Sign in</button></form>
<p class="recovery-link"><a href="/admin/recover">Forgot username or password?</a></p>
<p class="muted" style="margin-top:2rem"><a class="backlink" href="/">&larr; Back to the site</a></p>
</div></main></body></html>`;
}

function changePassword(error) {
  return adminLayout('Set password', `<section class="section narrow"><p class="eyebrow">Account security</p><h1>Set your password</h1>
  <p class="muted">Choose a private password with at least 12 characters before continuing.</p>
  ${error ? '<div class="notice bad">Use at least 12 characters and make both entries match.</div>' : ''}
  <form method="post" action="/admin/password" class="form"><label>New password<input type="password" name="password" minlength="12" required autocomplete="new-password"></label>
  <label>Confirm password<input type="password" name="confirm" minlength="12" required autocomplete="new-password"></label><button class="btn" type="submit">Save password</button></form></section>`);
}

function team(users, audit, flash, current) {
  const rows=users.map(u=>`<div class="prop-row"><span class="prop-main"><strong>${esc(u.name)}</strong><span class="muted">${esc(u.email)} - ${esc(u.role)} - ${u.active?'active':'disabled'}</span></span>
  <span class="prop-side team-actions">${String(u.id)===String(current.id)?'<span class="badge paid">you</span>':`<form method="post" action="/admin/team/${u.id}/reset" onsubmit="return confirm('Reset this password and sign out existing sessions?')"><button class="btn small ghost">reset password</button></form><form method="post" action="/admin/team/${u.id}/toggle" onsubmit="return confirm('${u.active?'Disable':'Enable'} this account?')"><button class="btn small ghost">${u.active?'disable':'enable'}</button></form>`}</span></div>`).join('');
  const log=audit.map(a=>`<li><time>${esc(new Date(a.created_at).toLocaleString('en-US'))}</time><span><strong>${esc(a.actor_name||'System')}</strong> ${esc(a.event.replaceAll('_',' '))}${a.target_name?' - '+esc(a.target_name):''}</span></li>`).join('');
  return adminLayout('Team',`<section class="section narrow"><p class="eyebrow">Access control</p><h1>Studio team</h1>${flash||''}<p class="muted">Owners manage accounts. Photographers can run the full production workflow but cannot manage Studio access.</p>
  <h2 class="listing-head">Add a photographer</h2><form method="post" action="/admin/team" class="form"><div class="row"><label>Name<input name="name" required></label><label>Email<input type="email" name="email" required></label><label>Role<select name="role"><option value="photographer">Photographer</option><option value="owner">Owner</option></select></label></div><button class="btn">Create account</button></form>
  <h2 class="listing-head">Current team</h2><div class="prop-list">${rows}</div><h2 class="listing-head">Recent access activity</h2><ul class="timeline">${log||'<li>No activity yet.</li>'}</ul></section>`,current);
}

function recovery(portal, sent=false, reset=false, error=false) {
  const base=portal==='studio'?'/admin':'/portal';
  if(sent)return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/static/styles.css?v=20260912e"></head><body><header class="auth-head">${v.brand('/',portal==='studio'?'Studio':'Agent Portal')}</header><main class="auth-main"><div class="auth-card"><p class="eyebrow">Account recovery</p><h1>Check your instructions</h1><p class="muted">If an account matches, recovery instructions will be delivered through the configured JWRE support channel. This response is the same for every request.</p><p><a class="btn" href="${base}/login">Back to sign in</a></p></div></main></body></html>`;
  if(reset)return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/static/styles.css?v=20260912e"></head><body><header class="auth-head">${v.brand('/',portal==='studio'?'Studio':'Agent Portal')}</header><main class="auth-main"><div class="auth-card"><p class="eyebrow">Account recovery</p><h1>Choose a new password</h1>${error?'<div class="notice bad">This link is invalid or expired, or the passwords do not match.</div>':''}<form method="post" class="form"><label>New password<input type="password" name="password" minlength="12" required autocomplete="new-password"></label><label>Confirm password<input type="password" name="confirm" minlength="12" required autocomplete="new-password"></label><button class="btn block">Save password</button></form></div></main></body></html>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/static/styles.css?v=20260912e"></head><body><header class="auth-head">${v.brand('/',portal==='studio'?'Studio':'Agent Portal')}</header><main class="auth-main"><div class="auth-card"><p class="eyebrow">Account recovery</p><h1>Find your account</h1><p class="muted">Enter the email address used for your account. The recovery message includes your sign-in email and a password-reset link.</p><form method="post" class="form"><label>Email<input type="email" name="email" required autocomplete="email"></label><button class="btn block">Request recovery</button></form><p class="recovery-link"><a href="${base}/login">Back to sign in</a></p></div></main></body></html>`;
}

const STATUSES = ['booked', 'scheduled', 'shot', 'editing', 'delivered', 'paid'];

function orderTotal(o) {
  const pkg = o.package_snapshot || config.packages.find(p => p.id === o.package_id);
  const addons = (o.addon_snapshots && o.addon_snapshots.length ? o.addon_snapshots : config.addons.filter(a => o.addon_ids.includes(a.id)));
  return (pkg ? pkg.priceCents : 0) + addons.reduce((s, a) => s + a.priceCents, 0);
}

function agentName(agents, id) {
  const a = agents.find(x => x.id === id);
  return a ? (a.name || a.email) : '';
}

function orderCard(o, agents) {
  const agent = o.agent_id ? agentName(agents, o.agent_id) : '';
  // Demo data often has the same person as customer and agent; show them once.
  const who = agent && agent.toLowerCase().includes((o.customer.name || '').toLowerCase())
    ? agent
    : [o.customer.name, agent].filter(Boolean).join(' - ');
  return `<a class="job-card" href="/admin/orders/${o.id}">
    <strong>${esc(o.property.address)}</strong>
    <span class="job-id">${esc(o.id)}</span>
    <span class="muted">${esc(who)}</span>
    <span class="muted">${esc(o.preferred_date || 'unscheduled')} ${esc(o.preferred_time || '')}</span>
    ${o.payment_status === 'paid' ? '<span class="badge paid">paid</span>' : o.delivery_release ? '<span class="badge released">released</span>' : '<span class="badge unpaid">unpaid</span>'}
  </a>`;
}

function dashboard(orders, agents) {
  const cols = STATUSES.map(s => {
    const list = orders.filter(o => o.status === s);
    return `<div class="board-col">
      <h3>${s} <span class="count">${list.length}</span></h3>
      ${list.map(o => orderCard(o, agents)).join('') || '<p class="muted">-</p>'}
    </div>`;
  }).join('');
  const needsAction = orders.filter(o => o.status === 'booked' || (o.status === 'delivered' && o.payment_status !== 'paid'));
  return adminLayout('Job board', `
<section class="section wide">
  <p class="eyebrow">Operations</p><h1>Job board</h1>
  <div class="admin-summary"><span>${orders.length} orders</span><span>${needsAction.length} need attention</span><a href="/calendar.ics">Calendar feed</a></div>
  ${needsAction.length ? `<div class="attention"><span class="eyebrow">Needs attention</span>${needsAction.slice(0,4).map(o=>`<a href="/admin/orders/${o.id}"><strong>${esc(o.property.address)}</strong><small>${o.status === 'booked' ? 'New booking' : 'Delivered, payment open'}</small></a>`).join('')}</div>` : ''}
  <div class="board">${cols}</div>
</section>`);
}

function shoots(orders, agents) {
  const upcoming = orders
    .filter(o => ['booked', 'scheduled'].includes(o.status))
    .sort((a, b) => String(a.preferred_date || '9999').localeCompare(String(b.preferred_date || '9999')));
  const rows = upcoming.map(o => `<a class="prop-row" href="/admin/orders/${o.id}">
    <span class="prop-main"><strong>${esc(o.preferred_date || 'unscheduled')} ${esc(o.preferred_time || '')}</strong>
    <span class="muted">${esc(o.property.address)}, ${esc(o.property.city || '')} - ${esc(o.customer.name)}${o.agent_id ? ' (' + esc(agentName(agents, o.agent_id)) + ')' : ''} - ${esc(o.package_id)}</span></span>
    <span class="prop-side"><span class="badge s-${o.status}">${esc(o.status)}</span></span>
  </a>`).join('');
  return adminLayout('Shoots', `
<section class="section narrow">
  <p class="eyebrow">Shoot day</p><h1>Upcoming shoots</h1>
  <p class="muted">Booked and scheduled jobs, oldest first. Tap an address row to open the full job with contact details and notes.</p>
  <div class="prop-list">${rows || '<p class="muted">Nothing on the books.</p>'}</div>
</section>`);
}

function clients(agents, orders, flash) {
  const rows = agents.map(a => {
    const count = orders.filter(o => o.agent_id === a.id).length;
    return `<div class="prop-row">
      <span class="prop-main"><strong>${esc(a.name || a.email)}</strong>
      <span class="muted">${esc(a.email)}${a.phone ? ' - ' + esc(a.phone) : ''} - ${count} ${count === 1 ? 'property' : 'properties'}</span></span>
      <span class="prop-side"><form method="post" action="/admin/clients/${a.id}/reset" onsubmit="return confirm('Reset this agent password?')"><button class="btn small ghost" type="submit">reset password</button></form></span>
    </div>`;
  }).join('');
  return adminLayout('Clients', `
<section class="section narrow">
  <p class="eyebrow">Agent accounts</p><h1>Clients</h1>
  ${flash || ''}
  <p class="muted">Each agent gets a portal login. They see only their own properties, galleries, downloads, and property websites. You send them the password yourself; nothing is emailed.</p>
  <h2 class="listing-head">Add an agent</h2>
  <form method="post" action="/admin/clients" class="form">
    <div class="row">
      <label>Name<input name="name" required></label>
      <label>Email<input type="email" name="email" required></label>
      <label>Phone<input name="phone"></label>
    </div>
    <button class="btn" type="submit">Create account</button>
  </form>
  <h2 class="listing-head">Current agents</h2>
  <div class="prop-list">${rows || '<p class="muted">No agent accounts yet.</p>'}</div>
</section>`);
}

function credentialsFlash(kind, name, email, password) {
  return `<div class="notice ok"><strong>${esc(kind)} for ${esc(name)} (${esc(email)}).</strong><br>
  Password: <code class="cred">${esc(password)}</code><br>
  Shown once here. Send it to them yourself; it is not emailed.</div>`;
}

function billing(orders) {
  const rows = orders.map(o => {
    const total = orderTotal(o);
    return `<a class="prop-row" href="/admin/orders/${o.id}">
      <span class="prop-main"><strong>${esc(o.id)} - ${esc(o.property.address)}</strong>
      <span class="muted">${esc(o.customer.name)} - ${esc(o.package_id)}</span></span>
      <span class="prop-side">${money(total)} ${o.payment_status === 'paid' ? '<span class="badge paid">paid</span>' : o.delivery_release ? '<span class="badge released">released</span>' : '<span class="badge unpaid">unpaid</span>'}</span>
    </a>`;
  }).join('');
  const outstanding = orders.filter(o => o.payment_status !== 'paid').reduce((s, o) => s + orderTotal(o), 0);
  const collected = orders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + orderTotal(o), 0);
  return adminLayout('Billing', `
<section class="section narrow">
  <p class="eyebrow">Money</p><h1>Billing</h1>
  <p class="muted">Totals use the price saved with each booking. Online payment stays off; mark invoices paid when money arrives.</p>
  <div class="bill-summary">
    <div><span class="muted">Outstanding</span><strong>${money(outstanding)}</strong></div>
    <div><span class="muted">Collected</span><strong>${money(collected)}</strong></div>
  </div>
  <div class="prop-list">${rows || '<p class="muted">No orders yet.</p>'}</div>
</section>`);
}

function listingBits(order) {
  const L = order.listing || {};
  const bits = [];
  if (L.price && /^\d+$/.test(L.price)) bits.push('$' + Number(L.price).toLocaleString('en-US'));
  if (L.beds) bits.push(L.beds + ' bd');
  if (L.baths) bits.push(L.baths + ' ba');
  if (L.sqft) bits.push(L.sqft + ' sqft');
  if (L.lot_size) bits.push(L.lot_size);
  if (L.year_built) bits.push('built ' + L.year_built);
  if (L.property_type) bits.push(L.property_type);
  if (L.description) bits.push('description: "' + (L.description.length > 60 ? L.description.slice(0, 60) + '...' : L.description) + '"');
  return bits;
}

function orderDetail(order, files, agents, flash) {
  const pkg = order.package_snapshot || config.packages.find(p => p.id === order.package_id);
  const addons = (order.addon_snapshots && order.addon_snapshots.length ? order.addon_snapshots : config.addons.filter(a => order.addon_ids.includes(a.id)));
  const total = orderTotal(order);
  const statusButtons = STATUSES.map(s =>
    `<button name="status" value="${s}" class="btn small ${s === order.status ? 'current' : 'ghost'}" type="submit">${s}</button>`).join('');
  const agentOptions = ['<option value="">(no agent)</option>']
    .concat(agents.map(a => `<option value="${esc(a.id)}" ${order.agent_id === a.id ? 'selected' : ''}>${esc(a.name || a.email)}</option>`)).join('');
  const fileRows = files.map(f => `<div class="file-row">
    <span>${esc(f)}</span>
    <span><a class="btn small ghost" href="/files/${order.delivery_token}/${encodeURIComponent(f)}" target="_blank">view</a>
    <form method="post" action="/admin/orders/${order.id}/files/delete" style="display:inline"><input type="hidden" name="filename" value="${esc(f)}"><button class="btn small ghost" type="submit">remove</button></form></span>
  </div>`).join('');
  return adminLayout('Order ' + order.id, `
<section class="section narrow">
  <p><a class="backlink" href="/admin">&larr; Job board</a></p>
  <h1>${esc(order.id)} <span class="badge s-${order.status}">${esc(order.status)}</span></h1>
  ${flash || ''}
  <div class="detail-grid">
    <div class="detail-block"><h3>Customer</h3><p>${esc(order.customer.name)}<br><a href="mailto:${esc(order.customer.email)}">${esc(order.customer.email)}</a><br>${esc(order.customer.phone || '')}</p><h3>Property</h3><p>${esc(order.property.address)}, ${esc(order.property.city || '')} ${esc(order.property.zip || '')} ${order.property.sqft ? '- ' + esc(order.property.sqft) + ' sqft' : ''}</p><p class="muted">${esc(order.property.notes || 'No notes.')}</p></div>
    <div class="detail-block"><h3>Package</h3><p>${pkg ? esc(pkg.name) : esc(order.package_id)}${addons.length ? '<br>Add-ons: ' + addons.map(a => esc(a.name)).join(', ') : ''}</p><p><strong>Booked total:</strong> ${money(total)}</p><h3>Preferred time</h3><p>${esc(order.preferred_date || 'flexible')} ${esc(order.preferred_time || '')}</p></div>
  </div>
  <form method="post" action="/admin/orders/${order.id}/status" class="status-bar">${statusButtons}</form>
  <form method="post" action="/admin/orders/${order.id}/payment" class="status-bar">
    ${order.payment_status === 'paid'
      ? '<span class="badge paid">payment received</span> <button class="btn small ghost" name="payment_status" value="unpaid">mark unpaid</button>'
      : '<span class="badge unpaid">unpaid</span> <button class="btn small" name="payment_status" value="paid">mark paid (manual)</button>'}
    ${order.stripe_session_id ? `<span class="muted">stripe session: ${esc(order.stripe_session_id.slice(0, 20))}...</span>` : ''}
  </form>
  <div class="card">
    <h3>Agent and property website</h3>
    <form method="post" action="/admin/orders/${order.id}/assign" class="status-bar">
      <label class="muted" for="agent_id">Agent account</label>
      <select name="agent_id" id="agent_id">${agentOptions}</select>
      <button class="btn small" type="submit">assign</button>
    </form>
    <form method="post" action="/admin/orders/${order.id}/credit" class="status-bar">
      <label class="muted" for="credit">Photography credit (always shown on the property site)</label>
      <input name="credit" id="credit" value="${esc(order.credit || 'JWRE Media')}">
      <button class="btn small" type="submit">save</button>
    </form>
    <p class="muted">Property site: <a href="/site/${order.site_token}" target="_blank">/site/${order.site_token.slice(0, 10)}...</a> - the agent picks which photos appear from their portal.</p>
    <p class="muted">Agent-entered listing details: ${esc(listingBits(order).join(' - ') || 'none yet')}.</p>
  </div>
  <div class="card">
    <h3>Delivery access</h3>
    ${order.payment_status === 'paid'
      ? '<p><span class="badge paid">unlocked - paid</span></p><p class="muted">Payment received, so the agent has originals, the zip, and the property website.</p>'
      : order.delivery_release
        ? `<p><span class="badge released">unlocked - released without payment</span></p>
           <p>Reason: <strong>${esc(order.delivery_release.reason)}</strong><br>
           <span class="muted">Released by ${esc(order.delivery_release.by)} on ${esc(new Date(order.delivery_release.at).toLocaleString('en-US', { timeZone: 'America/Chicago' }))}. The agent has full access even though no payment is recorded.</span></p>
           <form method="post" action="/admin/orders/${order.id}/release/revoke" onsubmit="return confirm('Revoke this release? The gallery, downloads, and property site lock again immediately.')"><button class="btn small ghost" type="submit">revoke release</button></form>`
        : `<p><span class="badge unpaid">locked - awaiting payment</span></p>
           <p class="muted">The agent sees watermarked previews only. Originals, the zip, and the property website stay locked until payment is marked or you release the delivery.</p>
           <form method="post" action="/admin/orders/${order.id}/release" class="status-bar">
             <label class="muted" for="release-reason">Release without payment (trusted client, comp shoot, pay later)</label>
             <input name="reason" id="release-reason" required minlength="3" maxlength="300" placeholder="Why are you releasing this one?">
             <button class="btn small" type="submit">release without payment</button>
           </form>`}
  </div>
  <div class="card">
    <h3>Delivery gallery</h3>
    <p class="muted">Customer link: <a href="/gallery/${order.delivery_token}">/gallery/${order.delivery_token.slice(0, 12)}...</a></p>
    <form method="post" action="/admin/orders/${order.id}/upload" enctype="multipart/form-data" class="status-bar">
      <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple required>
      <button class="btn small" type="submit">upload photos</button>
    </form>
    ${fileRows || '<p class="muted">No delivered files yet. Upload edited photos here and they appear in the customer gallery and the agent portal.</p>'}
  </div>
  <div class="card">
    <h3>Timeline</h3>
    <ul class="timeline">${order.timeline.map(t => `<li><time>${esc(new Date(t.at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }))}</time><span>${esc(t.event)}</span></li>`).join('')}</ul>
  </div>
  <div class="card danger">
    <h3>Delete this order</h3>
    <p class="muted">Permanently removes the order and its timeline. Only possible while no delivered files are attached, so finished work cannot be lost by accident.</p>
    <form method="post" action="/admin/orders/${order.id}/delete" onsubmit="return confirm('Delete ${esc(order.id)} permanently? This cannot be undone.')"><button class="btn small ghost" type="submit">delete order</button></form>
  </div>
</section>`);
}

function catalog(items, flash, user) {
  const row = x => `<div class="catalog-row ${x.active?'':'catalog-off'}"><div class="catalog-main"><strong>${esc(x.name)}</strong><span class="muted">${esc(x.id)}${x.tagline?' - '+esc(x.tagline):''}</span></div><span class="price small">${money(x.priceCents)}</span><a class="btn small ghost" href="/admin/catalog/${encodeURIComponent(x.id)}">edit</a></div>`;
  const packages=items.filter(x=>x.kind==='package').map(row).join('');
  const addons=items.filter(x=>x.kind==='addon').map(row).join('');
  return adminLayout('Services', `<section class="section narrow"><p class="eyebrow">Order catalog</p><h1>Packages and add-ons</h1>${flash||''}<p class="muted">Changes here update the booking screen and public services page automatically. Existing orders keep the names and prices that were booked.</p><p><a class="btn" href="/admin/catalog/new?kind=package">New package</a> <a class="btn ghost" href="/admin/catalog/new?kind=addon">New a la carte item</a></p><h2 class="listing-head">Packages</h2><div class="catalog-list">${packages||'<p class="muted">No packages yet.</p>'}</div><h2 class="listing-head">A la carte</h2><div class="catalog-list">${addons||'<p class="muted">No add-ons yet.</p>'}</div></section>`,user);
}
function catalogEditor(item, error, user) {
  const x=item||{}, isNew=!x.id, kind=x.kind==='addon'?'addon':'package';
  return adminLayout(isNew?'New service':'Edit service',`<section class="section narrow"><p><a class="backlink" href="/admin/catalog">&larr; Services</a></p><p class="eyebrow">${isNew?'Create':'Edit'} ${kind==='package'?'package':'a la carte item'}</p><h1>${isNew?'New service':esc(x.name)}</h1>${error?`<div class="notice bad">${esc(error)}</div>`:''}<form method="post" action="${isNew?'/admin/catalog':'/admin/catalog/'+encodeURIComponent(x.id)}" class="form"><input type="hidden" name="original_id" value="${esc(x.id||'')}"><label>Type<select name="kind"><option value="package" ${kind==='package'?'selected':''}>Package</option><option value="addon" ${kind==='addon'?'selected':''}>A la carte item</option></select></label><label>Short ID<input name="id" value="${esc(x.id||'')}" pattern="[a-z0-9-]+" ${isNew?'':'readonly'} required><span class="muted">Lowercase letters, numbers and hyphens.</span></label><label>Name<input name="name" value="${esc(x.name||'')}" required maxlength="120"></label><label>Short description<input name="tagline" value="${esc(x.tagline||'')}" maxlength="220"></label><label>Price in dollars<input name="price" value="${esc(((x.priceCents||0)/100).toFixed(2))}" inputmode="decimal" required></label><label>What is included (one line each)<textarea name="includes" rows="6">${esc((x.includes||[]).join('\n'))}</textarea></label><div class="row"><label>Display order<input type="number" name="sort_order" value="${esc(x.sort_order||10)}"></label><label><input type="checkbox" name="featured" value="1" ${x.featured?'checked':''}> Feature this package</label><label><input type="checkbox" name="active" value="1" ${x.active!==false?'checked':''}> Available to book</label></div><button class="btn" type="submit">Save service</button></form></section>`,user);
}

module.exports = { adminLayout, login, recovery, changePassword, team, dashboard, shoots, clients, billing, orderDetail, credentialsFlash, orderTotal, catalog, catalogEditor };
