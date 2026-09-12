-- Individual Studio accounts for owners and employee photographers.
CREATE TABLE IF NOT EXISTS studio_users (
  id                   BIGSERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('owner','photographer')),
  active               BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  session_version      INTEGER NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_users_email_lower_idx ON studio_users (lower(email));

CREATE TABLE IF NOT EXISTS studio_audit_events (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   BIGINT REFERENCES studio_users (id) ON DELETE SET NULL,
  event      TEXT NOT NULL,
  target_id  BIGINT REFERENCES studio_users (id) ON DELETE SET NULL,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_audit_events_created_idx ON studio_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS studio_audit_events_actor_idx ON studio_audit_events (actor_id, created_at DESC);
