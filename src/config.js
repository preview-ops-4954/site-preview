'use strict';
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dependency)
(function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const port = parseInt(process.env.PORT || '3000', 10);

// PRICING IS PLACEHOLDER. Jeremy has not set packages or prices yet.
// Every price rendered on the site is labelled as placeholder until he confirms.
const packages = [
  {
    id: 'essential',
    name: 'Essential Photography',
    tagline: 'Interior + exterior stills, MLS-ready',
    includes: ['Up to 25 edited photos', 'Interior and exterior coverage', 'Blue-sky sky replacement', 'Next-business-day delivery'],
    priceCents: 17500, // PLACEHOLDER
  },
  {
    id: 'premium',
    name: 'Premium Photo + Drone',
    tagline: 'Stills plus aerial coverage',
    includes: ['Up to 40 edited photos', 'FAA-compliant drone aerials', 'Interior, exterior, and neighborhood context', 'Next-business-day delivery'],
    priceCents: 27500, // PLACEHOLDER
    featured: true,
  },
  {
    id: 'full-media',
    name: 'Full Media Package',
    tagline: 'Photos, drone, video, 3D tour, and floor plan',
    includes: ['Everything in Premium', 'Video walkthrough (60-90s)', 'Social-media vertical cut', '3D tour (Matterport or Zillow 3D)', '2D floor plan'],
    priceCents: 45000, // PLACEHOLDER
  },
];

const addons = [
  { id: 'twilight', name: 'Twilight shoot', priceCents: 12500 },        // PLACEHOLDER
  { id: 'drone-extra', name: 'Additional drone coverage', priceCents: 7500 }, // PLACEHOLDER
  { id: 'floorplan', name: '2D floor plan', priceCents: 5000 },         // PLACEHOLDER
  { id: 'video', name: 'Video walkthrough', priceCents: 15000 },        // PLACEHOLDER
  { id: 'social-cut', name: 'Social-media vertical cut', priceCents: 7500 }, // PLACEHOLDER
  { id: 'tour-3d', name: '3D tour (Matterport or Zillow 3D)', priceCents: 15000 }, // PLACEHOLDER
  { id: 'rush', name: 'Same-day rush delivery', priceCents: 10000 },    // PLACEHOLDER
];

module.exports = {
  port,
  baseUrl: (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  adminPassword: process.env.ADMIN_PASSWORD || 'jwre-dev-password', // bootstrap only; never used after owner creation
  studioOwnerEmail: String(process.env.STUDIO_OWNER_EMAIL || 'wyrick.jt@gmail.com').trim().toLowerCase(),
  studioOwnerName: process.env.STUDIO_OWNER_NAME || 'Jeremy Wyrick',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  dataDir: path.resolve(__dirname, '..', process.env.DATA_DIR || './data'),
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    currency: 'usd',
  },
  // Persistence (see docs/persistence.md)
  // 'json' = local data/db.json (default, ephemeral on Render free)
  // 'pg'   = Supabase Postgres, requires DATABASE_URL
  storageBackend: process.env.STORAGE_BACKEND || 'json',
  databaseUrl: process.env.DATABASE_URL || '',
  // Cloudflare R2 object storage for delivered media. The media layer is
  // still disk-backed until MEDIA_BACKEND=r2 is switched on (phase 2).
  mediaBackend: process.env.MEDIA_BACKEND || 'disk',
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || 'jwre-media',
  },
  resendApiKey: process.env.RESEND_API_KEY || '',
  notifyEmail: process.env.NOTIFY_EMAIL || '',
  fromEmail: process.env.FROM_EMAIL || 'orders@jwremedia.example',
  business: {
    name: 'JWRE Media',
    tagline: 'Real estate photography for the Austin metro',
    area: 'Austin Metro, Texas',
  },
  packages,
  addons,
  pricingPlaceholder: true, // flip to false once Jeremy confirms real pricing
};
