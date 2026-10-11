-- 0001: the house data model (spec §3.1). Every timestamp is epoch ms,
-- every amount is milligrams, every id is a client-generated UUID.
--
-- name_key carries the case-insensitive uniqueness the spec asks for;
-- SQLite's UNIQUE on name alone is case-sensitive. The app computes it
-- (trim().toLowerCase() after NFC normalisation); the SQL lower() used in
-- tests is ASCII-only, so tests must not rely on it for non-ASCII names.
--
-- No ON DELETE clauses: rows are soft-deleted via deleted_at and houses
-- are never hard-deleted by design, so a cascade or SET NULL has no
-- trigger to fire on and a bare RESTRICT is the behaviour we want.
--
-- log_entries (0000) intentionally has no FK to houses: a log write must
-- never fail because a house is missing (0000 said Phase 1 would add it;
-- decided against).
CREATE TABLE houses (
  id                        TEXT PRIMARY KEY,
  name                      TEXT    NOT NULL,
  name_key                  TEXT    NOT NULL UNIQUE,
  pin_salt                  TEXT    NOT NULL,
  pin_hash                  TEXT    NOT NULL,
  food_unit                 TEXT    NOT NULL DEFAULT 'g' CHECK (food_unit IN ('g', 'oz', 'can')),
  can_size_mg               INTEGER NOT NULL DEFAULT 155922 CHECK (can_size_mg > 0),
  can_fraction_step         TEXT    NOT NULL DEFAULT '1/4' CHECK (can_fraction_step IN ('1/4', '1/3', '1/2')),
  gram_step                 INTEGER NOT NULL DEFAULT 5 CHECK (gram_step IN (1, 5, 10)),
  oz_step_hundredths        INTEGER NOT NULL DEFAULT 25 CHECK (oz_step_hundredths IN (25, 50)),
  hungry_after_sec_default  INTEGER NOT NULL DEFAULT 18000 CHECK (hungry_after_sec_default > 0),
  sleep_timeout_sec         INTEGER NOT NULL DEFAULT 300 CHECK (sleep_timeout_sec > 0),
  sync_interval_sec         INTEGER NOT NULL DEFAULT 21600 CHECK (sync_interval_sec > 0),
  timezone                  TEXT    NOT NULL DEFAULT 'UTC',
  created_at                INTEGER NOT NULL,
  modified_at               INTEGER NOT NULL,
  deleted_at                INTEGER
);

CREATE TABLE cats (
  id                    TEXT PRIMARY KEY,
  house_id              TEXT    NOT NULL REFERENCES houses(id),
  name                  TEXT    NOT NULL,
  color                 TEXT    NOT NULL,
  avatar_pose           TEXT    NOT NULL DEFAULT 'C2',
  hungry_after_sec      INTEGER NOT NULL CHECK (hungry_after_sec > 0),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  default_amount_mg     INTEGER CHECK (default_amount_mg IS NULL OR default_amount_mg > 0),
  default_entered_unit  TEXT    CHECK (default_entered_unit IN ('g', 'oz', 'can')),
  default_entered_value TEXT,
  last_fed_at           INTEGER,
  created_at            INTEGER NOT NULL,
  modified_at           INTEGER NOT NULL,
  deleted_at            INTEGER,
  -- The default amount is meaningless without how it was entered, and
  -- vice versa: all three set or all three NULL.
  CHECK (
    (default_amount_mg IS NULL) = (default_entered_unit IS NULL)
    AND (default_amount_mg IS NULL) = (default_entered_value IS NULL)
  ),
  -- Target of feedings' composite FK, which is what pins a feeding to
  -- its cat's own house.
  UNIQUE (house_id, id)
);
CREATE INDEX cats_house ON cats (house_id, sort_order);

CREATE TABLE feedings (
  id            TEXT PRIMARY KEY,
  house_id      TEXT    NOT NULL REFERENCES houses(id),
  cat_id        TEXT    NOT NULL,
  fed_at        INTEGER NOT NULL CHECK (fed_at > 0),
  amount_mg     INTEGER NOT NULL CHECK (amount_mg > 0),
  entered_unit  TEXT    NOT NULL CHECK (entered_unit IN ('g', 'oz', 'can')),
  entered_value TEXT    NOT NULL,
  source        TEXT    NOT NULL CHECK (source IN ('device', 'web')),
  device_id     TEXT,
  client_id     TEXT,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  modified_at   INTEGER NOT NULL,
  deleted_at    INTEGER,
  -- Tenancy: a feeding can only reference a cat of its own house, so a
  -- bug in a route (or a forged cat id) cannot cross houses.
  FOREIGN KEY (house_id, cat_id) REFERENCES cats (house_id, id)
);
-- id is the tiebreaker for compound (fed_at, id) cursor paging: many
-- feedings can share a fed_at (e.g. "feed all").
CREATE INDEX feedings_house_time ON feedings (house_id, fed_at DESC, id DESC);
CREATE INDEX feedings_cat_time ON feedings (house_id, cat_id, fed_at DESC, id DESC);

-- Opaque rotating refresh tokens (spec §3.2). Only the SHA-256 of the
-- token is stored; rotated_from records the chain for replay detection.
CREATE TABLE refresh_tokens (
  id           TEXT PRIMARY KEY,
  house_id     TEXT    NOT NULL REFERENCES houses(id),
  token_hash   TEXT    NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  rotated_from TEXT
);
CREATE INDEX refresh_tokens_house ON refresh_tokens (house_id);
-- Replay detection walks the chain by rotated_from.
CREATE INDEX refresh_tokens_rotated_from ON refresh_tokens (rotated_from);

-- Retention prunes log_entries by the server-set created_at, not the
-- client-supplied ts (a device with a bad clock must not dodge pruning).
CREATE INDEX IF NOT EXISTS log_entries_created_at ON log_entries (created_at);
