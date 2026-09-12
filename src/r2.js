'use strict';
// Minimal Cloudflare R2 client - S3-compatible API over plain HTTPS with
// AWS Signature Version 4 signing. No AWS SDK dependency, matching the
// repo's minimal-dependency style. R2 uses region "auto" and service "s3".
//
// Object key model (see docs/persistence.md):
//   orders/<ORDER-ID>/originals/<filename>   full-resolution edited photos
//   orders/<ORDER-ID>/previews/<base>.jpg    watermarked 1400px derivatives
//   orders/<ORDER-ID>/video/<filename>       delivered video files
//   orders/<ORDER-ID>/zips/<filename>        generated download bundles
//   orders/<ORDER-ID>/proofs/<filename>      proofs / contact sheets
//   backups/<YYYY>/<MM>/<DD>/jwre-backup-<timestamp>.json
const crypto = require('crypto');
const https = require('https');
const config = require('./config');

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}
function uriEncode(str, encodeSlash) {
  return [...String(str)].map(ch => {
    if (/[A-Za-z0-9\-._~]/.test(ch)) return ch;
    if (ch === '/' && !encodeSlash) return '/';
    return [...Buffer.from(ch, 'utf8')].map(b => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
  }).join('');
}

// Signing key chain: Date -> Region -> Service -> Terminator.
function deriveSigningKey(secret, date, region, service) {
  const kDate = hmac('AWS4' + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

class R2Client {
  constructor({ accountId, accessKeyId, secretAccessKey, bucket, endpoint }) {
    if (!accessKeyId || !secretAccessKey) throw new Error('R2 credentials are not configured');
    this.host = endpoint || `${accountId}.r2.cloudflarestorage.com`;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.bucket = bucket;
    this.region = 'auto';
    this.service = 's3';
  }

  // Sign and send one request. Returns { status, headers, body }.
  request(method, key, { body = Buffer.alloc(0), contentType, query = '' } = {}) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256hex(body);
    const path = '/' + uriEncode(this.bucket, false) + (key ? '/' + uriEncode(key, false) : '');

    const headers = {
      host: this.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) headers['content-type'] = contentType;

    const sortedNames = Object.keys(headers).sort();
    const canonicalHeaders = sortedNames.map(n => n + ':' + headers[n] + '\n').join('');
    const signedHeaders = sortedNames.join(';');
    const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
    const signature = crypto.createHmac('sha256', deriveSigningKey(this.secretAccessKey, dateStamp, this.region, this.service))
      .update(stringToSign).digest('hex');
    headers.Authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return new Promise((resolve, reject) => {
      const req = https.request({ hostname: this.host, path: path + (query ? '?' + query : ''), method, headers }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async putObject(key, body, contentType) {
    const r = await this.request('PUT', key, { body, contentType });
    if (r.status >= 300) throw new Error(`R2 PUT ${key} failed (${r.status}): ${r.body.toString().slice(0, 300)}`);
    return r;
  }

  async getObject(key) {
    const r = await this.request('GET', key);
    if (r.status === 404) return null;
    if (r.status >= 300) throw new Error(`R2 GET ${key} failed (${r.status}): ${r.body.toString().slice(0, 300)}`);
    return r.body;
  }

  async headObject(key) {
    const r = await this.request('HEAD', key);
    if (r.status === 404) return null;
    if (r.status >= 300) throw new Error(`R2 HEAD ${key} failed (${r.status})`);
    return r.headers;
  }

  async deleteObject(key) {
    const r = await this.request('DELETE', key);
    if (r.status >= 300 && r.status !== 404) throw new Error(`R2 DELETE ${key} failed (${r.status})`);
  }

  async listObjects(prefix) {
    const q = 'list-type=2&max-keys=1000&prefix=' + uriEncode(prefix, true);
    const r = await this.request('GET', '', { query: q });
    if (r.status >= 300) throw new Error(`R2 LIST ${prefix} failed (${r.status}): ${r.body.toString().slice(0, 300)}`);
    const keys = [...r.body.toString().matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    return keys;
  }

  // Short-lived download URL for gated delivery: the server checks the
  // payment gate, then 302s the agent to this URL. Default 5 minutes.
  presignGet(key, expiresSeconds = 300) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
    const path = '/' + uriEncode(this.bucket, false) + '/' + uriEncode(key, false);
    const params = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresSeconds),
      'X-Amz-SignedHeaders': 'host',
    });
    // URLSearchParams encodes per form rules; SigV4 wants strict URI encoding.
    const canonicalQuery = [...params.entries()]
      .map(([k, v]) => uriEncode(k, true) + '=' + uriEncode(v, true)).sort().join('&');
    const canonicalRequest = ['GET', path, canonicalQuery, 'host:' + this.host + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
    const signature = crypto.createHmac('sha256', deriveSigningKey(this.secretAccessKey, dateStamp, this.region, this.service))
      .update(stringToSign).digest('hex');
    return `https://${this.host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }
}

// ---------- object key model ----------
const { sanitizeFilename } = require('./upload');

const keys = {
  original: (orderId, filename) => `orders/${orderId}/originals/${sanitizeFilename(filename)}`,
  preview: (orderId, filename) =>
    `orders/${orderId}/previews/${sanitizeFilename(filename).replace(/\.[a-z0-9]+$/i, '')}.jpg`,
  video: (orderId, filename) => `orders/${orderId}/video/${sanitizeFilename(filename)}`,
  zip: (orderId, filename) => `orders/${orderId}/zips/${sanitizeFilename(filename)}`,
  proof: (orderId, filename) => `orders/${orderId}/proofs/${sanitizeFilename(filename)}`,
  backup: (date = new Date()) => {
    const p = date.toISOString();
    return `backups/${p.slice(0, 4)}/${p.slice(5, 7)}/${p.slice(8, 10)}/jwre-backup-${p.replace(/[:.]/g, '-')}.json`;
  },
};

function fromConfig() {
  return new R2Client({
    accountId: config.r2.accountId,
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
    bucket: config.r2.bucket,
  });
}

module.exports = { R2Client, keys, fromConfig, deriveSigningKey, uriEncode };
