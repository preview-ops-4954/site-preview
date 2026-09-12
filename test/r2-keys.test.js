'use strict';
// Unit tests for the R2 key model and SigV4 key derivation - no network,
// no R2 account needed. The derivation vector is the AWS documentation
// example, independently reproduced with openssl.
const { test } = require('node:test');
const assert = require('node:assert');
const { keys, deriveSigningKey, uriEncode } = require('../src/r2');

test('object key model stays order-scoped and sanitized', () => {
  assert.strictEqual(keys.original('JWRE-1001', 'Front Hero (1).JPG'),
    'orders/JWRE-1001/originals/Front-Hero-1-.JPG');
  assert.strictEqual(keys.preview('JWRE-1001', 'front-hero.png'),
    'orders/JWRE-1001/previews/front-hero.jpg');
  assert.strictEqual(keys.video('JWRE-1001', 'walkthrough final.mp4'),
    'orders/JWRE-1001/video/walkthrough-final.mp4');
  assert.strictEqual(keys.zip('JWRE-1001', 'mls-size.zip'), 'orders/JWRE-1001/zips/mls-size.zip');
  assert.strictEqual(keys.proof('JWRE-1001', 'contact-sheet.pdf'),
    'orders/JWRE-1001/proofs/contact-sheet.pdf');
});

test('backup keys partition by date', () => {
  assert.strictEqual(keys.backup(new Date('2026-09-12T02:30:00.000Z')),
    'backups/2026/09/12/jwre-backup-2026-09-12T02-30-00-000Z.json');
});

test('no traversal or separators leak into keys', () => {
  const k = keys.original('JWRE-1001', '../../etc/passwd');
  assert.ok(k.startsWith('orders/JWRE-1001/originals/'));
  assert.ok(!k.includes('..'));
});

test('SigV4 signing key matches the AWS documentation vector', () => {
  // From AWS "Examples of how to derive a signing key" (service iam,
  // date 20120215, region us-east-1), reproduced with openssl:
  //   kDate/kRegion/kService/kSigning HMAC chain over "AWS4"+secret.
  const k = deriveSigningKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam');
  assert.strictEqual(Buffer.from(k).toString('hex'),
    'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
});

test('uriEncode follows SigV4 rules (tilde unescaped, slash optional)', () => {
  assert.strictEqual(uriEncode('a b/c~d', false), 'a%20b/c~d');
  assert.strictEqual(uriEncode('a b/c~d', true), 'a%20b%2Fc~d');
});
