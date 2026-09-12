'use strict';
// Password hashing (scrypt) and signed session tokens for the agent portal.
const crypto = require('crypto');
const config = require('./config');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const test = crypto.scryptSync(String(password), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return test.length === ref.length && crypto.timingSafeEqual(test, ref);
}

function generatePassword(length = 16) {
  // Human-copyable random password, no ambiguous characters.
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function recoveryToken() { return crypto.randomBytes(32).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function makeStudioSession(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, v: user.session_version, exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
  return payload + '.' + sign(payload);
}

function verifyStudioSession(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !safeEqual(sign(payload), sig)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.id || !Number.isInteger(data.v) || !(data.exp > Date.now())) return null;
    return data;
  } catch { return null; }
}

function makeAgentSession(agent) {
  const exp = Date.now() + 12 * 3600 * 1000;
  const id = typeof agent === 'object' ? agent.id : agent;
  const v = typeof agent === 'object' ? (agent.session_version || 1) : 1;
  const payload = Buffer.from(JSON.stringify({ id, v, exp })).toString('base64');
  return payload + '.' + sign(payload);
}

function verifyAgentSession(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || sign(payload) !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64').toString());
    if (!data.id || !(data.exp > Date.now())) return null;
    return data;
  } catch { return null; }
}

module.exports = { hashPassword, verifyPassword, generatePassword, recoveryToken, hashToken, makeStudioSession, verifyStudioSession, makeAgentSession, verifyAgentSession };
