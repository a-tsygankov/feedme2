-- 0000_init: the unified log table (spec §4.6, decision D10). Written
-- by the worker's D1 sink and the /api/logs + /api/device/logs routes
-- from Phase 1; created now so the schema tier has a version and CI's
-- migrate step has something to apply. house_id is nullable until
-- houses exist (Phase 1 adds the FK in its own migration).
CREATE TABLE log_entries (
  id         TEXT PRIMARY KEY,
  house_id   TEXT,
  source     TEXT    NOT NULL CHECK (source IN ('web', 'worker', 'device')),
  device_id  TEXT,
  client_id  TEXT,
  ts         INTEGER NOT NULL,
  level      TEXT    NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  msg        TEXT    NOT NULL,
  data       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX log_entries_house_ts ON log_entries (house_id, ts DESC);
