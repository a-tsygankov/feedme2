-- Scale telemetry v1: immutable observations, not feeding records.
-- A device can be forgotten and paired again (even to another house).
-- Keep historical house_id as captured at ingest; pairing_token_id scopes
-- sequence numbers to the current pairing epoch, without mutating history.
CREATE TABLE scale_events (
    id                   TEXT PRIMARY KEY CHECK (length(id) = 36),
    house_id             TEXT NOT NULL REFERENCES houses(id),
    device_id            TEXT NOT NULL REFERENCES devices(id),
    pairing_token_id     TEXT NOT NULL,
    sequence             INTEGER NOT NULL CHECK (sequence >= 0 AND sequence <= 9007199254740991),
    kind                 TEXT NOT NULL CHECK (kind IN ('stable_weight', 'bowl_removed', 'bowl_returned', 'sensor_fault')),
    observed_at          INTEGER NOT NULL CHECK (observed_at >= 0 AND observed_at <= 4102444800000),
    received_at          INTEGER NOT NULL CHECK (received_at >= 0),
    calibration_revision INTEGER NOT NULL CHECK (calibration_revision > 0),
    gross_mg             INTEGER CHECK (gross_mg IS NULL OR (gross_mg >= 0 AND gross_mg <= 1000000)),
    fault_code           TEXT CHECK (fault_code IS NULL OR fault_code IN ('adc_timeout', 'sensor_disconnected', 'overload', 'calibration_invalid')),
    CHECK (
        (kind IN ('stable_weight', 'bowl_returned') AND gross_mg IS NOT NULL AND fault_code IS NULL)
        OR (kind = 'bowl_removed' AND gross_mg IS NULL AND fault_code IS NULL)
        OR (kind = 'sensor_fault' AND gross_mg IS NULL AND fault_code IS NOT NULL)
    ),
    UNIQUE (device_id, pairing_token_id, sequence)
);
CREATE INDEX scale_events_house_device_time ON scale_events (house_id, device_id, observed_at DESC, id DESC);
