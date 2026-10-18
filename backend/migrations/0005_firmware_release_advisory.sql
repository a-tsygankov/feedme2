-- OTA discovery only. No binary distribution or installation is authorized by this table.
-- A release is a human-reviewed advisory until a separate signed-image
-- distribution and rollback mechanism is implemented.
CREATE TABLE firmware_releases (
    id          TEXT PRIMARY KEY,
    hw_model    TEXT NOT NULL CHECK (hw_model IN ('crowpanel-1.28', 'xiao-esp32s3-sense-scale')),
    version     TEXT NOT NULL CHECK (length(version) BETWEEN 5 AND 32),
    active      INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
    created_at  INTEGER NOT NULL CHECK (created_at > 0),
    UNIQUE (hw_model, version)
);
CREATE INDEX firmware_releases_model_active ON firmware_releases (hw_model, active, created_at DESC);
