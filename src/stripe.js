'use strict';
// Stripe via plain HTTPS (form-encoded) - no SDK dependency.
// Runs in TEST MODE until live keys are configured. With no keys configured,
// checkout is skipped and orders are recorded as "payment pending".
const https = require('https');
const crypto = require('crypto');
const config = require('./config');

function postForm(path, params) {
  const body = new URLSearchParams(params).toString();
  const opts = {
    hostname: 'api.stripe.com', path, method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + config.stripe.secretKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error('Stripe: ' + (json.error && json.error.message || data)));
          else resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function paymentsEnabled() { return Boolean(config.stripe.secretKey); }

async function createCheckoutSession(order, pkg, addons) {
  const lineItems = [{
    'line_items[0][price_data][currency]': config.stripe.currency,
    'line_items[0][price_data][unit_amount]': String(pkg.priceCents),
    'line_items[0][price_data][product_data][name]': 'JWRE Media - ' + pkg.name,
    'line_items[0][quantity]': '1',
  }];
  addons.forEach((a, i) => {
    lineItems.push({
      [`line_items[${i + 1}][price_data][currency]`]: config.stripe.currency,
      [`line_items[${i + 1}][price_data][unit_amount]`]: String(a.priceCents),
      [`line_items[${i + 1}][price_data][product_data][name]`]: 'Add-on: ' + a.name,
      [`line_items[${i + 1}][quantity]`]: '1',
    });
  });
  const params = Object.assign({
    mode: 'payment',
    success_url: config.baseUrl + '/order/' + order.id + '/confirm?paid=1',
    cancel_url: config.baseUrl + '/order/' + order.id + '/confirm?canceled=1',
    'metadata[order_id]': order.id,
    'payment_intent_data[metadata][order_id]': order.id,
    customer_email: order.customer.email,
  }, ...lineItems);
  return postForm('/v1/checkout/sessions', params);
}

// Verify a Stripe webhook signature (Stripe-Signature: t=...,v1=...)
// https://docs.stripe.com/webhooks/signature
function verifyWebhook(rawBody, signatureHeader) {
  if (!config.stripe.webhookSecret) throw new Error('webhook secret not configured');
  const parts = Object.fromEntries((signatureHeader || '').split(',').map(kv => kv.split('=')));
  const signed = parts.t + '.' + rawBody;
  const expected = crypto.createHmac('sha256', config.stripe.webhookSecret).update(signed).digest('hex');
  const ok = parts.v1 && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!ok || age > 300) throw new Error('invalid webhook signature');
  return JSON.parse(rawBody);
}

module.exports = { paymentsEnabled, createCheckoutSession, verifyWebhook };
