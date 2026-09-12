# JWRE persistence foundation: Supabase Postgres + Cloudflare R2

How the app's data survives Render redeploys. Two backends, both free tier,
both portable (plain PostgreSQL, plain S3 API - no proprietary lock-in).

## Layout

| What | Where | Notes |
|---|---|---|
| Clients (agent portal accounts) | `agents` table | id, login, branding |
| Orders | `orders` table | status, payment_status, tokens, customer/property JSONB, package, schedule |
| Listings | `orders.listing` JSONB | agent-entered public listing facts per property |
| Payment state | `orders.payment_status` + `payment_events` | audit rows are written automatically on every flip |
| History | `order_events` | the order timeline; append-only, rebuilt on read |
| Media registry | `delivery_files` | one row per stored object, key points into R2 |
| Media bytes | Cloudflare R2 bucket | originals, previews, video, zips, proofs |
| Backups | JSON export, also copied to R2 | `scripts/backup.js` |

## R2 object key model

```
orders/<ORDER-ID>/originals/<filename>   full-resolution edited photos
orders/<ORDER-ID>/previews/<base>.jpg    watermarked 1400px derivatives (unpaid gate)
orders/<ORDER-ID>/video/<filename>       delivered video files
orders/<ORDER-ID>/zips/<filename>        generated download bundles
orders/<ORDER-ID>/proofs/<filename>      proofs / contact sheets
backups/<YYYY>/<MM>/<DD>/jwre-backup-<timestamp>.json
```

Keys carry only the order id and a sanitized filename - no client names,
no addresses. Delivery stays payment-gated: the server checks the gate and
then redirects to a short-lived presigned URL; bucket contents are never
public-listed.

## Secrets

All values live in Render environment variables - never in git, never in chat.

| Var | Source |
|---|---|
| `DATABASE_URL` | Supabase -> Project Settings -> Database -> Connection string (session pooler, port 5432). Contains the DB password set at project creation. |
| `STORAGE_BACKEND` | `json` (default) or `pg` |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare -> R2 -> Manage API tokens. The secret is shown once; store it in the vault immediately. |
| `R2_BUCKET` | `jwre-media` |
| `MEDIA_BACKEND` | `disk` (default) or `r2` |

## Cutover: JSON -> Postgres (phase 1)

1. Create the Supabase project (free tier, region closest to Render's Oregon: US West).
2. Set `DATABASE_URL` on the Render service (or in local `.env` for rehearsal).
3. Apply the schema: `npm run migrate` (idempotent; `db/migrations/*.sql` in order).
4. Backfill: `node scripts/import-json.js` (idempotent; preserves ids, tokens, timelines; safe to re-run).
5. Verify counts match the JSON file: orders, agents, timeline events.
6. Flip `STORAGE_BACKEND=pg` on Render and redeploy.
7. Smoke check: /admin job board loads, order detail shows its timeline,
   demo gallery still gated (unpaid = previews only), booking a test order
   lands in Postgres.
8. Delete the test order. Done - data now survives redeploys.

## Rollback

The JSON file is left untouched by the cutover, so rollback is: set
`STORAGE_BACKEND=json` and redeploy. Anything written to Postgres after the
flip is not in the JSON file; re-run the import in reverse only if the
rollback becomes permanent (export via `scripts/backup.js` and re-enter, or
accept Postgres as source of truth and fix forward instead).

## Cutover: disk -> R2 (phase 2, needs the Cloudflare account)

1. Create the R2 bucket `jwre-media` and an API token (Object Read & Write,
   bucket-scoped).
2. Set the four `R2_*` vars + `DATABASE_URL`, keep `MEDIA_BACKEND=disk`.
3. `node scripts/migrate-media-to-r2.js` - copies delivered files, registers
   them in `delivery_files`. Idempotent.
4. Spot check: `headObject` sizes match disk for a few files.
5. Flip `MEDIA_BACKEND=r2` and redeploy. Rollback: flip back to `disk`
   (files stay on both sides during transition).

## Backup and restore

- Backup: `node scripts/backup.js` - dumps every table to
  `backups/jwre-backup-<timestamp>.json` locally and, when R2 is configured,
  uploads the same file under `backups/` in the bucket.
- Restore: `node scripts/restore.js --file <backup.json> --yes` - dry run
  without `--yes`; with `--yes` it truncates and reloads every table inside
  one transaction.
- Restore drills run against a rehearsal database (`TEST_DATABASE_URL`),
  never against production by default.
- Supabase free tier pauses projects after ~7 days of inactivity; the app
  getting real bookings keeps it active. R2 free tier: 10 GB storage,
  1M Class A / 10M Class B ops per month, zero egress fees.

## Tests

- `npm test` - full suite including R2 key model + SigV4 vector.
- `TEST_DATABASE_URL=... node --test test/store-pg.test.js` - adapter
  conformance against a real Postgres (used for the cutover rehearsal).
