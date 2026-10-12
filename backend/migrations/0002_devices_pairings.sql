-- Phase 2 (spec §3.1): paired devices and the pairing handshake.
-- No ON DELETE clauses: devices are revoked (revoked_at), never hard-deleted,
-- so feedings keep a valid device_id for history.

CREATE TABLE devices (
  id            TEXT    PRIMARY KEY CHECK (length(id) = 32 AND id = lower(id) AND id NOT GLOB '*[^0-9a-f]*'),
  house_id      TEXT    NOT NULL REFERENCES houses(id),
  name          TEXT    NOT NULL,
  hw_model      TEXT    NOT NULL,
  fw_version    TEXT    NOT NULL,
  -- The jti of the one device token that is valid for this row. A fresh id per
  -- pairing means forget → re-pair (same device, same house) cannot revive tokens
  -- issued by an earlier pairing.
  token_id      TEXT    NOT NULL,
  last_seen_at  INTEGER,
  battery_pct   INTEGER CHECK (battery_pct IS NULL OR (battery_pct >= 0 AND battery_pct <= 100)),
  reset_reason  TEXT,
  -- Phase 3: install approved OTA updates on the timer wake without asking.
  auto_install  INTEGER NOT NULL DEFAULT 0 CHECK (auto_install IN (0, 1)),
  created_at    INTEGER NOT NULL,
  modified_at   INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX devices_house ON devices (house_id);

-- One handshake per device at a time: POST /api/pair/start replaces the
-- row. device_token is held in plaintext only until the device collects
-- it (or the delivery window closes, or the row expires); the cron deletes
-- expired rows.
CREATE TABLE pending_pairings (
  device_id         TEXT    PRIMARY KEY CHECK (length(device_id) = 32 AND device_id NOT GLOB '*[^0-9a-f]*'),
  pair_code         TEXT    NOT NULL CHECK (length(pair_code) = 6 AND pair_code NOT GLOB '*[^0-9]*'),
  hw_model          TEXT    NOT NULL,
  fw_version        TEXT    NOT NULL,
  requested_at      INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL CHECK (expires_at > requested_at),
  -- SHA-256 of the secret the device chose at /start; /check (public) only
  -- serves the token to the holder of that secret.
  poll_secret_hash  TEXT    NOT NULL,
  house_id          TEXT    REFERENCES houses(id),
  confirmed_at      INTEGER,
  device_token      TEXT,
  delivered_at      INTEGER
);
CREATE UNIQUE INDEX pending_pairings_code ON pending_pairings (pair_code);
CREATE INDEX pending_pairings_expires ON pending_pairings (expires_at);

-- Failed /api/pair/confirm attempts per house in a rolling window: a signed-in
-- account must not be able to walk the 6-digit code space.
CREATE TABLE pair_attempts (
  house_id      TEXT    PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  failures      INTEGER NOT NULL
);
