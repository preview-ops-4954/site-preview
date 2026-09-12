# JWRE Media - Website + Operations MVP

A working, portable first version of the JWRE Media site: marketing pages, customer
booking, admin job board, payment plumbing (Stripe test mode), a calendar feed, and
customer delivery galleries. Zero runtime dependencies - plain Node.js 18+, server-
rendered HTML, JSON-file storage behind an adapter-shaped interface.

Built to run on free tiers only. Nothing is deployed; nothing is paid; no live payments.

## Payment-gated delivery

- An order's originals, ZIP download, and public property website unlock only when
  `payment_status` is `paid` (Stripe test webhook or admin "mark paid") or when the
  photographer records a delivery release from the admin order page.
- Releases require a written reason; grants and revokes are timestamped in the order
  timeline. Marking an order unpaid or revoking a release re-locks every surface,
  including direct file URLs and already-published property sites.
- While locked, agents see watermarked 1400px previews (`/previews/...`) generated
  on demand; originals are never served to non-admin sessions while locked.
- Run the regression suite with `npm test` (boots a throwaway server + data dir).

## Run it

```bash
cp .env.example .env    # optional; sensible dev defaults are baked in
npm start               # http://localhost:3000
```

- Public site: `/`, `/portfolio`, `/services`, `/book`
- Admin studio: `/admin` (default dev password `jwre-dev-password` - change in `.env`)
  - Job board, Shoots (upcoming shoot-day list), Clients (agent portal accounts),
    Billing (per-order totals, paid/unpaid), photo delivery uploads
- Agent portal: `/portal/login` - each agent sees only their own properties,
  galleries, downloads (single files or one zip), reusable branding, and the
  photo selection + ordering for each property website
- Property websites: `/site/<token>` - public per-property sites built from
  delivered photos the agent picked, in the agent's order, with the agent's
  branding. "Photography by ..." credit is mandatory and managed from the
  admin order page, not by agents.
- Demo agent account: seeded on first run (dana.rivera@example.com); set
  `DEMO_AGENT_PASSWORD` before first boot or read the generated one from logs.
- Calendar feed: `/calendar.ics` (subscribe from Google Calendar via "Add by URL")
- Demo data: three sample orders are seeded on first run (safe to delete in `data/db.json`)

## What's in the box

| Piece | Status | Notes |
|---|---|---|
| Marketing + portfolio | Done | Uses 9 real photos from Jeremy's two shoots |
| Order intake | Done | Packages, add-ons, schedule preference, honeypot + rate limit |
| Admin job board | Done | Booked - Scheduled - Shot - Editing - Delivered - Paid, per-order timeline |
| Payments | Plumbing done | Stripe Checkout + signed webhook; disabled until test keys are added to `.env` |
| Email | Boundary done | Log-only by standing decision: Jeremy does not want email sent on his behalf. Everything is appended to `data/outbox.log`; no delivery path exists in code |
| Calendar | Feed done | iCal feed now; direct Google Calendar API sync is the next step |
| Gallery delivery | Done | Upload edited photos from the admin order page; agents get galleries, zip download, and property websites | Files dropped into `data/deliveries/<ORDER-ID>/` appear in the customer's private gallery link |
| Payment-gated delivery | Done | Originals, zips, and property-site publishing stay locked until the order is paid. Unpaid agents see watermarked, reduced-resolution previews only (generated server-side with sharp into `data/deliveries/<ORDER-ID>/.previews/`). The photographer can release a delivery without payment from the admin order page - a reason is required and the grant/revoke is written to the order timeline. Revoking or marking an order unpaid re-locks everything, including already-published property sites. Public property sites and token galleries are view-only; original + zip downloads live only in the authenticated agent portal. |

## Free-tier hosting plan

- **App host:** Render free web service (https://render.com/docs/free). Free services
  spin down after 15 min idle and take ~1 min to wake - fine for MVP, upgrade later.
  Deploy: push this folder to GitHub, "New Web Service", build `npm install`, start `npm start`.
- **Database:** Supabase free tier (https://supabase.com/pricing). The Postgres adapter
  (`src/store-pg.js`) is a drop-in for the JSON store - set `STORAGE_BACKEND=pg` and
  `DATABASE_URL`, run `npm run migrate`, backfill with `node scripts/import-json.js`.
  Full cutover/rollback runbook: `docs/persistence.md`.
- **Photo/file delivery:** Cloudflare R2 free 10 GB, zero egress fees
  (https://developers.cloudflare.com/r2/pricing/). Object key model, SigV4 client
  (`src/r2.js`), and disk->R2 backfill (`scripts/migrate-media-to-r2.js`) are ready;
  serving switches with `MEDIA_BACKEND=r2` once the bucket exists.
- **Preview derivatives:** generated with sharp (npm dependency). Keep the `sharp`
  install step in the Render build; without it previews 404 but the gate stays closed.
- **Email:** Disabled by standing decision - Jeremy does not want email sent on his behalf. All order/confirmation mail is logged to `data/outbox.log` as drafts. Do not wire a provider (e.g. Resend) without his explicit say-so.
- **Payments:** Stripe test mode is free (https://stripe.com/docs/testing); live mode
  costs 2.9% + $0.30 per US online card charge (https://stripe.com/pricing).
- **Anti-spam:** Cloudflare Turnstile free (https://developers.cloudflare.com/turnstile/plans/)
  - honeypot + rate limit are already in; add Turnstile at launch.

NOTE: Vercel's free Hobby plan prohibits commercial use (https://vercel.com/pricing), so it
is not the free host for this business.

## Before launch - Jeremy's decisions

1. Real package prices and add-on prices (all prices in `src/config.js` are placeholders,
   labeled as such on every page).
2. Payment timing: pay at booking, deposit, or pay on delivery.
3. Turnaround commitment (e.g. next-business-day) and rush fee.
4. Service area + travel fees beyond Austin metro.
5. Cancellation/weather policy (especially drone).
6. Domain name purchase.
7. Stripe account + test keys, then live keys when ready.
8. Texas sales tax: photography is generally taxable in Texas - confirm with an accountant
   before charging (https://comptroller.texas.gov/taxes/sales/).

## Security notes

- Admin session is an HMAC-signed cookie (12h). Change `ADMIN_PASSWORD` + `SESSION_SECRET`.
- Stripe webhooks are signature-verified; unsigned/invalid calls are rejected.
- Gallery links are unguessable tokens (144-bit random). No directory listing.
- Do not expose `data/` - it holds orders and customer PII.

## Minimal visual direction

The current design uses an editorial, photography-first system: warm white space, restrained
sage and charcoal, serif display type, minimal borders, and an intentionally quiet admin board.
The public site, booking form, and admin workflow remain fully functional. Visual checks are in
`docs/screenshots-minimal/`.
