'use strict';
// Email boundary: LOG-ONLY BY STANDING USER DECISION.
// Jeremy has asked that email never be sent on his behalf. Outbound delivery
// is disabled in code: every message is appended to data/outbox.log as a
// draft record and nothing leaves the app, regardless of environment keys.
// Do not re-enable a delivery path without his explicit say-so.
const fs = require('fs');
const path = require('path');
const config = require('./config');

async function send(to, subject, text) {
  if (!to) return { skipped: true };
  const line = `[${new Date().toISOString()}] TO:${to} SUBJECT:${subject}\n${text}\n---\n`;
  fs.appendFileSync(path.join(config.dataDir, 'outbox.log'), line);
  return { logged: true };
}

module.exports = { send };
