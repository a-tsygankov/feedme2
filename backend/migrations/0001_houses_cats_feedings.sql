-- 0001: the house data model (spec §3.1). Every timestamp is epoch ms,
-- every amount is milligrams, every id is a client-generated UUID.
-- name_key = lower(name) carries the case-insensitive uniqueness the
-- spec asks for; SQLite's UNIQUE on name alone is case-sensitive.
CREATE TABLE houses (
  id                        TEXT PRIMARY KEY,
  name                      TEXT    NOT NULL,
  name_key                  TEXT    NOT NULL UNIQUE,
  pin_salt                  TEXT    NOT NULL,
  pin_hash                  TEXT    NOT NULL,
  food_unit                 TEXT    NOT NULL DEFAULT 'g' CHECK (food_unit IN ('g', 'oz', 'can')),
  can_size_mg               INTEGER NOT NULL DEFAULT 155922,
  can_fraction_step         TEXT    NOT NULL DEFAULT '1/4' CHECK (can_fraction_step IN ('1/4', '1/3', '1/2')),
  gram_step                 INTEGER NOT NULL DEFAULT 5 CHECK (gram_step IN (1, 5, 10)),
  oz_step_hundredths        INTEGER NOT NULL DEFAULT 25 CHECK (oz_step_hundredths IN (25, 50)),
  hungry_after_sec_default  INTEGER NOT NULL DEFAULT 18000,
  sleep_timeout_sec         INTEGER NOT NULL DEFAULT 300,
  sync_interval_sec         INTEGER NOT NULL DEFAULT 21600,
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
  hungry_after_sec      INTEGER NOT NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  default_amount_mg     INTEGER,
  default_entered_unit  TEXT    CHECK (default_entered_unit IN ('g', 'oz', 'can')),
  default_entered_value TEXT,
  last_fed_at           INTEGER,
  created_at            INTEGER NOT NULL,
  modified_at           INTEGER NOT NULL,
  deleted_at            INTEGER
);
CREATE INDEX cats_house ON cats (house_id, sort_order);

CREATE TABLE feedings (
  id            TEXT PRIMARY KEY,
  house_id      TEXT    NOT NULL REFERENCES houses(id),
  cat_id        TEXT    NOT NULL REFERENCES cats(id),
  fed_at        INTEGER NOT NULL,
  amount_mg     INTEGER NOT NULL CHECK (amount_mg > 0),
  entered_unit  TEXT    NOT NULL CHECK (entered_unit IN ('g', 'oz', 'can')),
  entered_value TEXT    NOT NULL,
  source        TEXT    NOT NULL CHECK (source IN ('device', 'web')),
  device_id     TEXT,
  client_id     TEXT,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  modified_at   INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX feedings_house_time ON feedings (house_id, fed_at DESC);
CREATE INDEX feedings_cat_time ON feedings (house_id, cat_id, fed_at DESC);

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
