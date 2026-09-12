'use strict';
// Minimal multipart/form-data parser (no dependencies).
// Returns { fields: {name: value}, files: [{field, filename, contentType, data}] }.
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || '');
  if (!m) throw new Error('no boundary');
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const result = { fields: {}, files: [] };

  // Find each boundary position.
  const positions = [];
  let idx = buf.indexOf(boundary);
  while (idx !== -1) { positions.push(idx); idx = buf.indexOf(boundary, idx + boundary.length); }
  if (positions.length < 2) return result;

  const headerEnd = Buffer.from('\r\n\r\n');
  for (let i = 0; i < positions.length - 1; i++) {
    const partStart = positions[i] + boundary.length;
    // Skip CRLF after boundary; stop at closing "--".
    if (buf[partStart] === 45 && buf[partStart + 1] === 45) break; // "--"
    const start = partStart + 2; // skip \r\n
    const end = positions[i + 1] - 2; // strip trailing \r\n
    if (end <= start) continue;
    const he = buf.indexOf(headerEnd, start);
    if (he === -1 || he > end) continue;
    const headers = buf.slice(start, he).toString('latin1');
    const body = buf.slice(he + 4, end);
    const nameM = /name="([^"]*)"/.exec(headers);
    const fileM = /filename="([^"]*)"/.exec(headers);
    const ctM = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
    if (!nameM) continue;
    if (fileM && fileM[1]) {
      result.files.push({
        field: nameM[1],
        filename: fileM[1],
        contentType: ctM ? ctM[1].trim().toLowerCase() : 'application/octet-stream',
        data: body,
      });
    } else {
      result.fields[nameM[1]] = body.toString('utf8');
    }
  }
  return result;
}

function sanitizeFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop() || 'file';
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '').slice(0, 120);
  return clean || 'file';
}

module.exports = { parseMultipart, sanitizeFilename };
