'use strict';
// Calendar boundary: serves an iCal feed of scheduled shoots at /calendar.ics.
// Jeremy can subscribe to it from Google Calendar (Add by URL) today;
// direct Google Calendar API sync is the documented next step.
const config = require('./config');

function esc(s) { return String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }
function stamp(iso) { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

function buildFeed(orders) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JWRE Media//Shoots//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:JWRE Media Shoots'];
  for (const o of orders) {
    if (!o.preferred_date || ['booked', 'paid'].includes(o.status) && o.status !== 'scheduled') continue;
    if (o.status !== 'scheduled' && o.status !== 'shot' && o.status !== 'editing') continue;
    const start = new Date(o.preferred_date + 'T' + (o.preferred_time || '10:00') + ':00');
    if (isNaN(start)) continue;
    const end = new Date(start.getTime() + 2 * 3600 * 1000); // default 2h shoot block
    lines.push('BEGIN:VEVENT',
      'UID:' + o.id + '@jwremedia',
      'DTSTAMP:' + stamp(o.created_at),
      'DTSTART:' + stamp(start),
      'DTEND:' + stamp(end),
      'SUMMARY:' + esc(`Shoot: ${o.property.address} (${o.customer.name})`),
      'DESCRIPTION:' + esc(`Order ${o.id} - ${o.package_id}. Contact: ${o.customer.email} ${o.customer.phone || ''}`),
      'LOCATION:' + esc(`${o.property.address}, ${o.property.city || ''} ${o.property.zip || ''}`),
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { buildFeed };
