-- Privacy-safe, single-use account recovery tokens.
CREATE TABLE IF NOT EXISTS account_recovery_tokens (
  id          BIGSERIAL PRIMARY KEY,
  portal      TEXT NOT NULL CHECK (portal IN ('studio','agent')),
  account_id  TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_ip TEXT
);
CREATE INDEX IF NOT EXISTS account_recovery_lookup_idx ON account_recovery_tokens (token_hash, portal);
