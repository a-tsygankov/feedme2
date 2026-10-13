-- QR login (spec §3.1, §3.3): a paired device mints a one-time, 60-second token a phone exchanges for house tokens.
-- Only the SHA-256 of the token is stored, like refresh_tokens and pending_pairings.poll_secret_hash.
CREATE TABLE login_qr_tokens (
  token_hash  TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  device_id   TEXT NOT NULL CHECK (length(device_id) = 32),
  house_id    TEXT NOT NULL CHECK (length(house_id) = 36),
  -- devices.token_id (the pairing's jti) when the token was minted: a re-pair, even to the same house, kills it.
  device_token_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL CHECK (expires_at > created_at),
  consumed_at INTEGER
);
-- One live token per device: a new create deletes the device's older rows first (see the repo).
CREATE INDEX login_qr_tokens_device ON login_qr_tokens (device_id);
CREATE INDEX login_qr_tokens_expires ON login_qr_tokens (expires_at);
