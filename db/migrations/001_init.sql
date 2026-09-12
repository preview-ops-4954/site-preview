-- JWRE Media persistence foundation, migration 001: initial schema.
-- Portable PostgreSQL (Supabase free tier is the target; runs on any PG 12+).
-- Nothing here is Supabase-specific: no RLS, no auth schema, plain tables.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Monotonic id counters, replacing the JSON store's seq / agentSeq.
CREATE TABLE IF NOT EXISTS counters (
  key    TEXT PRIMARY KEY,
  value  BIGINT NOT NULL
);
INSERT INTO counters (key, value) VALUES ('order', 1000), ('agent', 100)
ON CONFLICT DO NOTHING;

-- Real estate agent portal accounts (the business's clients).
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,             -- AGT-101
  name          TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  branding      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,          -- JWRE-1001
  agent_id          TEXT REFERENCES agents (id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'booked'
                    CHECK (status IN ('booked','scheduled','shot','editing','delivered','paid')),
  payment_status    TEXT NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid','paid')),
  stripe_session_id TEXT,
  delivery_token    TEXT NOT NULL UNIQUE,
  site_token        TEXT NOT NULL UNIQUE,
  credit            TEXT NOT NULL DEFAULT 'JWRE Media',
  customer          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- name / email / phone at booking time
  property          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- address, city, zip, sqft, notes
  package_id        TEXT,
  addon_ids         JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_date    TEXT NOT NULL DEFAULT '',
  preferred_time    TEXT NOT NULL DEFAULT '',
  site              JSONB NOT NULL DEFAULT '{"selected": null, "published": true}'::jsonb,
  listing           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- agent-entered public listing facts
  delivery_release  JSONB,                                -- photographer override, null when locked
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_agent_idx ON orders (agent_id);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_session_idx
  ON orders (stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- Order timeline: every status change, delivery, release, and edit. Append-only.
CREATE TABLE IF NOT EXISTS order_events (
  id        BIGSERIAL PRIMARY KEY,
  order_id  TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  event     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, id);

-- Payment state audit: every paid/unpaid flip and delivery release grant/revoke.
-- Written automatically by the store adapter whenever those fields change.
CREATE TABLE IF NOT EXISTS payment_events (
  id        BIGSERIAL PRIMARY KEY,
  order_id  TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind      TEXT NOT NULL CHECK (kind IN ('paid','unpaid','release_granted','release_revoked')),
  detail    JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS payment_events_order_idx ON payment_events (order_id, id);

-- Media registry: one row per stored object. object_key points into R2
-- (see docs/persistence.md for the key model). Files may still live on
-- local disk during the transition; media_backend says where.
CREATE TABLE IF NOT EXISTS delivery_files (
  id           BIGSERIAL PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('original','preview','video','zip','proof')),
  object_key   TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT,
  byte_size    BIGINT,
  sha256       TEXT,
  media_backend TEXT NOT NULL DEFAULT 'r2',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, kind, filename)
);
CREATE INDEX IF NOT EXISTS delivery_files_order_idx ON delivery_files (order_id);
